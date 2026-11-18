// dsh-plugin-yangmao — host (Node) half.
//
// Provides:
// - the `yangmao` service: a YangmaoStore over a JSON data file, seeded on
//   first run from seed/yangmao-seed.json (all user marks reset);
// - the yangmao_* agent tools (search / featured / boards / add / mark /
//   apply_refresh / stats);
// - the `yangmao-refresh` skill carrying the board's data rules;
// - auto-refresh: a `yangmao-auto` sub-plugin (inject: schedule) keeps a
//   host scheduled task that delivers a self-contained refresh prompt
//   every 12 hours; the store also grows getAutoStatus()/refreshNow()
//   methods the web half uses for its status line and 立即更新 button.
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

// ---------------------------------------------------------------------------
// Auto-refresh on the host's schedule service.
//
// A scheduled task delivers REFRESH_PROMPT into a session (created on the
// first delivery, reused after that) every 12 hours; the agent in that
// session does the verify-and-write-back pass with the yangmao_* tools.
// The prompt is deliberately self-contained — it must work even when the
// yangmao-refresh skill is not loaded in that session. The task shows up
// in the host's Automation Tasks page, where the user can pause or delete
// it; deleting it is respected (see the autoTaskGone tombstone below).
// ---------------------------------------------------------------------------

export const AUTO_TASK_TITLE = '薅羊毛情报 · 自动复核';
export const AUTO_INTERVAL_SECONDS = 43200; // 12 小时

export const REFRESH_PROMPT = `你是「薅羊毛情报」看板的自动复核任务。请按下面步骤完成本轮复核，全程用 yangmao_* 工具读写看板，不要直接改数据文件。

1. 先调 yangmao_stats 查看看板现状（总量、各分类条数、上次复核时间）。
2. 联网复核现有条目：优先处理已过期、临近过期、核查时间（verified_at）最早的条目。用 yangmao_search 分批拉取后，逐条打开 source_url 核对金额、门槛、有效期与领取方式。金额、门槛、免费额度只以官网或官方页面原文为准；社区帖、汇总站只能当线索，不能当事实来源。核对结果分三类记下：内容没变 → 标题记入 confirmed_titles；内容有变 → 按官网原文改好字段，整个条目记入 upserts；活动已结束或页面已下架 → 标题记入 retire_titles。页面打不开或被登录墙挡住的条目本轮跳过，不要动它。
3. 顺带搜集少量新的国内薅羊毛情报：先顺线索找到官网原文核实，核实过的新条目记入 upserts；只在社区帖看到、官网核不到的不要写入主清单。
4. 把本轮全部结果整理成一次 yangmao_apply_refresh 调用提交（upserts / retire_titles / confirmed_titles 三个数组），不要逐条调 yangmao_add。
5. 不要改动用户已领取（claimed）、已收藏（saved）、已读（read）的任何标记。
6. 最后用一句话汇报：本轮复核了多少条、下架多少条、新增多少条。`;

/** Find our task in the host list: by the stored id first, then by title. */
async function findAutoTask(schedule, store) {
  const { items } = await schedule.list({});
  const savedId = store.getMeta('autoTaskId');
  return (savedId ? items.find((e) => e.id === savedId) : undefined)
    ?? items.find((e) => e.title === AUTO_TASK_TITLE)
    ?? null;
}

async function createAutoTask(schedule, store) {
  const entry = await schedule.create({
    title: AUTO_TASK_TITLE,
    prompt: REFRESH_PROMPT,
    timing: { kind: 'every', every_seconds: AUTO_INTERVAL_SECONDS },
    target: { kind: 'new_once' },
  });
  await store.setMeta('autoTaskId', entry.id);
  await store.setMeta('autoTaskGone', undefined);
  return entry;
}

/**
 * One reconciliation pass, run by the yangmao-auto sub-plugin once the
 * schedule service is available:
 * - task found (by id or title) -> adopt it, remember its id;
 * - task missing but we once had one (or a tombstone) -> the user deleted
 *   it in the Automation Tasks page; write the tombstone, do not rebuild;
 * - never had one -> create it.
 * Throws on host API errors so the caller can retry: creating a
 * new_once task is rejected until the host's session-creation provider
 * has registered, which can lag behind the schedule service at boot.
 */
async function ensureAutoTask(ctx, store) {
  const schedule = ctx.schedule;
  const entry = await findAutoTask(schedule, store);
  if (entry) {
    if (store.getMeta('autoTaskId') !== entry.id) await store.setMeta('autoTaskId', entry.id);
    if (store.getMeta('autoTaskGone')) await store.setMeta('autoTaskGone', undefined);
    console.log(`[yangmao] auto refresh task ready: id=${entry.id} status=${entry.status} next=${entry.scheduledAt}`);
    return;
  }
  if (store.getMeta('autoTaskId') || store.getMeta('autoTaskGone')) {
    if (!store.getMeta('autoTaskGone')) await store.setMeta('autoTaskGone', true);
    console.log('[yangmao] auto refresh task missing (removed by user); not recreating');
    return;
  }
  const created = await createAutoTask(schedule, store);
  console.log(`[yangmao] auto refresh task created: id=${created.id} every=${AUTO_INTERVAL_SECONDS}s next=${created.scheduledAt}`);
}

/**
 * Attach getAutoStatus()/refreshNow() to the store (the object provided
 * as the `yangmao` service). `auto.schedule` stays null until the
 * yangmao-auto sub-plugin applies, so both methods degrade cleanly on
 * hosts without a schedule service.
 */
function attachAutoMethods(store, auto) {
  store.getAutoStatus = async () => {
    const unavailable = { available: false, enabled: false, taskId: null, nextRunAt: null, lastDeliveryAt: null };
    const schedule = auto.schedule;
    if (!schedule) return unavailable;
    try {
      const entry = await findAutoTask(schedule, store);
      if (!entry) return { available: true, enabled: false, taskId: null, nextRunAt: null, lastDeliveryAt: null };
      return {
        available: true,
        enabled: entry.status === 'active',
        taskId: entry.id,
        nextRunAt: entry.scheduledAt ?? null,
        lastDeliveryAt: entry.lastDelivery?.deliveredAt ?? null,
      };
    } catch {
      return unavailable;
    }
  };

  store.refreshNow = async () => {
    const schedule = auto.schedule;
    if (!schedule) return { ok: false, message: '宿主未提供定时任务服务，无法发起更新' };
    try {
      let entry = await findAutoTask(schedule, store);
      if (!entry) entry = await createAutoTask(schedule, store);
      const result = await schedule.run({ id: entry.id });
      if (result && result.code === 'schedule_execution_pending') {
        return { ok: true, message: '更新已在进行中，完成后本页数据会自动刷新' };
      }
      if (result && result.code === 'schedule_not_found') {
        return { ok: false, message: '自动更新任务不存在，请稍后再试' };
      }
      return { ok: true, message: '已发起更新，复核会在后台会话中进行，完成后本页数据自动刷新' };
    } catch (err) {
      return { ok: false, message: `发起更新失败：${err?.message ?? err}` };
    }
  };
}

export async function apply(ctx, config) {
  const store = await new YangmaoStore(
    resolveDataFile(config),
    path.join(here, '..', 'seed', 'yangmao-seed.json'),
  ).init();
  // Shared handle for the schedule service: filled in by the yangmao-auto
  // sub-plugin when (and only when) the host provides one.
  const auto = { schedule: null };
  attachAutoMethods(store, auto);
  ctx.effect(() => ctx.provide('yangmao', store), 'yangmao: store service');
  registerTools(ctx, store);
  ctx.effect(() => ctx.skills.register(SKILL), 'yangmao: refresh skill');
  // With inject: ['schedule'] this sub-plugin's apply only runs once the
  // host's schedule service exists; on hosts without one it never applies
  // and the main plugin works unchanged.
  ctx.plugin({
    name: 'yangmao-auto',
    inject: ['schedule'],
    apply(autoCtx) {
      auto.schedule = autoCtx.schedule;
      // ensureAutoTask is idempotent and definitive outcomes (task
      // adopted / created / user-removed tombstone) settle it for good.
      // API errors are usually boot ordering — the host rejects new_once
      // creation until its session-creation provider registers, which
      // can lag the schedule service — so retry when that provider
      // appears, with a slow timer as fallback.
      let settled = false;
      let running = false;
      const kick = async () => {
        if (settled || running) return;
        running = true;
        try {
          await ensureAutoTask(autoCtx, store);
          settled = true;
        } catch (err) {
          console.log(`[yangmao] auto refresh setup not ready: ${err?.message ?? err}`);
        } finally {
          running = false;
        }
      };
      void kick();
      autoCtx.inject(['sessionController'], () => { void kick(); });
      const timer = setInterval(() => {
        if (settled) { clearInterval(timer); return; }
        void kick();
      }, 20000);
      if (typeof timer.unref === 'function') timer.unref();
    },
  });
  const s = store.stats();
  console.log(`[yangmao] ready: ${s.total_deals} deals, boards radar=${s.boards.radar} tokens=${s.boards.tokens} vps=${s.boards.vps}, data at ${store.dataFile}`);
}
