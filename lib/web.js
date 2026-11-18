// Companion plugin: serves the yangmao board's JSON API — plus a
// standalone board page — on the dsh WebServer:
//
//   GET  /plugins/yangmao           the board page (single-file HTML)
//   GET  /plugins/yangmao/api/state deals (unexpired) + boards + stats
//   POST /plugins/yangmao/api/mark  {target, id, mark, value}
//
// The primary UI is the client half (lib/client.js): a sidebar panel
// (sidebar.panellist id 'yangmao') opening the board as a full page in
// the keyed `main` slot, fed by the /api routes above. The HTML page on
// this route remains as a direct/fallback page for opening the board
// outside the Web UI shell. These routes are plain HTTP on the same
// origin as the Web UI — they inherit whatever network exposure the
// host's webServer bind has (loopback by default).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExpired } from './store.js';

export const name = 'yangmao-web';
export const inject = ['webServer', 'yangmao'];

export const PAGE_PATH = '/plugins/yangmao';

const here = path.dirname(fileURLToPath(import.meta.url));
let pageHtml = null;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createHandler(store) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const rest = url.pathname.slice(PAGE_PATH.length) || '/';
      if (req.method === 'GET' && (rest === '/' || rest === '')) {
        pageHtml ??= await fs.readFile(path.join(here, 'board.html'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(pageHtml);
        return;
      }
      if (req.method === 'GET' && rest === '/api/state') {
        sendJson(res, 200, {
          deals: store.data.deals.filter((d) => !isExpired(d)),
          boards: store.data.boards,
          stats: store.stats(),
        });
        return;
      }
      if (req.method === 'POST' && rest === '/api/mark') {
        const body = JSON.parse(await readBody(req) || '{}');
        const { target, id, mark, value } = body;
        if (target === 'deal') await store.markDeal(id, mark, value);
        else if (mark === 'read') await store.markBoardRead(target, id, value);
        else throw new Error(`unsupported mark request: ${JSON.stringify(body)}`);
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 404, { error: 'not found', path: url.pathname });
    } catch (err) {
      sendJson(res, 400, { error: String(err?.message ?? err) });
    }
  };
}

export function apply(ctx) {
  const handler = createHandler(ctx.yangmao);
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: PAGE_PATH, handler }),
    'yangmao: board routes',
  );
  console.log(`[yangmao] board page at ${PAGE_PATH}`);
}
