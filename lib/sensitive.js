// Sensitive-content rules for the yangmao board (public-release
// compliance): the plugin must not carry VPS / cloud-server offers, or
// services that are not permitted for use in mainland China — proxies,
// VPNs, circumvention subscriptions, overseas bank accounts, overseas
// phone numbers, overseas IaaS free tiers, and the like.
//
// This module is the single source of the rules. It is used by:
// - scripts/clean-seed.mjs  (one-time seed purge),
// - YangmaoStore.init()     (load-time purge of existing data files),
// - YangmaoStore.addDeal() / applyRefresh() (write-path drop).
//
// Matching is a case-insensitive substring scan over the item's content
// fields. Source name / source URL are deliberately NOT scanned: a
// source's name says nothing about the item's content (a deals blog
// literally called "VPS录" can carry a domestic LLM-token deal).
// The whole `vps` board is removed separately (see purgeSensitiveData).

export const SENSITIVE_FIELDS = [
  'title', 'benefit', 'how_to', 'platform', 'card_req', 'restrictions',
  'summary', 'detail', 'provider', 'plan', 'amount', 'location', 'specs',
];

// Plain substrings (matched case-insensitively).
export const SENSITIVE_KEYWORDS = [
  // VPS / cloud servers / cloud hosts ('轻量' is the lightweight-server
  // product-line name at 腾讯云/阿里云/华为云; every occurrence in the
  // seed is a server offer). 'ai电脑' is the cloud-PC product name
  // (天翼云AI电脑); '免费试用中心' is the IaaS trial-center phrasing —
  // both verified to hit only server-class entries in the seed.
  'vps', '服务器', '云主机', '轻量', 'flexus', 'ai电脑', '免费试用中心',
  // proxies, VPNs, circumvention tooling & subscriptions
  '代理ip', '代理服务', '代理节点', '网络代理', '翻墙', '科学上网', '梯子',
  'shadowsocks', 'v2ray', 'xray', 'trojan', 'clash',
  '机场订阅', '节点订阅', '代理订阅', 'socks5', 'socks 代理',
  '原生ip', '住宅ip', '家宽', '双isp', '落地机',
  // overseas IaaS / cloud vendors (their free tiers included)
  'oracle cloud', '甲骨文', 'digitalocean', 'vultr', 'linode', 'hetzner',
  '搬瓦工', 'racknerd', 'cloudcone', '海外云', '境外云',
  // overseas bank accounts / fintech accounts
  '海外银行', '境外银行', '海外账户', '境外账户', '离岸账户',
  'wise', 'revolut', 'payoneer', '万里汇', '空中云汇', 'airwallex',
  'starryblu', 'nexone',
  // overseas phone numbers / SIMs
  '海外手机', '境外手机', 'google voice', 'textnow', 'giffgaff',
  'clubsim', 'tello', '3hk',
];

// Tokens that need word-ish boundaries so they do not fire inside
// unrelated words.
export const SENSITIVE_WORD_PATTERNS = [
  /\becs\b/i, // 阿里云 ECS
  /\bcvm\b/i, // 腾讯云 CVM
  /\bvpn\b/i,
  /\baws\b/i,
  /\bgcp\b/i,
];

function itemText(item) {
  return SENSITIVE_FIELDS.map((f) => String(item?.[f] ?? '')).join('\n').toLowerCase();
}

/** The matched keyword/pattern source, or null when the item is clean. */
export function sensitiveHit(item) {
  const hay = itemText(item);
  for (const kw of SENSITIVE_KEYWORDS) {
    if (hay.includes(kw)) return kw;
  }
  for (const re of SENSITIVE_WORD_PATTERNS) {
    if (re.test(hay)) return re.source;
  }
  return null;
}

export function isSensitiveItem(item) {
  return sensitiveHit(item) !== null;
}

/** Split a list into { kept, dropped: [{ item, hit }] }. */
export function filterSensitiveItems(items) {
  const kept = [];
  const dropped = [];
  for (const item of items ?? []) {
    const hit = sensitiveHit(item);
    if (hit) dropped.push({ item, hit });
    else kept.push(item);
  }
  return { kept, dropped };
}

/**
 * Purge a whole board data document in place: the `vps` board is
 * removed entirely; deals and the remaining boards are keyword-filtered.
 * Returns per-section dropped counts (vps counts every removed item).
 */
export function purgeSensitiveData(data) {
  const counts = { deals: 0, radar: 0, tokens: 0, vps: 0 };
  if (!data || typeof data !== 'object') return counts;
  const deals = filterSensitiveItems(data.deals);
  data.deals = deals.kept;
  counts.deals = deals.dropped.length;
  if (data.boards && typeof data.boards === 'object') {
    if (Array.isArray(data.boards.vps)) counts.vps = data.boards.vps.length;
    delete data.boards.vps;
    for (const board of ['radar', 'tokens']) {
      if (!Array.isArray(data.boards[board])) continue;
      const r = filterSensitiveItems(data.boards[board]);
      data.boards[board] = r.kept;
      counts[board] = r.dropped.length;
    }
  }
  return counts;
}
