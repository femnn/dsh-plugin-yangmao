// dsh-plugin-yangmao — host (Node) half.
//
// Provides:
// - the `yangmao` service: a YangmaoStore over a JSON data file, seeded on
//   first run from seed/yangmao-seed.json (all user marks reset);
// - the yangmao_* agent tools (search / featured / boards / add / mark /
//   apply_refresh / stats);
// - the `yangmao-refresh` skill carrying the board's data rules.
//
// The board web page lives in the companion plugin `./web`
// (dsh-plugin-yangmao/web), which depends on this service and on webServer.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { YangmaoStore } from './store.js';
import { registerTools } from './tools.js';
import { SKILL } from './skill.js';

export const name = 'yangmao';
export const inject = ['tools', 'skills'];

export const Config = z.object({
  // Directory holding the mutable data.json. Default:
  // $DSH_HOME/plugins/yangmao (or ~/.dsh/plugins/yangmao).
  dataDir: z.string(),
});

const here = path.dirname(fileURLToPath(import.meta.url));

export function resolveDataFile(config = {}) {
  if (config.dataDir) return path.join(config.dataDir, 'data.json');
  const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'plugins', 'yangmao', 'data.json');
}

export async function apply(ctx, config) {
  const store = await new YangmaoStore(
    resolveDataFile(config),
    path.join(here, '..', 'seed', 'yangmao-seed.json'),
  ).init();
  ctx.effect(() => ctx.provide('yangmao', store), 'yangmao: store service');
  registerTools(ctx, store);
  ctx.effect(() => ctx.skills.register(SKILL), 'yangmao: refresh skill');
  const s = store.stats();
  console.log(`[yangmao] ready: ${s.total_deals} deals, boards radar=${s.boards.radar} tokens=${s.boards.tokens} vps=${s.boards.vps}, data at ${store.dataFile}`);
}
