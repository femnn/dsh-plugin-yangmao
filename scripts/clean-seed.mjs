// One-time seed purge (public-release compliance): remove the `vps`
// board and every sensitive entry from seed/yangmao-seed.json, using
// the shared rules in lib/sensitive.js — the same rules the store
// applies at load time and on the write paths, so a cleaned seed and a
// cleaned live data file converge to exactly the same state. The rule
// set was tuned against a manual review of every seed entry; running
// this script on the already-cleaned seed is a no-op.
//
// Usage: node scripts/clean-seed.mjs [--dry-run]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { purgeSensitiveData, filterSensitiveItems } from '../lib/sensitive.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedFile = path.join(here, '..', 'seed', 'yangmao-seed.json');
const dryRun = process.argv.includes('--dry-run');

const data = JSON.parse(readFileSync(seedFile, 'utf8'));
const before = {
  deals: data.deals.length,
  radar: data.boards.radar.length,
  tokens: data.boards.tokens.length,
  vps: data.boards.vps?.length ?? 0,
};

// Report what the rules drop (titles, for review) before mutating.
for (const sec of ['deals', 'radar', 'tokens']) {
  const items = sec === 'deals' ? data.deals : data.boards[sec];
  for (const { item, hit } of filterSensitiveItems(items).dropped) {
    console.log(`[rule <${hit}>] ${sec}#${item.id} ${item.title ?? item.provider ?? ''}`);
  }
}

const counts = purgeSensitiveData(data);

const after = {
  deals: data.deals.length,
  radar: data.boards.radar.length,
  tokens: data.boards.tokens.length,
  vps: 0,
};
console.log('\nbefore:', JSON.stringify(before));
console.log('after: ', JSON.stringify(after));
console.log('dropped:', JSON.stringify(counts));

if (dryRun) {
  console.log('(dry run, seed file untouched)');
} else {
  writeFileSync(seedFile, JSON.stringify(data, null, 1) + '\n', 'utf8');
  console.log('seed rewritten:', seedFile);
}
