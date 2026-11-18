// Agent tools for the yangmao (薅羊毛) board. All tools read/write through
// the shared YangmaoStore provided as the `yangmao` service.
import { defineTool } from '@deepseek-ai/dsh-tools';
import { BOARD_NAMES, CATEGORIES } from './store.js';

const JSON_OUT = { type: 'json' };

function text(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }];
}

function dealLine(d) {
  const bits = [`#${d.id} [${d.category}] ${d.title}`];
  if (d.benefit) bits.push(`权益：${d.benefit}`);
  if (d.valid_text) bits.push(`有效期：${d.valid_text}`);
  if (d.claimed) bits.push('（已领取）');
  if (d.saved) bits.push('（已收藏）');
  return bits.join('｜');
}

export function registerTools(ctx, store) {
  const register = (tool) => ctx.effect(() => ctx.tools.register(tool), `yangmao: tool ${tool.name}`);

  register(defineTool({
    name: 'yangmao_search',
    description: 'Search the yangmao (薅羊毛) deals board. Filter by category and/or keyword. Expired deals are hidden unless include_expired is set; claimed deals sink to the bottom. Returns matching deals with ids (needed for yangmao_mark).',
    parameters: {
      category: { type: 'string', enum: [...CATEGORIES], description: 'food | shop | telecom | bank | member | cloud | llm' },
      keyword: { type: 'string', description: 'Keyword matched against title, benefit, how-to, platform, source and restrictions.' },
      include_expired: { type: 'boolean', description: 'Also return deals past valid_until. Default false.' },
      limit: { type: 'integer', description: 'Max results. Default 20.' },
    },
    output: { schema: JSON_OUT, render: (_args, v) => text([`${v.total} deal(s):`, ...v.deals.map(dealLine)].join('\n')) },
    execute: async (args) => {
      const deals = store.listDeals({
        category: args.category, keyword: args.keyword,
        includeExpired: Boolean(args.include_expired), limit: args.limit ?? 20,
      });
      return { total: deals.length, deals };
    },
  }));

  register(defineTool({
    name: 'yangmao_featured',
    description: "Today's picks from the yangmao board: unexpired deals ordered by most recent verification (verified_at), unclaimed first. Use this when the user asks what's worth grabbing today.",
    parameters: {
      limit: { type: 'integer', description: 'Max results. Default 10.' },
    },
    output: { schema: JSON_OUT, render: (_args, v) => text(['今日精选：', ...v.deals.map(dealLine)].join('\n')) },
    execute: async (args) => ({ deals: store.featured({ limit: args.limit ?? 10 }) }),
  }));

  register(defineTool({
    name: 'yangmao_boards',
    description: 'Read one of the three side boards: radar (社区雷达帖， unverified community leads), tokens (free LLM token quotas, official-source verified), vps (cheap VPS plans). Optionally filter by keyword.',
    parameters: {
      board: { type: 'string', required: true, enum: [...BOARD_NAMES], description: 'radar | tokens | vps' },
      keyword: { type: 'string', description: 'Keyword matched against title/summary/provider/plan/detail/specs.' },
      limit: { type: 'integer', description: 'Max results. Default 20.' },
    },
    output: {
      schema: JSON_OUT,
      render: (_args, v) => text([`${v.board}: ${v.total} item(s)`, ...v.items.map((it) =>
        `#${it.id} ${it.title ?? `${it.provider ?? ''} ${it.plan ?? ''}`.trim()}${it.read ? '（已读）' : ''}`)].join('\n')),
    },
    execute: async (args) => {
      const items = store.listBoard(args.board, { keyword: args.keyword, limit: args.limit ?? 20 });
      return { board: args.board, total: items.length, items };
    },
  }));

  register(defineTool({
    name: 'yangmao_add',
    description: 'Add a new deal to the yangmao board. Only add deals whose amount/threshold facts come from the official source page (see the yangmao-refresh skill); community posts belong on the radar board, not here. verified_at is stamped automatically.',
    parameters: {
      title: { type: 'string', required: true, description: 'Deal title, including the key amount when known.' },
      category: { type: 'string', required: true, enum: [...CATEGORIES], description: 'food | shop | telecom | bank | member | cloud | llm' },
      benefit: { type: 'string', required: true, description: 'What you get, with the amount as stated by the official source.' },
      how_to: { type: 'string', required: true, description: 'Steps to claim it.' },
      platform: { type: 'string', required: true, description: 'App / platform where it is claimed.' },
      source_name: { type: 'string', required: true, description: 'Name of the source page.' },
      source_url: { type: 'string', required: true, description: 'Official source URL the facts were read from.' },
      card_req: { type: 'string', description: 'Card-binding / eligibility requirement, or 免绑卡.' },
      restrictions: { type: 'string', description: 'Limits, region, new-user-only, etc.' },
      valid_text: { type: 'string', description: 'Validity as written on the source page.' },
      valid_until: { type: 'string', description: 'Last valid day, YYYY-MM-DD, when the source states one.' },
      strength: { type: 'integer', description: 'Editorial strength 0-100. Default 50.' },
    },
    output: { schema: JSON_OUT, render: (_args, v) => text(`Added deal #${v.deal.id}: ${v.deal.title}`) },
    execute: async (args) => ({ deal: await store.addDeal(args) }),
  }));

  register(defineTool({
    name: 'yangmao_mark',
    description: "Set or clear a user mark. Deals support 'claimed' and 'saved'; board items (radar/tokens/vps) support 'read'. Use target='deal' with a deal id, or target=<board name> with a board item id.",
    parameters: {
      target: { type: 'string', required: true, enum: ['deal', ...BOARD_NAMES], description: 'deal | radar | tokens | vps' },
      id: { type: 'integer', required: true, description: 'Item id within the target list.' },
      mark: { type: 'string', required: true, enum: ['claimed', 'saved', 'read'], description: 'claimed | saved (deals only) | read (boards only)' },
      value: { type: 'boolean', required: true, description: 'true to set the mark, false to clear it.' },
    },
    output: { schema: JSON_OUT, render: (_args, v) => text(`Marked ${v.target} #${v.id}: ${v.mark}=${v.value}`) },
    execute: async (args) => {
      if (args.target === 'deal') {
        if (args.mark === 'read') throw new Error('deals do not have a read mark; use claimed/saved');
        await store.markDeal(args.id, args.mark, args.value);
      } else {
        if (args.mark !== 'read') throw new Error('board items only support the read mark');
        await store.markBoardRead(args.target, args.id, args.value);
      }
      return { target: args.target, id: args.id, mark: args.mark, value: args.value };
    },
  }));

  register(defineTool({
    name: 'yangmao_apply_refresh',
    description: 'Write back a verification pass over the deals board (see the yangmao-refresh skill for the rules). upserts update matched-by-title deals (or insert new ones) and stamp verified_at; retire_titles removes ended deals; confirmed_titles re-stamps verified_at for deals verified unchanged. Expired deals are dropped automatically and last_refreshed_at is updated.',
    parameters: {
      upserts: {
        type: 'array',
        description: 'Deals whose facts changed or that are new. Matched by title.',
        items: {
          type: 'object', additionalProperties: true,
          properties: {
            title: { type: 'string', required: true },
            category: { type: 'string', enum: [...CATEGORIES] },
            benefit: { type: 'string' }, how_to: { type: 'string' }, platform: { type: 'string' },
            card_req: { type: 'string' }, restrictions: { type: 'string' },
            source_name: { type: 'string' }, source_url: { type: 'string' },
            valid_text: { type: 'string' }, valid_until: { type: 'string' },
            strength: { type: 'integer' }, featured: { type: 'boolean' },
          },
        },
      },
      retire_titles: { type: 'array', items: { type: 'string' }, description: 'Titles of deals confirmed ended/removed at the source.' },
      confirmed_titles: { type: 'array', items: { type: 'string' }, description: 'Titles re-verified unchanged at the official source.' },
    },
    output: { schema: JSON_OUT, render: (_args, v) => text(`Refresh applied: +${v.added} added, ${v.updated} updated, ${v.confirmed} confirmed, ${v.retired} retired, ${v.dropped_expired} expired dropped. Total now ${v.total}.`) },
    execute: async (args) => store.applyRefresh({
      upserts: args.upserts ?? [], retire_titles: args.retire_titles ?? [], confirmed_titles: args.confirmed_titles ?? [],
    }),
  }));

  register(defineTool({
    name: 'yangmao_stats',
    description: 'Counts for the yangmao board: deals by category, live/expired, claimed/saved, board sizes, and when the board was last refreshed.',
    parameters: {},
    output: { schema: JSON_OUT, render: (_args, v) => text(v) },
    execute: async () => store.stats(),
  }));
}
