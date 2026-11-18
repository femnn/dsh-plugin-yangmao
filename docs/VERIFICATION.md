# 本地验证记录（2026-11-18）

环境：Node v24.22.1 / npm 10.9.4 / pnpm 10.34.9 / dsh **0.2.2-rc.1**
（`@deepseek-ai/dsh`，干净安装一份作运行时；隔离 `DSH_HOME`，未触碰真实 ~/.dsh）。

## 1. 安装（官方 bundle 路径）

```console
$ dsh plugin --profile web add /home/hatch/workspace/dsh-plugin-yangmao
dsh: initialized profile web at .../dsh-home-test/profiles/web
dependencies:
+ dsh-plugin-yangmao link:/home/hatch/workspace/dsh-plugin-yangmao
Done in 760ms using pnpm v10.34.9
```

安装后 profile 的 `package.json` 里 `dsh.profile.bundles` 增加了
`"dsh-plugin-yangmao"`，即本包的 `dsh.bundle.patch` 会被当作一层 bundle 合入。

> 注意：`link:` 本地调试时 pnpm 不会替链接包安装其 dependencies，
> 首次本地调试需在插件目录跑一次 `npm install`（装 schemastery 与
> peer dsh-tools）。从 npm registry 正式安装时无此问题（pnpm 会装齐
> dependencies 并解析 peer）。

## 2. 配置树合入（离线）

```console
$ dsh web --dump-config        # exit 0, 输出 1248 行，末尾即本插件层
# == dsh-plugin-yangmao
- id: yangmao
  name: dsh-plugin-yangmao
- id: yangmao-web
  name: dsh-plugin-yangmao/web
```

## 3. 启动与插件激活

```console
$ dsh web --no-open
[yangmao] ready: 269 deals, boards radar=18 tokens=14 vps=41, data at .../dsh-home-test/plugins/yangmao/data.json
[yangmao] board page at /plugins/yangmao
dsh web: http://127.0.0.1:3080/?token=<redacted>
```

无 "entries did not activate" 警告。`[yangmao] ready` 在 apply() 末尾打印，
位于服务提供、7 个工具注册、skill 注册之后——三者任一抛错都会让该行缺失
并伴随 fiber 激活失败警告。数据文件首次启动即由种子生成在
`$DSH_HOME/plugins/yangmao/data.json`。

## 4. 看板页与 API（curl）

```console
$ curl -s -o page.html -w "%{http_code} %{size_download}B" http://127.0.0.1:3080/plugins/yangmao
200 7564B                        # 与 lib/board.html 字节数一致

$ curl -s http://127.0.0.1:3080/plugins/yangmao/api/state | head -c 120
{"deals":[{"id":118,"category":"llm","title":"七牛云Conatus：实名认证每日1亿Token免费",...

$ curl -s -X POST http://127.0.0.1:3080/plugins/yangmao/api/mark \
    -H 'content-type: application/json' \
    -d '{"target":"deal","id":118,"mark":"claimed","value":true}'
{"ok":true}
# 随后读 $DSH_HOME/plugins/yangmao/data.json：deal 118 的 claimed 已落盘为 true
# （验证后已用同样的 POST 改回 false）
```

## 5. 数据层单测（无头，直接跑 store）

以真实种子初始化临时数据文件后依次执行 listDeals / featured / listBoard /
addDeal / markDeal / applyRefresh / 重新加载，全部符合预期：
统计 `{"total_deals":269, "live_deals":269, by_category":{food:40, shop:11,
telecom:35, bank:37, member:42, cloud:15, llm:89}, boards:{radar:18,
tokens:14, vps:41}}`；refresh 回写后字段更新与 claimed 标记均正确持久化。

## 6. 第二轮（2026-11-18）：Client 半纠正——侧边栏入口 + 整页看板

第一轮关于客户端框架的结论是错的，特此纠正：`main` 不是「会话独占
单槽」，而是 **keyed 槽位**，按侧边栏选中的面板 id 派发；没选面板时
宿主回落到 key `conversation` 显示会话——插件页与会话是同一个槽的
两个 key。标准做法见实测教程《从零写一个 DSH 插件：在左侧菜单栏
加一个「测试」》（代码装进 web profile 验证生效）：
https://jishuzhan.net/article/2117461349811617794

本轮改动：

- `lib/client.js` 重写：`__ModuleLoader__` 外壳（id = 包名），factory
  只 `require('react')`，返回 `{ inject: ['slots', 'locale'], apply }`；
  apply 三步——`ctx.effect(() => ctx.locale.register('yangmao', { zh, en }))`
  注册字典 → `ctx.slots.inject('main', …)` 注册
  `{ name: 'main', key: 'yangmao', locale: 'yangmao' }` + 看板页组件 →
  `ctx.slots.inject('sidebar.panellist', …)` 注册
  `{ name: 'sidebar.panellist', id: 'yangmao', order: 30, locale: 'yangmao', label: () => t('panel') }`
  + 手写 SVG 图标组件（宿主传 `size`/`active`，`currentColor` 描边）。
  页面组件手写 React（主题 token 样式、自己处理滚动），挂载时 fetch
  同源 `/plugins/yangmao/api/state`，含今日精选（未领取优先）、
  分类/三板块切换、搜索、条目卡片（已领取沉底变淡）、标记按钮
  POST `/plugins/yangmao/api/mark` 后本地刷新；加载中/失败有明示
  状态与重试，不白屏。
- `package.json` 的 `dsh.client` 改为 `platform: 'web'`、
  `immediately: true`、inject
  `['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar']`
  （仅激活排序依赖）。
- 已删除旧做法：`shell.overlay` 悬浮入口 + iframe。Host 路由页保留
  为直达/降级页；`lib/web.js` 仅更新了头部注释，路由实现未动。

### 自测（无头，stub 宿主装配面）

`scripts/selftest-client.mjs`：以 stub 的 `window.__ModuleLoader__`、
Cordis ctx（slots/locale/effect）与极小 React hook 运行时加载
`lib/client.js` 并驱动组件。结果 **34 passed, 0 failed**，覆盖：

- 外壳：load 被调用、id = `dsh-plugin-yangmao`、factory 返回
  `inject: ['slots', 'locale']` 与 apply；
- apply：字典以 namespace `yangmao` 经 ctx.effect 注册（zh 面板名
  「薅羊毛情报」、en 字典齐备）；slots.inject 恰好两处
  （`main`、`sidebar.panellist`）；回调触发的 register 参数精确
  （main 的 key/locale、panellist 的 id/order=30/locale，
  label() 经字典解析为「薅羊毛情报」）；
- 图标：按宿主 size 渲染 `<svg>`；
- 页面：初始为加载态 → 数据到达后渲染条目；精选排序未领取在前；
  点「标记已领取」发出
  `POST /plugins/yangmao/api/mark {"target":"deal","id":1,"mark":"claimed","value":true}`，
  本地状态翻转、卡片变淡（opacity .55）；雷达标签页渲染且带
  「社区帖，未经官网核实」注记；搜索按关键词过滤；
- 错误路径：fetch 拒绝时呈现「加载失败」+「重试」，不白屏。

### 重装与宿主下发实测（同一隔离环境）

```console
$ dsh plugin --profile web add /home/hatch/workspace/dsh-plugin-yangmao
Already up to date
Done in 573ms using pnpm v10.34.9        # link: 安装已在位，包内文件即时生效

$ dsh web --dump-config                  # exit 0，末尾仍为本插件两行
# == dsh-plugin-yangmao
- id: yangmao
  name: dsh-plugin-yangmao
- id: yangmao-web
  name: dsh-plugin-yangmao/web

$ dsh web --no-open                      # 启动日志仅 3 行，无 slot/client 报错
[yangmao] ready: 269 deals, boards radar=18 tokens=14 vps=41, data at .../dsh-home-test/plugins/yangmao/data.json
[yangmao] board page at /plugins/yangmao
```

用启动 URL 的一次性 token 换到 auth cookie 后抓取 Web UI 启动页
（40,430B）：boot graph 的 combo 清单中含独立一条
`plugins/??dsh-plugin-yangmao/client.js&rev=1d2445c96315`；实际请求
该 combo 脚本返回 **200, 18,254B**（`lib/client.js` 本体 18,179B，
差额为 combo 框架字节），内容含 `sidebar.panellist`（3 处）、
`yangmao: dictionaries` 与 `薅羊毛情报`——宿主确实在下发新版
Client 半。回归检查：`GET /plugins/yangmao` 仍 200 7,564B，
`GET /plugins/yangmao/api/state` 正常返回种子数据。

## 未验证项（如实）

- **Client 半在真实浏览器内的像素级渲染**：模块下发已实测（见
  第 6 节），组件逻辑已由无头自测覆盖（stub 的 slots/locale/React
  运行时）；但侧边栏行与整页看板在真实 Web UI 里的实际呈现
  （主题 token 对比度、宿主传入 props 的细节差异）仍需人工打开
  Web UI 看一眼才能最终确认——无头环境无法代替。
- **工具被模型实际调用**：需要可用的模型 API Key 才能跑 agent 会话，
  本次以「apply 完成 + 无激活警告」为注册成功证据，未做端到端对话调用。

## v0.1.1 兼容修复（2026-11-18 晚）

- 起因：桌面版 DSH 0.2.2-rc.3 的插件安装器按 peerDependencies 严格校验，v0.1.0 把 `@deepseek-ai/dsh-tools` 钉死 `0.2.2-rc.1`，被判不兼容拒绝安装。
- 修复：peer 放宽为 `>=0.2.2-rc.1 <0.3.0`，版本升 0.1.1。
- 复测（隔离 DSH_HOME + dsh 0.2.2-rc.3 运行时）：`dsh plugin --profile web add <本地路径>` 成功；`--dump-config` 末尾合入 yangmao / yangmao-web 两行；启动日志 `[yangmao] ready: 269 deals, boards radar=18 tokens=14 vps=41` + `board page at /plugins/yangmao`，无报错；curl 看板页 200 7564B、`/api/state` 返回真实数据。

## v0.2.0 自动更新（2026-11-18 晚）

环境：dsh 0.2.2-rc.3 隔离 DSH_HOME（两套：旧 home 复用、新 home 全新）。

- `node --check` 全部 lib 文件通过；`scripts/selftest-client.mjs` **40 项全过**（原 34 + 新增 6：自动更新状态行渲染、立即更新按钮、请求中禁用防重复、POST /api/refresh-now、服务端 message 展示、请求结束恢复可用）。自测沙箱补了 setInterval/clearInterval stub，对应页面新增的 60 秒轮询 effect。
- 全新 home 启动实测：插件装载后首轮对账被宿主拒绝（`This Host cannot create Sessions`——会话创建提供方尚未注册，属启动时序），子插件的重试随后自动建成任务，日志 `[yangmao] auto refresh task created: id=schedule-e46eced7-… every=43200s next=2026-11-19T00:35:49.139Z`（next 恰为创建时刻 +12h）。
- 持久化核对：`$DSH_HOME/storages/schedule.json` 中有标题「薅羊毛情报 · 自动复核」的任务记录；`data.json` 的 `meta.autoTaskId` 与任务 id 一致。
- `GET /api/state` 的 `auto` 字段：`{available:true, enabled:true, taskId, nextRunAt}` 与宿主一致。
- `POST /api/refresh-now` 返回 `{ok:true, message:'已发起更新，…'}`；随后 `auto.lastDeliveryAt` 落值，且目标会话文件出现在 `storages/session_projcache/sessions/` 并含投递的复核指令全文——投递机制端到端打通。
- 删除尊重实测：手工从 schedule.json 移除任务（模拟用户在自动化任务页删除）后重启，日志 `auto refresh task missing (removed by user); not recreating`，`meta.autoTaskGone=true` 落盘，任务未被重建，`auto.enabled=false`；此状态下再调 refresh-now：任务被重建（新 id）、墓碑清除、立即投递成功。
- 边界（如实记录）：隔离环境无模型 API Key，投递进会话的复核指令不会被智能体真正执行完，复核回写本身未在本轮验证；像素级渲染（按钮与状态行在真实 Web UI 的样子）仍需人工看一眼。
