// Headless self-test for lib/client.js (the yangmao client half).
//
// Loads the __ModuleLoader__ bundle in a vm sandbox with stubbed
// window / fetch, a stub Cordis ctx (slots / locale / effect), and a
// minimal React hook runtime — then asserts:
//   1. module shell: id === package name, factory returns { inject, apply }
//   2. apply registers the 'yangmao' dictionaries via ctx.effect
//   3. apply injects exactly 'main' + 'sidebar.panellist', and invoking
//      the inject callbacks registers both slots with the exact options
//      (main: key/locale; panellist: id/order/locale/label)
//   4. the icon component renders an <svg> sized by the host's `size`
//   5. the page component: loading state -> loaded state (featured
//      ordering: unclaimed before claimed), mark button issues the
//      right POST and flips local state, radar tab renders, search
//      filters, and a rejecting fetch yields the error state (no blank)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientCode = readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');

let passed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok -', msg); }
  else { failures.push(msg); console.log('  FAIL -', msg); }
}

// ---------- fetch behaviour (swappable) ----------
const fetchCalls = [];
let fetchBehavior = async () => { throw new Error('fetch not stubbed'); };
const fakeState = {
  deals: [
    {
      id: 1, category: 'llm', title: '甲渠道免费额度', benefit: '送100万Token',
      how_to: '官网注册领取', platform: '甲云', card_req: '', restrictions: '',
      source_name: '甲云官网', source_url: 'https://example.com/a', valid_text: '长期',
      valid_until: '', strength: 60, featured: false, claimed: false, saved: false,
      verified_at: '2026-11-10T00:00:00.000Z',
    },
    {
      id: 2, category: 'food', title: '乙餐厅买一送一', benefit: '买一送一',
      how_to: '', platform: '乙餐厅', card_req: '', restrictions: '',
      source_name: '乙餐厅官微', source_url: 'https://example.com/b', valid_text: '',
      valid_until: '', strength: 90, featured: false, claimed: true, saved: false,
      verified_at: '2026-11-17T00:00:00.000Z',
    },
  ],
  boards: {
    radar: [{
      id: 5, title: '雷达帖一则', summary: '社区线索', source_url: 'https://example.com/r',
      source_name: 'LINUX DO', verified_at: '2026-11-18T00:00:00.000Z', read: false,
    }],
    tokens: [],
    vps: [],
  },
  stats: { total_deals: 2, live_deals: 2, boards: { radar: 1, tokens: 0, vps: 0 }, last_refreshed_at: '2026-11-18T01:00:00.000Z' },
};

// ---------- minimal React hook runtime ----------
function createReactRuntime() {
  const state = { hooks: [], idx: 0, tree: null, component: null, props: null };
  function render() {
    state.idx = 0;
    const queued = [];
    state.pendingEffects = queued;
    state.tree = state.component(state.props);
    state.pendingEffects = [];
    for (const fn of queued) fn();
  }
  const React = {
    createElement(type, props, ...children) {
      const flat = [];
      const push = (c) => { if (Array.isArray(c)) c.forEach(push); else flat.push(c); };
      children.forEach(push);
      return { type, props: props || {}, children: flat };
    },
    useState(init) {
      const i = state.idx++;
      if (!(i in state.hooks)) state.hooks[i] = typeof init === 'function' ? init() : init;
      const set = (v) => {
        state.hooks[i] = typeof v === 'function' ? v(state.hooks[i]) : v;
        render();
      };
      return [state.hooks[i], set];
    },
    useEffect(fn, deps) {
      const i = state.idx++;
      const prev = state.hooks[i];
      const changed = !prev || !deps || !prev.deps || deps.some((d, j) => d !== prev.deps[j]);
      if (changed) {
        state.hooks[i] = { deps: deps ? [...deps] : deps };
        state.pendingEffects.push(() => { fn(); });
      }
    },
  };
  return {
    React,
    mount(component, props) { state.component = component; state.props = props; render(); },
    tree: () => state.tree,
  };
}

// ---------- tree helpers ----------
function collectStrings(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (typeof node !== 'object') return out;
  for (const c of node.children || []) collectStrings(c, out);
  return out;
}
function findNodes(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) findNodes(c, pred, out);
  return out;
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5)); };

// ---------- load the bundle ----------
let captured = null;
const sandbox = {
  window: { __ModuleLoader__: { load(spec) { captured = spec; } } },
  fetch: (...args) => fetchBehavior(...args),
  console,
};
vm.runInNewContext(clientCode, sandbox, { filename: 'client.js' });

console.log('[shell]');
assert(captured && typeof captured === 'object', '__ModuleLoader__.load was called');
assert(captured.id === 'dsh-plugin-yangmao', `module id === package name (got ${captured && captured.id})`);
assert(typeof captured.factory === 'function', 'factory is a function');

const runtime = createReactRuntime();
const makeRequire = (React) => (name) => {
  if (name === 'react') return React;
  throw new Error('client half must not require anything but react, got: ' + name);
};
const mod = captured.factory(makeRequire(runtime.React));
assert(Array.isArray(mod.inject) && mod.inject.join(',') === 'slots,locale', `factory returns inject ['slots','locale'] (got ${JSON.stringify(mod.inject)})`);
assert(typeof mod.apply === 'function', 'factory returns apply()');

// ---------- apply() against a stub ctx ----------
console.log('[apply]');
let dictRegistered = null;
const effectLabels = [];
const slotInjects = [];
const slotRegisters = [];
const ctxStub = {
  locale: {
    bind() {
      return (key, params) => {
        const text = (dictRegistered && dictRegistered.dicts.zh[key]) ?? key;
        return params ? text.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k]))) : text;
      };
    },
    register(ns, dicts) { dictRegistered = { ns, dicts }; return () => {}; },
  },
  effect(fn, label) { effectLabels.push(label); return fn(); },
  slots: {
    inject(name, cb) { slotInjects.push({ name, cb }); return () => {}; },
    register(options, component) { slotRegisters.push({ options, component }); return () => {}; },
  },
};
mod.apply(ctxStub);
assert(dictRegistered && dictRegistered.ns === 'yangmao', 'locale.register called with namespace yangmao');
assert(dictRegistered && dictRegistered.dicts.zh.panel === '薅羊毛情报', 'zh dictionary has panel=薅羊毛情报');
assert(dictRegistered && typeof dictRegistered.dicts.en.panel === 'string' && dictRegistered.dicts.en.panel.length > 0, 'en dictionary present');
assert(effectLabels.includes('yangmao: dictionaries'), 'dictionaries registered via ctx.effect');
assert(slotInjects.map((s) => s.name).join(',') === 'main,sidebar.panellist',
  `slots.inject called for main + sidebar.panellist (got ${slotInjects.map((s) => s.name).join(',')})`);
for (const { cb } of slotInjects) cb();
assert(slotRegisters.length === 2, `exactly 2 slot registrations (got ${slotRegisters.length})`);
const mainReg = slotRegisters.find((r) => r.options.name === 'main');
const sideReg = slotRegisters.find((r) => r.options.name === 'sidebar.panellist');
assert(mainReg && mainReg.options.key === 'yangmao' && mainReg.options.locale === 'yangmao',
  `main registration { key: 'yangmao', locale: 'yangmao' } (got ${JSON.stringify(mainReg && mainReg.options)})`);
assert(typeof (mainReg && mainReg.component) === 'function', 'main registration carries a component');
assert(sideReg && sideReg.options.id === 'yangmao' && sideReg.options.order === 30 && sideReg.options.locale === 'yangmao',
  `panellist registration { id: 'yangmao', order: 30, locale: 'yangmao' } (got ${JSON.stringify(sideReg && sideReg.options)})`);
assert(sideReg && typeof sideReg.options.label === 'function' && sideReg.options.label() === '薅羊毛情报',
  'panellist label() resolves through the dictionary');

// ---------- icon component ----------
console.log('[icon]');
const iconTree = sideReg.component({ size: 16, active: true });
assert(iconTree.type === 'svg' && iconTree.props.width === 16 && iconTree.props.height === 16,
  'icon renders an <svg> at the host-provided size');

// ---------- page component: loading -> loaded -> mark -> tabs ----------
console.log('[page]');
fetchBehavior = async (url, opts) => {
  fetchCalls.push({ url, opts });
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(fakeState)) };
};
const t = ctxStub.locale.bind('yangmao');
runtime.mount(mainReg.component, { t });
let strings = collectStrings(runtime.tree());
assert(strings.some((s) => s.includes('加载中')), 'initial render shows the loading state');
await flush();
strings = collectStrings(runtime.tree());
assert(strings.some((s) => s.includes('甲渠道免费额度')), 'loaded render shows deal A');
assert(strings.some((s) => s.includes('乙餐厅买一送一')), 'loaded render shows deal B');
assert(strings.join('\n').indexOf('甲渠道免费额度') < strings.join('\n').indexOf('乙餐厅买一送一'),
  'featured ordering: unclaimed deal A before already-claimed deal B');
assert(fetchCalls.length === 1 && fetchCalls[0].url === '/plugins/yangmao/api/state',
  'page fetched GET /plugins/yangmao/api/state');

const markBtn = findNodes(runtime.tree(), (n) => n.type === 'button'
  && collectStrings(n).some((s) => s === '标记已领取'))[0];
assert(!!markBtn, 'an unclaimed deal shows a 标记已领取 button');
await markBtn.props.onClick();
await flush();
const post = fetchCalls.find((c) => c.opts && c.opts.method === 'POST');
assert(!!post && post.url === '/plugins/yangmao/api/mark', 'mark issues POST /plugins/yangmao/api/mark');
assert(post && JSON.stringify(JSON.parse(post.opts.body)) === JSON.stringify({ target: 'deal', id: 1, mark: 'claimed', value: true }),
  `mark body is {target:'deal', id:1, mark:'claimed', value:true} (got ${post && post.opts.body})`);
strings = collectStrings(runtime.tree());
assert(!strings.some((s) => s === '标记已领取'), 'after marking, no 标记已领取 button remains (both deals claimed)');
const cardA = findNodes(runtime.tree(), (n) => n.type === 'article'
  && collectStrings(n).some((s) => s.includes('甲渠道免费额度')))[0];
assert(cardA && cardA.props.style && cardA.props.style.opacity === 0.55, 'claimed card A is dimmed (opacity .55)');

const radarTab = findNodes(runtime.tree(), (n) => n.type === 'button'
  && collectStrings(n).some((s) => s === '雷达帖'))[0];
assert(!!radarTab, 'radar tab button exists');
radarTab.props.onClick();
strings = collectStrings(runtime.tree());
assert(strings.some((s) => s.includes('雷达帖一则')), 'radar tab renders radar items');
assert(strings.some((s) => s.includes('社区帖，未经官网核实')), 'radar items carry the unverified note');

const allTab = findNodes(runtime.tree(), (n) => n.type === 'button'
  && collectStrings(n).some((s) => s === '全部'))[0];
allTab.props.onClick();
const input = findNodes(runtime.tree(), (n) => n.type === 'input')[0];
assert(!!input, 'search input exists');
input.props.onChange({ target: { value: '甲渠道' } });
strings = collectStrings(runtime.tree());
assert(strings.some((s) => s.includes('甲渠道免费额度')) && !strings.some((s) => s.includes('乙餐厅买一送一')),
  'search filters the deal list by keyword');

// ---------- page component: error state ----------
console.log('[page error path]');
const runtime2 = createReactRuntime();
const mod2 = captured.factory(makeRequire(runtime2.React));
let dict2 = null;
const injects2 = [];
const registers2 = [];
const ctx2 = {
  locale: {
    bind() { return (key, params) => { const text = (dict2 && dict2.dicts.zh[key]) ?? key; return params ? text.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k]))) : text; }; },
    register(ns, dicts) { dict2 = { ns, dicts }; return () => {}; },
  },
  effect(fn) { return fn(); },
  slots: {
    inject(name, cb) { injects2.push({ name, cb }); return () => {}; },
    register(options, component) { registers2.push({ options, component }); return () => {}; },
  },
};
mod2.apply(ctx2);
for (const { cb } of injects2) cb();
const mainReg2 = registers2.find((r) => r.options.name === 'main');
assert(!!mainReg2, 'second factory instance registers its own main component');
fetchBehavior = async () => { throw new Error('network down'); };
runtime2.mount(mainReg2.component, { t: ctx2.locale.bind('yangmao') });
await flush();
strings = collectStrings(runtime2.tree());
assert(strings.some((s) => s.includes('加载失败')), 'fetch failure renders the error state instead of a blank page');
assert(strings.some((s) => s.includes('重试')), 'error state offers a retry button');

console.log(`\nselftest-client: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
