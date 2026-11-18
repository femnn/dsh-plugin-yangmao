// Yangmao data store: a single JSON document on disk.
//
// The store owns the whole board state (deals + the three boards + user
// marks). It is deliberately boring: load once, mutate in memory, persist
// atomically (tmp file + rename) after every mutation. First run seeds the
// data file from the bundled snapshot (seed/yangmao-seed.json), whose user
// marks are all reset — a published package never carries anyone's personal
// claimed/saved state.
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const CATEGORIES = ['food', 'shop', 'telecom', 'bank', 'member', 'cloud', 'llm'];
export const BOARD_NAMES = ['radar', 'tokens', 'vps'];

export const DEAL_FIELDS = [
  'category', 'title', 'benefit', 'how_to', 'platform', 'card_req',
  'restrictions', 'source_name', 'source_url', 'valid_text', 'valid_until',
  'strength', 'featured',
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** A deal is expired when its valid_until date is before today. */
export function isExpired(deal, on = today()) {
  return typeof deal.valid_until === 'string' && deal.valid_until !== '' && deal.valid_until < on;
}

function matchesKeyword(item, keyword, fields) {
  if (!keyword) return true;
  const hay = fields.map((f) => String(item[f] ?? '')).join('\n').toLowerCase();
  return hay.includes(keyword.toLowerCase());
}

export class YangmaoStore {
  /**
   * @param {string} dataFile - absolute path of the mutable data JSON.
   * @param {string} seedFile - absolute path of the bundled seed JSON.
   */
  constructor(dataFile, seedFile) {
    this.dataFile = dataFile;
    this.seedFile = seedFile;
    this.data = null;
  }

  async init() {
    try {
      this.data = JSON.parse(await fs.readFile(this.dataFile, 'utf8'));
    } catch {
      const seed = JSON.parse(await fs.readFile(this.seedFile, 'utf8'));
      this.data = seed;
      await this.save();
    }
    if (!this.data.boards) this.data.boards = { radar: [], tokens: [], vps: [] };
    if (!this.data.meta || typeof this.data.meta !== 'object') this.data.meta = {};
    return this;
  }

  /**
   * Plugin-level metadata persisted alongside the board (currently the
   * auto-refresh task id and its user-removed tombstone). Older data
   * files have no `meta` object; missing keys read as undefined.
   */
  getMeta(key) {
    return this.data.meta ? this.data.meta[key] : undefined;
  }

  async setMeta(key, value) {
    if (!this.data.meta || typeof this.data.meta !== 'object') this.data.meta = {};
    if (value === undefined) delete this.data.meta[key];
    else this.data.meta[key] = value;
    await this.save();
  }

  async save() {
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    const tmp = `${this.dataFile}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 1), 'utf8');
    await fs.rename(tmp, this.dataFile);
  }

  /** Live (unexpired) deals, optionally filtered. Claimed items sink last. */
  listDeals({ category, keyword, includeExpired = false, limit = 50 } = {}) {
    let out = this.data.deals.filter((d) => includeExpired || !isExpired(d));
    if (category) out = out.filter((d) => d.category === category);
    if (keyword) {
      out = out.filter((d) => matchesKeyword(d, keyword,
        ['title', 'benefit', 'how_to', 'platform', 'source_name', 'restrictions']));
    }
    out.sort((a, b) =>
      Number(a.claimed) - Number(b.claimed) ||
      (b.strength ?? 0) - (a.strength ?? 0) ||
      String(b.verified_at).localeCompare(String(a.verified_at)));
    return out.slice(0, limit);
  }

  /** Today's picks: most recently verified, unexpired, unclaimed first. */
  featured({ limit = 10 } = {}) {
    const out = this.data.deals
      .filter((d) => !isExpired(d))
      .sort((a, b) =>
        Number(a.claimed) - Number(b.claimed) ||
        String(b.verified_at).localeCompare(String(a.verified_at)) ||
        (b.strength ?? 0) - (a.strength ?? 0));
    return out.slice(0, limit);
  }

  listBoard(board, { keyword, limit = 50 } = {}) {
    if (!BOARD_NAMES.includes(board)) throw new Error(`unknown board: ${board}`);
    let out = [...this.data.boards[board]];
    if (keyword) {
      out = out.filter((it) => matchesKeyword(it, keyword,
        ['title', 'summary', 'provider', 'plan', 'detail', 'amount', 'source_name', 'location', 'specs']));
    }
    out.sort((a, b) => String(b.verified_at ?? '').localeCompare(String(a.verified_at ?? '')));
    return out.slice(0, limit);
  }

  async addDeal(fields) {
    const now = new Date().toISOString();
    const id = this.data.deals.reduce((m, d) => Math.max(m, d.id ?? 0), 0) + 1;
    const deal = { id, claimed: false, saved: false, verified_at: now };
    for (const f of DEAL_FIELDS) deal[f] = fields[f] ?? (f === 'strength' ? 50 : f === 'featured' ? false : '');
    if (!CATEGORIES.includes(deal.category)) throw new Error(`invalid category: ${deal.category}`);
    if (!deal.title) throw new Error('title is required');
    this.data.deals.push(deal);
    await this.save();
    return deal;
  }

  async markDeal(id, mark, value) {
    if (!['claimed', 'saved'].includes(mark)) throw new Error(`invalid deal mark: ${mark}`);
    const deal = this.data.deals.find((d) => d.id === id);
    if (!deal) throw new Error(`deal not found: ${id}`);
    deal[mark] = Boolean(value);
    await this.save();
    return deal;
  }

  async markBoardRead(board, id, value = true) {
    if (!BOARD_NAMES.includes(board)) throw new Error(`unknown board: ${board}`);
    const item = this.data.boards[board].find((it) => it.id === id);
    if (!item) throw new Error(`${board} item not found: ${id}`);
    item.read = Boolean(value);
    await this.save();
    return item;
  }

  /**
   * Refresh write-back, mirroring the original board's applyrefresh:
   * - upserts: deals matched by title — update fields and stamp verified_at;
   *   unmatched titles are inserted as new deals.
   * - retire_titles: deals whose activity ended are removed.
   * - confirmed_titles: deals re-verified unchanged get a fresh verified_at.
   * Expired deals (valid_until before today) are dropped at the end, and
   * last_refreshed_at is stamped. User marks on surviving deals are kept.
   */
  async applyRefresh({ upserts = [], retire_titles = [], confirmed_titles = [] } = {}) {
    const now = new Date().toISOString();
    let added = 0; let updated = 0; let retired = 0; let confirmed = 0;
    const byTitle = new Map(this.data.deals.map((d) => [d.title, d]));
    for (const up of upserts) {
      if (!up || !up.title) continue;
      const existing = byTitle.get(up.title);
      if (existing) {
        for (const f of DEAL_FIELDS) if (up[f] !== undefined) existing[f] = up[f];
        existing.verified_at = now;
        updated++;
      } else {
        const id = this.data.deals.reduce((m, d) => Math.max(m, d.id ?? 0), 0) + 1;
        const deal = { id, claimed: false, saved: false, verified_at: now };
        for (const f of DEAL_FIELDS) deal[f] = up[f] ?? (f === 'strength' ? 50 : f === 'featured' ? false : '');
        this.data.deals.push(deal);
        byTitle.set(deal.title, deal);
        added++;
      }
    }
    if (retire_titles.length) {
      const drop = new Set(retire_titles);
      const before = this.data.deals.length;
      this.data.deals = this.data.deals.filter((d) => !drop.has(d.title));
      retired = before - this.data.deals.length;
    }
    for (const title of confirmed_titles) {
      const deal = this.data.deals.find((d) => d.title === title);
      if (deal) { deal.verified_at = now; confirmed++; }
    }
    const beforeDrop = this.data.deals.length;
    this.data.deals = this.data.deals.filter((d) => !isExpired(d));
    const droppedExpired = beforeDrop - this.data.deals.length;
    this.data.last_refreshed_at = now;
    await this.save();
    return { added, updated, retired, confirmed, dropped_expired: droppedExpired, total: this.data.deals.length, last_refreshed_at: now };
  }

  stats() {
    const deals = this.data.deals;
    const byCategory = {};
    for (const c of CATEGORIES) byCategory[c] = deals.filter((d) => d.category === c).length;
    return {
      total_deals: deals.length,
      live_deals: deals.filter((d) => !isExpired(d)).length,
      expired_deals: deals.filter((d) => isExpired(d)).length,
      claimed: deals.filter((d) => d.claimed).length,
      saved: deals.filter((d) => d.saved).length,
      by_category: byCategory,
      boards: Object.fromEntries(BOARD_NAMES.map((b) => [b, this.data.boards[b].length])),
      last_refreshed_at: this.data.last_refreshed_at ?? null,
      snapshot_at: this.data.snapshot_at ?? null,
    };
  }
}
