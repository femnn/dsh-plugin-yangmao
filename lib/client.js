// dsh-plugin-yangmao — client half (Web UI).
//
// Standard dsh panel plugin, following the slot model of dsh 0.2.x:
//
//   - `sidebar.panellist` (list slot): one panel row, id 'yangmao',
//     order 30. The sidebar owns the button; we only supply the icon
//     component and the `label` metadata.
//   - `main` (keyed slot): the board page, key 'yangmao'. `main` is
//     dispatched by the sidebar's active panel id — with no panel
//     selected the host falls back to key 'conversation', so this page
//     and the conversation view are two keys of the same slot.
//
// The page is hand-written React on the `react` baseline only. No
// @deepseek-ai client package is required here: those drift between
// versions, and a throwing component blanks its slot. Data comes from
// the host companion plugin's same-origin JSON API (lib/web.js):
//
//   GET  /plugins/yangmao/api/state   deals (unexpired) + boards + stats
//                                     + auto (auto-refresh task status)
//   POST /plugins/yangmao/api/mark    { target, id, mark, value }
//   POST /plugins/yangmao/api/refresh-now   run the refresh task now
//
// The header carries a 立即更新 button and the auto-refresh status line;
// while the page is open it re-fetches /api/state every 60 seconds so a
// finished background refresh shows up without a manual reload.
//
// The host route GET /plugins/yangmao (lib/board.html) stays as a
// direct/fallback page for opening the board outside the Web UI shell.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-yangmao',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'yangmao';
    const PANEL_ID = 'yangmao';
    const API = '/plugins/yangmao';

    const zh = {
      panel: '薅羊毛情报',
      title: '薅羊毛情报',
      loading: '加载中…',
      loadFailed: '加载失败：{error}',
      retry: '重试',
      searchPlaceholder: '搜索标题 / 权益 / 平台…',
      featured: '今日精选',
      all: '全部',
      cat_food: '美食',
      cat_shop: '购物',
      cat_telecom: '通信',
      cat_bank: '银行',
      cat_member: '会员',
      cat_cloud: '云服务',
      cat_llm: '大模型',
      board_radar: '雷达帖',
      board_tokens: 'Token 总汇',
      markClaimed: '标记已领取',
      claimed: '已领取 ✓',
      stampClaimed: '已领取',
      stampRead: '已读',
      save: '收藏',
      saved: '已收藏 ★',
      markRead: '标记已读',
      read: '已读 ✓',
      empty: '没有符合条件的条目。',
      howTo: '领法：{text}',
      fromLine: '来源：{source}',
      verifiedAt: '核查于 {date}',
      radarNote: '社区帖，未经官网核实',
      meta: '主清单 {total} 条（在架 {live}）· 雷达 {radar} · Token {tokens} · 最近复核 {refreshed}',
      markFailed: '标记失败：{error}',
      fallbackHint: '页面版打不开时，可直接访问 /plugins/yangmao',
      refreshNow: '立即更新',
      refreshing: '正在发起…',
      autoOn: '每 12 小时自动更新 · 下次 {time}',
      autoOff: '自动更新未开启',
      autoUnavailable: '自动更新不可用（宿主未提供定时任务服务）',
      refreshFailed: '发起更新失败：{error}',
    };

    const en = {
      panel: 'Yangmao Deals',
      title: 'Yangmao Deals',
      loading: 'Loading…',
      loadFailed: 'Failed to load: {error}',
      retry: 'Retry',
      searchPlaceholder: 'Search title / benefit / platform…',
      featured: 'Featured',
      all: 'All',
      cat_food: 'Food',
      cat_shop: 'Shopping',
      cat_telecom: 'Telecom',
      cat_bank: 'Banking',
      cat_member: 'Membership',
      cat_cloud: 'Cloud',
      cat_llm: 'LLM',
      board_radar: 'Radar',
      board_tokens: 'Tokens',
      markClaimed: 'Mark claimed',
      claimed: 'Claimed ✓',
      stampClaimed: 'CLAIMED',
      stampRead: 'READ',
      save: 'Save',
      saved: 'Saved ★',
      markRead: 'Mark read',
      read: 'Read ✓',
      empty: 'No matching entries.',
      howTo: 'How: {text}',
      fromLine: 'Source: {source}',
      verifiedAt: 'verified {date}',
      radarNote: 'Community post, not verified on the official site',
      meta: '{total} deals ({live} live) · radar {radar} · tokens {tokens} · last refresh {refreshed}',
      markFailed: 'Mark failed: {error}',
      fallbackHint: 'If this page fails, open the direct page at /plugins/yangmao',
      refreshNow: 'Refresh now',
      refreshing: 'Starting…',
      autoOn: 'Auto-refresh every 12 hours · next {time}',
      autoOff: 'Auto-refresh is off',
      autoUnavailable: 'Auto-refresh unavailable (host has no schedule service)',
      refreshFailed: 'Failed to start refresh: {error}',
    };

    function interpolate(text, params) {
      if (!params) return String(text);
      return String(text).replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])));
    }

    function fmtDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN');
    }

    function fmtDateTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN');
    }

    // Mirrors YangmaoStore.listDeals ordering: claimed sink last.
    function byListOrder(a, b) {
      return Number(a.claimed) - Number(b.claimed)
        || (b.strength ?? 0) - (a.strength ?? 0)
        || String(b.verified_at).localeCompare(String(a.verified_at));
    }

    // Mirrors YangmaoStore.featured ordering: freshest verified first.
    function byFeaturedOrder(a, b) {
      return Number(a.claimed) - Number(b.claimed)
        || String(b.verified_at).localeCompare(String(a.verified_at))
        || (b.strength ?? 0) - (a.strength ?? 0);
    }

    function hit(item, keyword, fields) {
      if (!keyword) return true;
      const hay = fields.map((f) => String(item[f] ?? '')).join('\n').toLowerCase();
      return hay.includes(keyword);
    }

    const DEAL_SEARCH_FIELDS = ['title', 'benefit', 'how_to', 'platform', 'source_name', 'restrictions'];
    const BOARD_SEARCH_FIELDS = ['title', 'summary', 'provider', 'plan', 'detail', 'amount', 'source_name', 'location', 'specs'];
    const CATEGORIES = ['food', 'shop', 'telecom', 'bank', 'member', 'cloud', 'llm'];
    const BOARDS = ['radar', 'tokens'];

    // Parchment theme: the page is a sheet of warm paper laid over the
    // host's dark UI — self-contained palette (no host theme tokens),
    // layered gradients fake the paper grain/fibres, cards are lighter
    // paper with soft stacked shadows, and the accent stays #e8590c.
    const styles = {
      root: {
        height: '100%', overflowY: 'auto', padding: '28px 32px 56px',
        backgroundColor: '#f4ead5',
        backgroundImage: [
          'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(255,253,244,.9), rgba(255,253,244,0) 60%)',
          'repeating-linear-gradient(0deg, rgba(133,100,52,.030) 0px, rgba(133,100,52,.030) 1px, transparent 1px, transparent 4px)',
          'repeating-linear-gradient(90deg, rgba(133,100,52,.024) 0px, rgba(133,100,52,.024) 1px, transparent 1px, transparent 4px)',
        ].join(', '),
        boxShadow: 'inset 0 0 0 1px #e0cfa5, inset 0 0 90px rgba(146,114,60,.20)',
        color: '#3b2f23',
        fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      },
      title: { fontSize: '22px', margin: '0 0 4px', fontWeight: 700, color: '#33271a', letterSpacing: '.5px' },
      rule: { borderTop: '3px double #c8af7e', margin: '10px 0 9px' },
      meta: { fontSize: '12px', color: '#8a7a63', lineHeight: 1.6 },
      autoRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginTop: '10px' },
      autoText: { fontSize: '12px', color: '#8a7a63' },
      refreshBtn: {
        border: '1px solid #cf4f02', background: '#e8590c', color: '#fff',
        borderRadius: '999px', padding: '6px 16px', fontSize: '13px', fontWeight: 600,
        cursor: 'pointer', boxShadow: '0 2px 6px rgba(232,89,12,.35)',
      },
      refreshBtnOff: { opacity: 0.55, cursor: 'default', boxShadow: 'none' },
      refreshMsg: { fontSize: '12px', color: '#c24e02' },
      tabs: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '16px 0 12px' },
      tab: {
        border: '1px solid #d9c69c', background: '#f8f1de', color: '#6b583d',
        borderRadius: '999px', padding: '5px 13px', fontSize: '13px', cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(101,76,38,.08)',
      },
      tabOn: {
        background: '#e8590c', borderColor: '#cf4f02', color: '#fff',
        boxShadow: '0 2px 6px rgba(232,89,12,.30)',
      },
      search: {
        width: '100%', maxWidth: '440px', padding: '9px 12px', borderRadius: '10px',
        border: '1px solid #d9c69c', background: '#efe4c6', color: '#3b2f23',
        fontSize: '14px', marginBottom: '16px', display: 'block', outline: 'none',
        boxShadow: 'inset 0 2px 5px rgba(101,76,38,.18)',
      },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: '14px' },
      card: {
        position: 'relative',
        border: '1px solid #e3d5b8', borderRadius: '14px', padding: '14px 16px',
        background: '#fffaf0',
        boxShadow: '0 1px 2px rgba(101,76,38,.07), 0 10px 26px rgba(101,76,38,.09)',
        display: 'flex', flexDirection: 'column', gap: '7px',
      },
      cardDone: { opacity: 0.6 },
      stamp: {
        position: 'absolute', top: '12px', right: '12px', transform: 'rotate(-8deg)',
        border: '2px solid rgba(179,64,42,.72)', color: '#b3402a', borderRadius: '6px',
        padding: '2px 9px', fontSize: '12px', fontWeight: 700, letterSpacing: '3px',
        background: 'rgba(255,250,240,.82)', pointerEvents: 'none',
      },
      savedMark: { color: '#e8590c', fontSize: '13px', marginRight: '5px' },
      cardTitle: { margin: 0, fontSize: '16px', lineHeight: 1.45, fontWeight: 700, color: '#2e2418' },
      link: { color: 'inherit', textDecoration: 'none' },
      tag: {
        display: 'inline-block', fontSize: '11px', padding: '1px 7px', borderRadius: '999px',
        background: 'rgba(232,89,12,.13)', color: '#c24e02', marginRight: '6px',
        verticalAlign: '2px', fontWeight: 400,
      },
      body: { fontSize: '13px', lineHeight: 1.6, color: '#5d4c36', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      sub: { fontSize: '12px', color: '#8a7a63', lineHeight: 1.55 },
      acts: { marginTop: 'auto', display: 'flex', gap: '8px', paddingTop: '5px' },
      actBtn: {
        border: '1px solid #d9c69c', background: '#f8f1de', color: '#6b583d',
        borderRadius: '8px', padding: '5px 11px', fontSize: '12px', cursor: 'pointer',
      },
      actBtnDone: { background: '#7d6a4a', borderColor: '#7d6a4a', color: '#fff8ea' },
      actBtnSaved: { background: '#e8590c', borderColor: '#cf4f02', color: '#fff' },
      notice: { fontSize: '13px', color: '#c24e02', margin: '0 0 12px' },
      stateBox: { padding: '44px 0', fontSize: '14px', color: '#8a7a63' },
      empty: { padding: '32px 0', fontSize: '14px', color: '#8a7a63' },
    };

    const CSS = [
      '.ym-card { transition: transform .16s ease, box-shadow .16s ease; }',
      '.ym-card:hover { transform: translateY(-2px); box-shadow: 0 2px 3px rgba(101,76,38,.08), 0 16px 34px rgba(101,76,38,.15); }',
      '.ym-tab:hover { border-color: #e8590c; }',
      '.ym-act:hover { border-color: #e8590c; }',
      '.ym-refresh:hover { filter: brightness(1.06); }',
      '.ym-refresh:disabled:hover { filter: none; }',
      '.ym-link:hover { text-decoration: underline; }',
      '.ym-search::placeholder { color: #a8916a; }',
      '.ym-search:focus { border-color: #e8590c; box-shadow: inset 0 2px 5px rgba(101,76,38,.15), 0 0 0 3px rgba(232,89,12,.18); }',
    ].join('\n');

    // Sidebar icon: a price tag (deals). The host passes { size, active };
    // color comes from currentColor so both themes work untouched.
    function YangmaoIcon({ size = 18, active }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
      },
        h('path', {
          d: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z',
          stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
          fill: active ? 'currentColor' : 'none', fillOpacity: active ? 0.16 : 0,
        }),
        h('circle', { cx: 7, cy: 7, r: 1.4, fill: 'currentColor', stroke: 'none' }));
    }

    function YangmaoPage({ t }) {
      const tr = typeof t === 'function' ? t : (key, params) => interpolate(zh[key] ?? key, params);
      const [status, setStatus] = React.useState('loading');
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [tab, setTab] = React.useState('featured');
      const [keyword, setKeyword] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [attempt, setAttempt] = React.useState(0);
      const [refreshing, setRefreshing] = React.useState(false);
      const [refreshMsg, setRefreshMsg] = React.useState('');

      React.useEffect(() => {
        let alive = true;
        setStatus('loading');
        fetch(API + '/api/state')
          .then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then((json) => {
            if (!alive) return;
            setData(json);
            setStatus('ready');
          })
          .catch((e) => {
            if (!alive) return;
            setError(String((e && e.message) || e));
            setStatus('error');
          });
        return () => { alive = false; };
      }, [attempt]);

      // While the page stays open, quietly re-pull state every 60s so a
      // background refresh (scheduled or manual) lands without a reload.
      React.useEffect(() => {
        const timer = setInterval(() => {
          fetch(API + '/api/state')
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => { if (json) setData(json); })
            .catch(() => {});
        }, 60000);
        return () => clearInterval(timer);
      }, []);

      async function refreshNow() {
        if (refreshing) return;
        setRefreshing(true);
        try {
          const r = await fetch(API + '/api/refresh-now', { method: 'POST' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const v = await r.json();
          setRefreshMsg(v.message || '');
        } catch (e) {
          setRefreshMsg(tr('refreshFailed', { error: String((e && e.message) || e) }));
        } finally {
          setRefreshing(false);
        }
      }

      async function mark(target, id, mk, value) {
        try {
          const r = await fetch(API + '/api/mark', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ target, id, mark: mk, value }),
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          setNotice('');
          setData((prev) => {
            if (!prev) return prev;
            if (target === 'deal') {
              return { ...prev, deals: prev.deals.map((d) => (d.id === id ? { ...d, [mk]: value } : d)) };
            }
            return {
              ...prev,
              boards: {
                ...prev.boards,
                [target]: (prev.boards[target] || []).map((it) => (it.id === id ? { ...it, [mk]: value } : it)),
              },
            };
          });
        } catch (e) {
          setNotice(tr('markFailed', { error: String((e && e.message) || e) }));
        }
      }

      function dealCard(d) {
        const sub1 = [d.platform, d.card_req, d.valid_text].filter(Boolean).join(' · ');
        return h('article', { key: 'deal-' + d.id, className: 'ym-card', style: { ...styles.card, ...(d.claimed ? styles.cardDone : null) } },
          d.claimed ? h('span', { style: styles.stamp, 'aria-hidden': 'true' }, tr('stampClaimed')) : null,
          h('h3', { style: { ...styles.cardTitle, ...(d.claimed ? { paddingRight: '88px' } : null) } },
            h('span', { style: styles.tag }, d.category),
            d.saved ? h('span', { style: styles.savedMark, 'aria-hidden': 'true' }, '★') : null,
            d.source_url
              ? h('a', { className: 'ym-link', href: d.source_url, target: '_blank', rel: 'noopener', style: styles.link }, d.title)
              : d.title),
          d.benefit ? h('div', { style: styles.body }, d.benefit) : null,
          d.how_to ? h('div', { style: styles.body }, tr('howTo', { text: d.how_to })) : null,
          sub1 ? h('div', { style: styles.sub }, sub1) : null,
          h('div', { style: styles.sub },
            tr('fromLine', { source: d.source_name || '' }) + ' · ' + tr('verifiedAt', { date: fmtDate(d.verified_at) })),
          h('div', { style: styles.acts },
            h('button', {
              type: 'button', className: 'ym-act',
              style: { ...styles.actBtn, ...(d.claimed ? styles.actBtnDone : null) },
              onClick: () => mark('deal', d.id, 'claimed', !d.claimed),
            }, d.claimed ? tr('claimed') : tr('markClaimed')),
            h('button', {
              type: 'button', className: 'ym-act',
              style: { ...styles.actBtn, ...(d.saved ? styles.actBtnSaved : null) },
              onClick: () => mark('deal', d.id, 'saved', !d.saved),
            }, d.saved ? tr('saved') : tr('save'))));
      }

      function boardCard(board, it) {
        const title = it.title || [it.provider, it.plan].filter(Boolean).join(' ');
        const link = it.claim_url || it.buy_url || it.source_url;
        const extra = [it.amount, it.price, it.location].filter(Boolean).join(' · ');
        const body = it.detail || it.summary || it.specs || '';
        const sub = tr('fromLine', { source: it.source_name || '' })
          + (it.verified_at ? ' · ' + tr('verifiedAt', { date: fmtDate(it.verified_at) }) : '')
          + (board === 'radar' ? ' · ' + tr('radarNote') : '');
        return h('article', { key: board + '-' + it.id, className: 'ym-card', style: { ...styles.card, ...(it.read ? styles.cardDone : null) } },
          it.read ? h('span', { style: styles.stamp, 'aria-hidden': 'true' }, tr('stampRead')) : null,
          h('h3', { style: { ...styles.cardTitle, ...(it.read ? { paddingRight: '72px' } : null) } },
            link
              ? h('a', { className: 'ym-link', href: link, target: '_blank', rel: 'noopener', style: styles.link }, title)
              : title),
          extra ? h('div', { style: styles.body }, extra) : null,
          body ? h('div', { style: styles.body }, body) : null,
          h('div', { style: styles.sub }, sub),
          h('div', { style: styles.acts },
            h('button', {
              type: 'button', className: 'ym-act',
              style: { ...styles.actBtn, ...(it.read ? styles.actBtnDone : null) },
              onClick: () => mark(board, it.id, 'read', !it.read),
            }, it.read ? tr('read') : tr('markRead'))));
      }

      const auto = (data && data.auto) || { available: false };
      const autoLine = !auto.available
        ? tr('autoUnavailable')
        : auto.enabled
          ? tr('autoOn', { time: auto.nextRunAt ? fmtDateTime(auto.nextRunAt) : '—' })
          : tr('autoOff');

      const header = h('header', null,
        h('h1', { style: styles.title }, tr('title')),
        h('div', { style: styles.rule, 'aria-hidden': 'true' }),
        status === 'ready' && data
          ? h('div', { style: styles.meta }, tr('meta', {
              total: data.stats.total_deals,
              live: data.stats.live_deals,
              radar: data.stats.boards.radar,
              tokens: data.stats.boards.tokens,
              refreshed: data.stats.last_refreshed_at ? fmtDateTime(data.stats.last_refreshed_at) : '—',
            }))
          : null,
        status === 'ready' && data
          ? h('div', { style: styles.autoRow },
              h('button', {
                type: 'button', className: 'ym-refresh',
                style: { ...styles.refreshBtn, ...(refreshing ? styles.refreshBtnOff : null) },
                disabled: refreshing,
                onClick: () => refreshNow(),
              }, refreshing ? tr('refreshing') : tr('refreshNow')),
              h('span', { style: styles.autoText }, autoLine),
              refreshMsg ? h('span', { style: styles.refreshMsg, role: 'status' }, refreshMsg) : null)
          : null);

      if (status === 'loading') {
        return h('div', { style: styles.root }, h('style', null, CSS), header,
          h('div', { style: styles.stateBox }, tr('loading')));
      }

      if (status === 'error') {
        return h('div', { style: styles.root }, h('style', null, CSS), header,
          h('div', { style: styles.stateBox },
            h('div', null, tr('loadFailed', { error })),
            h('div', { style: { marginTop: '12px' } },
              h('button', {
                type: 'button', className: 'ym-act', style: styles.actBtn,
                onClick: () => setAttempt((a) => a + 1),
              }, tr('retry'))),
            h('div', { style: { marginTop: '10px', fontSize: '12px' } }, tr('fallbackHint'))));
      }

      const kw = keyword.trim().toLowerCase();
      const tabDefs = [
        ['featured', tr('featured')],
        ['all', tr('all')],
        ...CATEGORIES.map((c) => [c, tr('cat_' + c)]),
        ...BOARDS.map((b) => ['board:' + b, tr('board_' + b)]),
      ];
      const tabs = h('nav', { style: styles.tabs },
        tabDefs.map(([key, label]) => h('button', {
          key, type: 'button', className: 'ym-tab',
          style: { ...styles.tab, ...(tab === key ? styles.tabOn : null) },
          onClick: () => setTab(key),
        }, label)));

      let cards = [];
      if (tab.startsWith('board:')) {
        const board = tab.slice('board:'.length);
        cards = (data.boards[board] || [])
          .filter((it) => hit(it, kw, BOARD_SEARCH_FIELDS))
          .map((it) => boardCard(board, it));
      } else {
        let deals = data.deals.filter((d) => hit(d, kw, DEAL_SEARCH_FIELDS));
        if (tab === 'featured') {
          deals = [...deals].sort(byFeaturedOrder).slice(0, 12);
        } else {
          if (tab !== 'all') deals = deals.filter((d) => d.category === tab);
          deals = [...deals].sort(byListOrder);
        }
        cards = deals.map(dealCard);
      }

      return h('div', { style: styles.root },
        h('style', null, CSS),
        header,
        tabs,
        h('input', {
          type: 'search', className: 'ym-search', style: styles.search, value: keyword,
          placeholder: tr('searchPlaceholder'),
          onChange: (e) => setKeyword(e.target.value),
        }),
        notice ? h('div', { style: styles.notice, role: 'status' }, notice) : null,
        cards.length
          ? h('main', { style: styles.grid }, cards)
          : h('div', { style: styles.empty }, tr('empty')));
    }

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'yangmao: dictionaries');
      ctx.slots.inject('main', () => ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: NS }, YangmaoPage));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 30, locale: NS, label: () => t('panel') }, YangmaoIcon));
    }

    return { inject, apply };
  },
});
