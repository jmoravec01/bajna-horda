# Bájná horda

A pixel-art survivor game for phones, played in the browser. Move with one thumb, your weapons fire on their own; level up during a run, pick upgrades, and survive until the boss. Characters are from Slavic and Czech folklore.

- **Single player** (3 dungeons) and **co-op for up to 6 players** (3 other dungeons), each mode with its own progression.
- **12 classes** (Krakonoš, Zbojník, Perun, Čert, Bohatýr, Vědma, Hastrman, Polednice, Golem, Rarášek, Morana, Bába Jaga), each with its own weapon and bonus. An account holds up to 8 characters and plays one at a time. Level and gear belong to the character, coins to the account.
- Co-op difficulty follows the **strongest** player in the room, so a level 1 playing with a level 100 has a harder run (and earns a bonus for it).
- Czech and English UI, no ads, no purchases.

Spec: [docs/SPEC.md](docs/SPEC.md) (Czech).

## Run it

```sh
node server/server.js           # http://localhost:8080 (Node 24+, no npm dependencies)
node --test test/*.test.js      # tests
node tools/balance.js           # bots play every dungeon, prints clear rates
docker compose up --build       # the same in a container, port 8078
```

Environment: `PORT`, `DATA_DIR` (SQLite database), `TRUST_PROXY=1` behind a reverse proxy, `CORS_ORIGINS` (pages allowed to use the API, e.g. `https://you.github.io`).

## Static copy (GitHub Pages)

`tools/build-pages.sh https://your-server/path/ _site` builds the client for a static host and points it at the server (CORS must allow the site). `tools/build-pages.sh none` builds an offline copy: single player as a guest, progress in the browser. The Pages workflow uses the repository variable `HORDE_API`.

## How it works

- `shared/sim.js` is a deterministic simulation (20 Hz, seeded RNG). The browser runs it for single player, the server for co-op.
- Co-op: the server is authoritative (hand-written WebSocket, JSON snapshots at 10 Hz limited to what is near the player); the client predicts its own movement.
- Single-player results are checked by the server (signed run ticket, real-time check, plausibility limits). Guests keep everything in the browser.
- Sprites are drawn in code, sounds come from Web Audio; no external assets except the UI font.

MIT licensed, see [CREDITS.md](CREDITS.md).
