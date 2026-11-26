// Builds a small known database (a seeded account with a fixed session token) for recording and replaying HTTP cases.
// usage: node tools/seed-fixture.mjs <dir>
import { mkdirSync, rmSync } from 'node:fs';
const dir = process.argv[2] || '.rec/data';
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
process.env.DATA_DIR = dir;
const { db, q, createUser, hashPassword, sha256 } = await import('../server/db.js');
const id = createUser('Seeded', await hashPassword('secret1'));
db.prepare("UPDATE users SET room = 'SEED1', coins = 5000 WHERE id = ?").run(id);
q.insSession.run(sha256('recording-token-0001'), id, Date.now() + 365 * 864e5);
q.insChar.run(id, 'Alfa', 'krakonos', 1); q.insChar.run(id, 'Beta', 'morana', 2);
db.prepare('UPDATE chars SET level = 7, xp = 40 WHERE name = ?').run('Alfa');
console.log('fixture written to', dir);
