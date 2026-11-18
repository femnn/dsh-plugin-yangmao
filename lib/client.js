// dsh-plugin-yangmao — client half (Web UI).
//
// dsh 0.2.x offers no page-level slot: the frame seats are sidebar / main /
// rightbar / shell.*, `main` is a single seat owned by the conversation
// view, and `root` must never be registered into. The documented additive
// seat is `shell.overlay` (list slot, root scope) — so the client half is a
// floating launcher: a pill button that opens the host-served board page
// (/plugins/yangmao, see lib/web.js) in a large overlay panel iframe.
//
// This file is a pre-built client bundle in the __ModuleLoader__ format,
// mirroring first-party packages (e.g. @deepseek-ai/dsh-client-ui-jobs):
// package.json declares `dsh.client` and the `./client` export points here.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-yangmao',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const React = require('react');

    const BOARD_URL = '/plugins/yangmao';

    function YangmaoLauncher() {
      const [open, setOpen] = React.useState(false);
      const wrap = {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: 60,
        pointerEvents: 'auto', display: 'flex', flexDirection: 'column',
        alignItems: 'flex-end', gap: '10px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      };
      const pill = {
        border: '1px solid rgba(128,128,128,.45)', borderRadius: '999px',
        padding: '7px 14px', fontSize: '13px', cursor: 'pointer',
        background: open ? '#e8590c' : 'var(--dsw-specific-menu, #fff)',
        color: open ? '#fff' : 'var(--dsw-alias-label-primary, #1c1c1a)',
        boxShadow: '0 4px 18px rgba(0,0,0,.18)',
      };
      const panel = {
        width: 'min(1060px, calc(100vw - 36px))',
        height: 'min(760px, calc(100vh - 90px))',
        border: '1px solid rgba(128,128,128,.4)', borderRadius: '14px',
        overflow: 'hidden', background: '#fff',
        boxShadow: '0 12px 44px rgba(0,0,0,.28)',
      };
      return React.createElement('div', { style: wrap },
        open
          ? React.createElement('div', { style: panel },
              React.createElement('iframe', {
                src: BOARD_URL,
                title: '薅羊毛情报看板',
                style: { width: '100%', height: '100%', border: 0, display: 'block' },
              }))
          : null,
        React.createElement('button', {
          type: 'button', style: pill,
          onClick: () => setOpen(!open),
          'aria-expanded': open,
        }, open ? '收起羊毛看板' : '🐑 羊毛看板'));
    }

    const inject = ['slots'];

    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'yangmao-board',
        order: 90,
        inject: () => ({}),
      }, YangmaoLauncher));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
