# Bájná horda

A pixel-art survivor game for phones, played in the browser. Move with one thumb, your weapons fire on their own; level up during a run, pick upgrades, and survive until the boss. Characters are from Slavic and Czech folklore.

- **Single player** (3 dungeons, 5 minutes), **team dungeons for up to 6 players** (3 dungeons, 10 minutes) and a **special dungeon**, the raid, unlocked by clearing the last team dungeon.
- **12 classes** (Krakonoš, Zbojník, Perun, Čert, Bohatýr, Vědma, Hastrman, Polednice, Golem, Rarášek, Morana, Bába Jaga), each with its own weapon and bonus. An account holds up to 8 characters and plays one at a time. Level and gear belong to the character, coins to the account.
- **Team dungeons need teamwork.** Shrines (flags) stand around the map: capture one by standing in its circle with at least two players (three in the raid) while the circle is clear of enemies. Every held shrine gives the whole team +8 % damage and heals whoever stands in it; now and then a held shrine falls to a siege. The three bosses (2:00, 5:30, 9:00) are invulnerable until the team holds enough shrines, the last one wants all of them. Fallen players are revived by standing next to them.
- **The raid (Navia)** has the shape of a team dungeon and is several times harder: four shrines, faster waves, much stronger enemies.
- **Loot.** Clearing a dungeon makes the boss drop its weakest weapons into your bag, and with a 20 % chance an end chest appears for everyone in the run. It holds the dungeon's **legendary weapon** (one per dungeon, not sold or dropped anywhere else) among ordinary ones, and whoever opens it first takes everything; the others just see what fell.
- **Inventory and merchant.** The bag holds spare weapons: give one to the active character or sell it. The merchant pays a quarter of the shop price (and a little for upgrades): a bad rate on purpose. The held weapon and the starter staff cannot be sold.
- Co-op difficulty follows the **strongest** player in the room, so a level 1 playing with a level 100 has a harder run (and earns a bonus for it).
- **A single run is 5 minutes with three bosses** (1:00, 3:00, 5:00), each tougher than the last; a progress bar at the top shows the time and the boss markers, a counter shows your kills. Only the last boss clears the dungeon; the first two pay out a pickup chest and coins. Upgrades are listed (with what each adds) in the pause menu. The magnet pulls in only gems and coins, never chests or hearts.
- **Armory: 48 held weapons** (12 kinds x 4 tiers: sword, dagger, axe, hammer, mace, spear, staff, wand, scythe, club, bow, flail). Every character owns a few, holds one in its hand (you see it in the run and in the menus, and it swings with the attacks), buys more for coins (higher tiers need a higher character level) and upgrades each from +0 to +9. The weapon raises damage and gives a small perk (HP, speed, weapon speed or pickup range); at +3, +6 and +9 the blade sparkles. Passive upgrades have their own pixel icons.
- **The server is the referee.** Signed-in players' runs (single and co-op) are simulated on the server; the client only sends its stick direction and level-up picks, and coins, XP, levels, unlocks and equipment are written to the database by the server. Guests play offline in the browser and their progress stays there.
- Co-op worlds are joined by **three hero faces**: the host taps *Open world* and sees three pictures, friends tap the same three in the Multiplayer menu (or open the link).
- Czech and English UI, no ads, no purchases.

Spec: [docs/SPEC.md](docs/SPEC.md) (Czech).

## Run it

```sh
cd server-rs && cargo build --release && cd ..
server-rs/target/release/horde-server    # http://localhost:8080 (PORT, DATA_DIR, APP_ROOT)
cargo test --release --manifest-path server-rs/Cargo.toml   # simulation, drops, chest, merchant
node --test test/*.test.js               # client simulation, shared rules, the API and co-op against the Rust binary
cargo test --release --manifest-path server-rs/Cargo.toml balance -- --ignored --nocapture   # bots play every dungeon, prints clear rates
node tools/gen-data.mjs                  # regenerate server-rs/data.json after editing shared/data.js
docker compose up --build                # the production image, port 8078
```

The whole server (HTTP API, WebSocket rooms, simulation) is Rust in `server-rs/`. `shared/` is what the browser also runs: the game data and the offline (guest) simulation for single player.

Environment: `PORT`, `DATA_DIR` (SQLite database), `TRUST_PROXY=1` behind a reverse proxy, `CORS_ORIGINS` (pages allowed to use the API, e.g. `https://you.github.io`).

## Static copy (GitHub Pages)

`tools/build-pages.sh https://your-server/path/ _site` builds the client for a static host and points it at the server (CORS must allow the site). `tools/build-pages.sh none` builds an offline copy: single player as a guest, progress in the browser. The Pages workflow uses the repository variable `HORDE_API`.

## How it works

- `server-rs/src/sim.rs` is the deterministic simulation (20 Hz, seeded RNG) that runs every signed-in run. `shared/sim.js` is its single-player twin that guests run offline in the browser.
- Co-op: the server is authoritative (hand-written WebSocket, JSON snapshots at 10 Hz limited to what is near the player); the client predicts its own movement.
- Signed-in single-player runs are simulated by the server in a private room, so nothing the client reports counts. Guests keep everything in the browser.
- Sprites are drawn in code, sounds come from Web Audio; no external assets except the UI font.

MIT licensed, see [CREDITS.md](CREDITS.md).
