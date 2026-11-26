// Bájná horda server (Rust): static files, JSON API (accounts, characters, single-player runs) and co-op WebSockets.
// Behaviour matches server/server.js; the Node server is the reference (see test/server.test.js, which runs against both).
mod data;
mod db;
mod meta;
mod rooms;
mod sim;

use axum::body::Body;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, FromRequest, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method};
use axum::response::Response;
use axum::routing::any;
use axum::Router;
use db::Db;
use flate2::write::GzEncoder;
use flate2::Compression;
use futures_util::{SinkExt, StreamExt};
use meta::{apply_run, create_char, unlocked, upgrade_equip, valid_name, Profile, RunResult};
use rooms::{Hub, Out, Who};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const CSP: &str = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const TICKET_MAX_AGE: i64 = 3 * 3600 * 1000;

struct App {
    db: Arc<Db>, hub: Hub, secret: String, cors: HashSet<String>, trust_proxy: bool, reg_per_hour: u32, run_ratio: f64,
    public: PathBuf, shared: PathBuf, dummy: String,
    buckets: Mutex<HashMap<String, (u32, Instant)>>,
    open_ticket: Mutex<HashMap<i64, String>>,   // user -> nonce of the only ticket that may be redeemed (shortcut: in memory, a restart forgets it)
    cache: Mutex<HashMap<PathBuf, (String, Arc<Vec<u8>>, Option<Arc<Vec<u8>>>)>>,
}

struct ApiErr(u16, &'static str);
type ApiResult = Result<Value, ApiErr>;

/// JS `Number(value)`.
pub fn js_number(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => { let t = s.trim(); if t.is_empty() { 0.0 } else { t.parse::<f64>().unwrap_or(f64::NAN) } }
        Value::Bool(b) => if *b { 1.0 } else { 0.0 },
        Value::Null => 0.0,
        _ => f64::NAN,
    }
}
fn is_integer(v: &Value) -> Option<i64> { match v { Value::Number(n) => { let f = n.as_f64()?; if f.is_finite() && f.fract() == 0.0 && f.abs() < 9e15 { Some(f as i64) } else { None } } _ => None } }
fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 }

impl App {
    fn client_ip(&self, addr: &SocketAddr, headers: &HeaderMap) -> String {
        let mut ip: IpAddr = addr.ip();
        if self.trust_proxy {
            if let Some(xf) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
                if let Some(last) = xf.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).last() { if let Ok(p) = last.parse::<IpAddr>() { ip = p; } }
            }
        }
        match ip {
            IpAddr::V4(v) => v.to_string(),
            IpAddr::V6(v) => match v.to_ipv4_mapped() { Some(m) => m.to_string(), None => { let s = v.segments(); format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3]) } },
        }
    }
    fn limited(&self, key: String, max: u32, ms: u64) -> bool {
        let mut b = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        if !b.contains_key(&key) && b.len() >= 50_000 {
            let now = Instant::now(); b.retain(|_, v| v.1 > now);   // drop expired buckets instead of locking everyone out
            if b.len() >= 50_000 { return true; }
        }
        let e = b.entry(key).or_insert((0, now + Duration::from_millis(ms)));
        if e.1 <= now { *e = (0, now + Duration::from_millis(ms)); }
        e.0 += 1;
        e.0 > max
    }
    fn auth(&self, headers: &HeaderMap, query_token: Option<&str>) -> Option<db::User> {
        let tok = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).map(|s| s.strip_prefix("Bearer ").unwrap_or(s).to_string()).filter(|s| !s.is_empty()).or_else(|| query_token.map(|s| s.to_string())).unwrap_or_default();
        if tok.is_empty() || tok.len() > 100 { return None; }
        self.db.session(&tok)
    }
    fn need(&self, headers: &HeaderMap) -> Result<db::User, ApiErr> { self.auth(headers, None).ok_or(ApiErr(401, "unauthorized")) }
    fn profile_json(p: &Profile) -> Value {
        let chars: Vec<Value> = p.chars.iter().map(|c| json!({"id": c.id, "name": c.name, "cls": c.cls, "level": c.level, "xp": c.xp,
            "equip": {"weapon": c.equip.weapon, "armor": c.equip.armor, "ring": c.equip.ring, "boots": c.equip.boots}})).collect();
        json!({"coins": p.coins, "chars": chars, "progress": {"single": p.single, "multi": p.multi}})
    }
    fn profile(&self, uid: i64) -> Result<Profile, ApiErr> { self.db.load_profile(uid).ok_or(ApiErr(500, "server")) }
    fn session(&self, id: i64) -> ApiResult {
        let u = self.db.user(id).ok_or(ApiErr(500, "server"))?;
        let token = self.db.new_session(id);
        Ok(json!({"token": token, "user": u.name, "room": u.room, "profile": Self::profile_json(&self.profile(id)?)}))
    }
    fn sign(&self, body: &str) -> String { db::sign(&self.secret, body) }
}

async fn read_json(body: Body) -> Result<Map<String, Value>, ApiErr> {
    let bytes = axum::body::to_bytes(body, 4000).await.map_err(|_| ApiErr(413, "too_large"))?;
    if bytes.is_empty() { return Ok(Map::new()); }
    match serde_json::from_slice::<Value>(&bytes) { Ok(Value::Object(m)) => Ok(m), Ok(_) => Ok(Map::new()), Err(_) => Err(ApiErr(400, "bad_json")) }
}

async fn api(app: &Arc<App>, method: &Method, path: &str, headers: &HeaderMap, addr: &SocketAddr, body: Body) -> ApiResult {
    let ip = app.client_ip(addr, headers);
    match (method.as_str(), path) {
        ("POST", "register") => {
            if app.limited(format!("reg:{ip}"), app.reg_per_hour, 3600_000) { return Err(ApiErr(429, "rate")); }
            let b = read_json(body).await?;
            let name = match b.get("name") { Some(Value::String(s)) if valid_name(s) => s.trim().to_string(), _ => return Err(ApiErr(400, "name")) };
            let pass = match b.get("pass") { Some(Value::String(s)) if s.chars().count() >= 6 && s.encode_utf16().count() <= 72 => s.clone(), _ => return Err(ApiErr(400, "pass")) };
            if app.db.by_key(&db::name_key(&name)).is_some() { return Err(ApiErr(409, "taken")); }
            let hash = tokio::task::spawn_blocking(move || db::hash_password(&pass)).await.map_err(|_| ApiErr(500, "server"))?;
            let id = match app.db.create_user(&name, &hash) { Ok(i) => i, Err(true) => return Err(ApiErr(409, "taken")), Err(false) => return Err(ApiErr(500, "server")) };
            app.session(id)
        }
        ("POST", "login") => {
            if app.limited(format!("login:{ip}"), 30, 600_000) { return Err(ApiErr(429, "rate")); }
            let b = read_json(body).await?;
            let (Some(Value::String(name)), Some(Value::String(pass))) = (b.get("name"), b.get("pass")) else { return Err(ApiErr(400, "badlogin")) };
            if pass.encode_utf16().count() > 72 { return Err(ApiErr(400, "badlogin")); }
            let u = app.db.by_key(&db::name_key(name.trim()));
            let stored = u.as_ref().map(|r| r.pass.clone()).unwrap_or_else(|| app.dummy.clone());
            let pass = pass.clone();
            let ok = tokio::task::spawn_blocking(move || db::check_password(&pass, &stored)).await.map_err(|_| ApiErr(500, "server"))?;
            match u { Some(r) if ok => app.session(r.id), _ => Err(ApiErr(401, "badlogin")) }
        }
        ("POST", "logout") => {
            if let Some(t) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).map(|s| s.strip_prefix("Bearer ").unwrap_or(s)) { if !t.is_empty() { app.db.del_session(t); } }
            Ok(json!({"ok": true}))
        }
        ("GET", "me") => { let u = app.need(headers)?; Ok(json!({"user": u.name, "room": u.room, "profile": App::profile_json(&app.profile(u.id)?)})) }
        ("POST", "chars") => {
            let u = app.need(headers)?; let b = read_json(body).await?;
            if app.limited(format!("chars:{}", u.id), 30, 3600_000) { return Err(ApiErr(429, "rate")); }
            let name = match b.get("name") { Some(Value::String(s)) => s.clone(), _ => String::new() };
            let cls = match b.get("cls") { Some(Value::String(s)) => s.clone(), _ => String::new() };
            let mut p = app.profile(u.id)?;
            if let Some(err) = create_char(&mut p, &name, &cls, 0) { return Err(ApiErr(400, err)); }
            app.db.insert_char(u.id, &p.chars.last().unwrap().name, &cls);
            Ok(json!({"profile": App::profile_json(&app.profile(u.id)?)}))
        }
        ("POST", "chars/delete") => {
            let u = app.need(headers)?; let b = read_json(body).await?;
            let Some(id) = b.get("id").and_then(is_integer) else { return Err(ApiErr(400, "bad")) };
            app.db.delete_char(id, u.id);
            Ok(json!({"profile": App::profile_json(&app.profile(u.id)?)}))
        }
        ("POST", "upgrade") => {
            let u = app.need(headers)?; let b = read_json(body).await?;
            let mut p = app.profile(u.id)?;
            let cid = b.get("charId").and_then(is_integer).unwrap_or(i64::MIN);
            let slot = b.get("slot").and_then(|v| v.as_str()).unwrap_or("");
            if let Some(err) = upgrade_equip(&mut p, cid, slot) { return Err(ApiErr(400, err)); }
            app.db.save_profile(u.id, &p).map_err(|_| ApiErr(500, "server"))?;
            Ok(json!({"profile": App::profile_json(&p)}))
        }
        ("POST", "run/start") => {
            let u = app.need(headers)?; let b = read_json(body).await?;
            if app.limited(format!("run:{}", u.id), 120, 3600_000) { return Err(ApiErr(429, "rate")); }
            let dun = b.get("dungeon").and_then(|v| v.as_str()).unwrap_or("");
            let cid = b.get("charId").and_then(is_integer).unwrap_or(i64::MIN);
            let p = app.profile(u.id)?;
            let Some(d) = data::dungeon(dun) else { return Err(ApiErr(400, "bad")) };
            if d.mode != "single" || !unlocked(&p, d) || app.db.get_char(cid, u.id).is_none() { return Err(ApiErr(400, "bad")); }
            let nonce = db::random_token(9);
            let body = format!("{}.{}.{}.{}.{}", u.id, cid, dun, now_ms(), nonce);
            { let mut ot = app.open_ticket.lock().unwrap_or_else(|e| e.into_inner()); if ot.len() > 20_000 { ot.clear(); } ot.insert(u.id, nonce); }
            Ok(json!({"ticket": format!("{}.{}", body, app.sign(&body))}))
        }
        ("POST", "run/finish") => {
            let u = app.need(headers)?; let b = read_json(body).await?;
            let ticket = match b.get("ticket") { Some(Value::String(s)) => s.clone(), _ => String::new() };
            let parts: Vec<&str> = ticket.split('.').collect();
            if parts.len() != 6 { return Err(ApiErr(400, "bad_ticket")); }
            let tbody = parts[..5].join(".");
            if !db::ct_eq(app.sign(&tbody).as_bytes(), parts[5].as_bytes()) { return Err(ApiErr(400, "bad_ticket")); }
            let (uid, char_id, dun, issued, nonce) = (parts[0], parts[1], parts[2], parts[3], parts[4]);
            let age = now_ms() - issued.parse::<i64>().unwrap_or(i64::MIN / 2);
            if uid.parse::<i64>().ok() != Some(u.id) || age < 0 || age > TICKET_MAX_AGE { return Err(ApiErr(400, "bad_ticket")); }
            let num = |k: &str| b.get(k).map(js_number).unwrap_or(f64::NAN);
            let (time, kills, coins) = (num("time"), num("kills"), num("coins"));
            let cleared = b.get("cleared") == Some(&Value::Bool(true));
            if ![time, kills, coins].iter().all(|n| n.is_finite() && *n >= 0.0) || time > 960.0 { return Err(ApiErr(400, "bad")); }
            if time * 1000.0 * app.run_ratio > age as f64 + 3000.0 { return Err(ApiErr(400, "too_fast")); }
            if kills > time * 12.0 + 50.0 || coins > kills * 0.25 + time * 0.25 + 30.0 { return Err(ApiErr(400, "implausible")); }
            if cleared && time < data::data().consts.boss_at - 10.0 { return Err(ApiErr(400, "implausible")); }
            if let Some(n) = app.open_ticket.lock().unwrap_or_else(|e| e.into_inner()).get(&u.id) { if n != nonce { return Err(ApiErr(400, "bad_ticket")); } }
            if app.db.ticket_used(nonce) { return Err(ApiErr(409, "ticket_used")); }
            app.db.use_ticket(nonce, now_ms() + TICKET_MAX_AGE * 2);
            let mut p = app.profile(u.id)?;
            let rew = apply_run(&mut p, char_id.parse::<i64>().unwrap_or(i64::MIN), &RunResult { dungeon_id: dun, kills: kills.floor(), coins_picked: coins.floor(), time_sec: time, cleared, reward_mul: 1.0 });
            let Some(rew) = rew else { return Err(ApiErr(400, "bad")) };
            app.db.save_profile(u.id, &p).map_err(|_| ApiErr(500, "server"))?;
            Ok(json!({"reward": {"xp": rew.xp, "coins": rew.coins}, "profile": App::profile_json(&p)}))
        }
        _ => Err(ApiErr(404, "not_found")),
    }
}

// ---------- static files ----------
fn content_type(ext: &str) -> &'static str {
    match ext { "html" => "text/html; charset=utf-8", "js" => "text/javascript; charset=utf-8", "css" => "text/css; charset=utf-8", "svg" => "image/svg+xml", "woff2" => "font/woff2", "json" => "application/json", "png" => "image/png", "webmanifest" => "application/manifest+json", _ => "application/octet-stream" }
}
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes(); let mut out = Vec::with_capacity(b.len()); let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' { let h = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?; out.push(u8::from_str_radix(h, 16).ok()?); i += 3; } else { out.push(b[i]); i += 1; }
    }
    String::from_utf8(out).ok()
}
fn serve_static(app: &App, method: &Method, headers: &HeaderMap, pathname: &str) -> Result<Response, ApiErr> {
    let mut rel = percent_decode(pathname).ok_or(ApiErr(404, "not_found"))?;
    if rel.ends_with('/') { rel.push_str("index.html"); }
    let (root, sub) = match rel.strip_prefix("/shared/") { Some(r) => (&app.shared, r.to_string()), None => (&app.public, rel.clone()) };
    // like path.normalize + startsWith(root): refuse anything that climbs out of the root
    let mut file = root.clone();
    for part in sub.split('/') { match part { "" | "." => {} ".." => { if !file.pop() || !file.starts_with(root) { return Err(ApiErr(404, "not_found")); } } p => file.push(p) } }
    if !file.starts_with(root) || file == *root { return Err(ApiErr(404, "not_found")); }
    let md = std::fs::metadata(&file).map_err(|_| ApiErr(404, "not_found"))?;
    if !md.is_file() { return Err(ApiErr(404, "not_found")); }
    let mtime = md.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
    let etag = format!("\"{}-{}\"", md.len(), mtime);
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("");
    let ctype = content_type(ext);
    let mut rb = Response::builder().header(header::CONTENT_TYPE, ctype).header(header::ETAG, &etag).header(header::CACHE_CONTROL, "no-cache").header("x-content-type-options", "nosniff");
    if ext == "html" { rb = rb.header("content-security-policy", CSP); }
    if headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(etag.as_str()) { return Ok(rb.status(304).body(Body::empty()).unwrap()); }
    let (raw, gz) = {
        let mut c = app.cache.lock().unwrap_or_else(|e| e.into_inner());
        match c.get(&file) {
            Some((e, r, g)) if *e == etag => (r.clone(), g.clone()),
            _ => {
                let raw = Arc::new(std::fs::read(&file).map_err(|_| ApiErr(404, "not_found"))?);
                let gz = if raw.len() > 600 && (ctype.starts_with("text") || ctype.starts_with("image/svg") || ctype == "application/json" || ctype == "application/manifest+json") {
                    let mut e = GzEncoder::new(Vec::new(), Compression::default()); let _ = e.write_all(&raw); e.finish().ok().map(Arc::new)
                } else { None };
                c.insert(file.clone(), (etag.clone(), raw.clone(), gz.clone()));
                (raw, gz)
            }
        }
    };
    let want_gz = gz.is_some() && headers.get(header::ACCEPT_ENCODING).and_then(|v| v.to_str().ok()).map(|v| v.contains("gzip")).unwrap_or(false);
    if want_gz { rb = rb.header(header::CONTENT_ENCODING, "gzip").header(header::VARY, "Accept-Encoding"); }
    let bytes = if want_gz { gz.unwrap().as_ref().clone() } else { raw.as_ref().clone() };
    Ok(rb.status(200).body(if method == Method::HEAD { Body::empty() } else { Body::from(bytes) }).unwrap())
}

fn json_response(status: u16, v: Value, no_store: bool) -> Response {
    let mut rb = Response::builder().status(status).header(header::CONTENT_TYPE, "application/json");
    if no_store { rb = rb.header(header::CACHE_CONTROL, "no-store"); }
    rb.body(Body::from(v.to_string())).unwrap()
}

async fn handle(State(app): State<Arc<App>>, ConnectInfo(addr): ConnectInfo<SocketAddr>, req: Request) -> Response {
    let (parts, body) = req.into_parts();
    let path = parts.uri.path().to_string();
    let origin = parts.headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let mut res = if parts.method == Method::OPTIONS {
        Response::builder().status(204).body(Body::empty()).unwrap()
    } else if path == "/health" {
        let (rooms, players) = app.hub.stats();
        json_response(200, json!({"ok": true, "rooms": rooms, "players": players}), false)
    } else if let Some(rest) = path.strip_prefix("/api/") {
        match api(&app, &parts.method, rest, &parts.headers, &addr, body).await {
            Ok(v) => json_response(200, v, true),
            Err(ApiErr(s, c)) => { let mut r = json_response(s, json!({"error": c}), false); if s == 413 { r.headers_mut().insert(header::CONNECTION, HeaderValue::from_static("close")); } r }
        }
    } else if parts.method != Method::GET && parts.method != Method::HEAD {
        json_response(405, json!({"error": "method"}), false)
    } else {
        match serve_static(&app, &parts.method, &parts.headers, &path) { Ok(r) => r, Err(ApiErr(s, c)) => json_response(s, json!({"error": c}), false) }
    };
    if let Some(o) = origin { if app.cors.contains(&o) {
        let h = res.headers_mut();
        if let Ok(v) = HeaderValue::from_str(&o) { h.insert("access-control-allow-origin", v); }
        h.insert(header::VARY, HeaderValue::from_static("Origin"));
        h.insert("access-control-allow-headers", HeaderValue::from_static("Content-Type, Authorization"));
        h.insert("access-control-allow-methods", HeaderValue::from_static("GET, POST, OPTIONS"));
    } }
    res
}

async fn ws_route(State(app): State<Arc<App>>, ConnectInfo(addr): ConnectInfo<SocketAddr>, req: Request) -> Response {
    let headers = req.headers().clone();
    let is_upgrade = headers.get(header::UPGRADE).and_then(|v| v.to_str().ok()).map(|v| v.eq_ignore_ascii_case("websocket")).unwrap_or(false);
    if !is_upgrade { return json_response(404, json!({"error": "not_found"}), false); }
    let status = |s: u16| Response::builder().status(s).body(Body::empty()).unwrap();
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
    let origin_ok = match origin { None => true, Some(o) => app.cors.contains(o) || o == format!("http://{host}") || o == format!("https://{host}") };
    if !origin_ok { return status(403); }
    if app.limited(format!("ws:{}", app.client_ip(&addr, &headers)), 60, 60_000) { return status(429); }
    let q: HashMap<String, String> = req.uri().query().map(|q| q.split('&').filter_map(|kv| { let (k, v) = kv.split_once('=')?; Some((percent_decode(&k.replace('+', " "))?, percent_decode(&v.replace('+', " "))?)) }).collect()).unwrap_or_default();
    let who = match app.auth(&headers, q.get("token").map(|s| s.as_str())) {
        Some(u) => Who { user_id: Some(u.id), name: u.name, cls: String::new(), char_id: q.get("char").and_then(|s| s.parse::<f64>().ok()).map(|f| f as i64).unwrap_or(0) },
        None => {
            if q.get("token").map(|t| !t.is_empty()).unwrap_or(false) { return status(401); }
            let nick = q.get("nick").map(|s| s.trim().to_string()).unwrap_or_default();
            let cls = q.get("cls").cloned().unwrap_or_default();
            Who { user_id: None, name: rooms::guest_name(&nick), cls: if data::class(&cls).is_some() { cls } else { "bohatyr".to_string() }, char_id: 0 }
        }
    };
    let ws = match WebSocketUpgrade::from_request(req, &()).await { Ok(w) => w, Err(_) => return status(400) };
    let hub = app.hub.clone();
    ws.max_message_size(512).max_frame_size(512).on_upgrade(move |socket| client(socket, hub, who))
}

async fn client(socket: WebSocket, hub: Hub, who: Who) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Out>(512);
    let id = hub.connect(tx, who);
    let writer = tokio::spawn(async move {
        while let Some(o) = rx.recv().await {
            let m = match o {
                Out::Text(t) => Message::Text(t.into()),
                Out::Ping => Message::Ping(Vec::new().into()),
                Out::Close(c) => { let _ = sink.send(Message::Close(Some(CloseFrame { code: c, reason: "".into() }))).await; break; }
            };
            if sink.send(m).await.is_err() { break; }
        }
    });
    while let Some(Ok(msg)) = stream.next().await {
        hub.touch(id);
        match msg { Message::Text(t) => hub.handle(id, t.as_str()), Message::Close(_) | Message::Binary(_) => break, _ => {} }
    }
    hub.closed(id);
    writer.abort();
}

#[tokio::main]
async fn main() {
    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
    let port: u16 = env("PORT", "8080").parse().unwrap_or(8080);
    let host = env("HOST", "0.0.0.0");
    let data_dir = PathBuf::from(env("DATA_DIR", "data"));
    std::fs::create_dir_all(&data_dir).expect("DATA_DIR");
    let db_path = std::env::var("DB_PATH").unwrap_or_else(|_| data_dir.join("horde.db").to_string_lossy().into_owned());
    let db = Arc::new(Db::open(&db_path).expect("database"));
    let root = PathBuf::from(env("APP_ROOT", "."));
    data::data();                                      // fail at start-up, not mid-game, if data.json is broken
    let app = Arc::new(App {
        hub: Hub::new(db.clone()), secret: db.secret(std::env::var("TICKET_SECRET").ok()), db: db.clone(),
        cors: env("CORS_ORIGINS", "").split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        trust_proxy: env("TRUST_PROXY", "0") == "1", reg_per_hour: env("REG_PER_HOUR", "8").parse().unwrap_or(8), run_ratio: env("RUN_TIME_RATIO", "0.85").parse().unwrap_or(0.85),
        public: root.join("public"), shared: root.join("shared"), dummy: db::hash_password("timing-equaliser"),
        buckets: Mutex::new(HashMap::new()), open_ticket: Mutex::new(HashMap::new()), cache: Mutex::new(HashMap::new()),
    });
    let bg = app.clone();
    tokio::spawn(async move {
        let mut n = 0u64; let mut iv = tokio::time::interval(Duration::from_secs(20));
        loop {
            iv.tick().await; n += 1; bg.hub.heartbeat();
            if n % 3 == 0 {
                bg.db.purge();
                let now = Instant::now(); bg.buckets.lock().unwrap_or_else(|e| e.into_inner()).retain(|_, b| b.1 > now);
            }
        }
    });
    let router = Router::new().route("/ws", any(ws_route)).fallback(any(handle)).with_state(app);
    let listener = tokio::net::TcpListener::bind(format!("{host}:{port}")).await.expect("bind");
    println!("bajna-horda (rust) listening on {host}:{port}");
    let shutdown = async { let mut t = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap(); tokio::select! { _ = t.recv() => {}, _ = tokio::signal::ctrl_c() => {} } };
    axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).with_graceful_shutdown(shutdown).await.unwrap();
}
