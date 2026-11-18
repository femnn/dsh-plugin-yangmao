# dsh-plugin-yangmao 🐑

「薅羊毛情报」看板 for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness)：
把一份持续复核的羊毛清单装进 dsh —— 智能体能查、能标、能按口径联网复核回写，
人能在 Web UI 里打开看板页按分类浏览、点标记。

![dsh](https://img.shields.io/badge/dsh-0.2.2--rc.1-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## 功能

- **主清单 deals**：255 条（种子快照，2026-11-18，已按下方
  「内容边界」清洗），分类
  `food / shop / telecom / bank / member / cloud / llm`，
  每条带权益、领法、平台、绑卡要求、限制、来源与核查时间 `verified_at`。
- **两块侧板**：`radar` 社区雷达帖 15 条（未经核实的线索）、
  `tokens` 免费大模型额度总汇 14 条。
- **智能体工具**（`ctx.tools`）：
  | 工具 | 作用 |
  |---|---|
  | `yangmao_search` | 按分类/关键词查主清单（过期默认隐藏，已领取沉底） |
  | `yangmao_featured` | 今日精选：最近核查的未过期条目 |
  | `yangmao_boards` | 查雷达 / Token 两板块 |
  | `yangmao_add` | 新增一条已核实的羊毛 |
  | `yangmao_mark` | 标记已领取 / 收藏 / 已读（或取消） |
  | `yangmao_apply_refresh` | 复核回写：upserts / retire / confirmed + 更新核查时间，过期自动清除 |
  | `yangmao_stats` | 看板统计与最近复核时间 |
- **看板页与 API**：Host 路由托管 JSON API（`/api/state`、`/api/mark`）
  供 Web UI 内的整页看板调用；另有单文件 HTML 直达页
  `GET /plugins/yangmao`（降级/直达用），可按分类/板块浏览、搜索、点标记。
- **Client 入口**：Web UI 左侧边栏面板行「薅羊毛情报」，点开在中间栏
  整页打开看板（与会话同为 `main` keyed 槽位的两个 key，见下方
  「实现说明」）；页面功能与直达页一致：精选、分类、搜索、两板块、点标记。
  v0.2.0 起整页改为羊皮纸配色（暖纸底、纸纹理、卡片纸面与印章式
  已领取标记），在深色宿主里像一张铺开的纸。
- **刷新 skill**（`yangmao-refresh`）：把数据口径写给智能体——
  被要求「刷新羊毛」时它会逐条打开官网原文核对，再用
  `yangmao_apply_refresh` 回写，而不是凭汇总站数字乱写。
- **自动更新**（v0.2.0 起）：插件在宿主里注册一个每 12 小时的定时
  复核任务，看板页头部有「立即更新」按钮可随时手动发起一次，
  详见下方「自动更新」一节。

## 安装

```bash
# 从 GitHub 安装（推荐）
dsh plugin --profile web add github:femnn/dsh-plugin-yangmao

# 或本地目录调试
dsh plugin --profile web add /path/to/dsh-plugin-yangmao
# link: 方式本地调试需先在插件目录跑一次 npm install 装齐依赖
```

然后正常启动 `dsh web` 即可。可以直接对智能体说：

- 「今天有什么值得领的羊毛？」
- 「查一下免费大模型额度」
- 「刷新羊毛」（按 skill 口径联网复核并回写）
- 「把七牛云那条标成已领取」

看板入口：Web UI 左侧边栏点「薅羊毛情报」；直达页地址：
`http://<dsh web 地址>/plugins/yangmao`。

可选配置（profile 的 cordis.patch.yml 里给 `yangmao` 行加 config）：

```yaml
- id: yangmao
  name: 'dsh-plugin-yangmao'
  config:
    dataDir: '/some/dir'   # 数据文件目录，默认 $DSH_HOME/plugins/yangmao
```

## 自动更新

插件带一个子插件 `yangmao-auto`，依赖宿主的定时任务服务
（`ctx.schedule`）。宿主提供该服务时（桌面版与 `dsh web` 的
自动化任务功能即基于它），插件首次启动会自动创建一个定时任务：

- **任务**：标题「薅羊毛情报 · 自动复核」，每 **12 小时**投递一次，
  投递目标是一个专用会话（首次投递时创建、之后复用同一个会话，
  历次复核在同一会话里连续可见）。
- **投递内容**：一段自包含的复核指令（不依赖 skill 是否被加载）：
  先 `yangmao_stats` 看现状，优先复核已过期/临近过期/核查时间最早
  的条目，金额/门槛/免费量只认官网原文、社区帖只作线索，顺带搜集
  少量新情报，最后整理成一次 `yangmao_apply_refresh` 提交，不动
  用户的已领取/收藏/已读标记，并一句话汇报复核/下架/新增数量。
- **管理**：任务会出现在宿主的「自动化任务」页面，可在那里暂停或
  删除。**在那里把任务删掉，插件会尊重这个决定**：任务 id 与删除
  状态记在数据文件的 `meta` 里（`autoTaskId` / `autoTaskGone`），
  重启不会重建；想恢复自动更新时，点看板页的「立即更新」即可
  （会重建任务并立即跑一次）。
- **手动更新**：看板页头部的「立即更新」按钮调
  `POST /plugins/yangmao/api/refresh-now`，让任务立即投递一次；
  旁边一行小字显示自动更新状态与下次运行时间（来自
  `/api/state` 的 `auto` 字段）。看板页打开期间每 60 秒自动
  重新拉取数据，后台复核写回后无需手动刷新页面。
- **没有定时任务服务的宿主**：子插件不启用，`auto` 字段返回
  `available: false`，「立即更新」会明确提示无法发起；看板、工具
  与手动对话复核（「刷新羊毛」）照常工作。
- 任务在宿主重启后保留（宿主侧持久化）。注意：定时投递只是把指令
  送进会话，实际复核由会话里的智能体执行，需要宿主已配置可用的
  模型；无模型时任务照常投递，但复核不会真正完成。

## 数据来源与口径

- 种子数据是作者维护的「薅羊毛情报」看板在 2026-11-18 的公开快照，
  随包分发仅作冷启动；**所有个人标记（已领取/收藏/已读）在种子里一律为
  未标记**，不含任何人的账号或使用数据。
- 口径铁律（skill 里同款）：**金额、门槛、免费量只认官网原文**
  （活动页/定价页/帮助文档/官方博客）；汇总站与社区帖只作线索，
  核不到的数字要么不写、要么在字段里明示未经官网核对；
  社区雷达帖默认未核实；`valid_until` 过期即下架；
  只有真打开来源页核对过，才刷新该条的核查时间。
- 运行时数据存在 `$DSH_HOME/plugins/yangmao/data.json`（单文件 JSON，
  每次变更原子写回），删掉它即可回到种子状态。
- **内容边界（合规）**：本插件不收录 VPS / 云服务器类租用信息，以及
  在中国大陆不允许使用的服务类信息——代理 / 节点 / 机场 / VPN /
  科学上网订阅、海外银行账户、海外手机号、境外云厂商免费层等。
  规则集中在 `lib/sensitive.js`，三处生效：种子已清洗
  （`scripts/clean-seed.mjs`）；老版本数据文件在加载时自动清洗并
  写回（旧 `vps` 板块整体移除）；`yangmao_add` 与
  `yangmao_apply_refresh` 的落库路径会丢弃命中条目并在结果里
  计入 `dropped_sensitive`。skill 与自动复核指令里也写明了同一禁区。
  免费大模型 API 额度（tokens 板块）不在此列。

## 实现说明（对齐 dsh 0.2.2 线的实际 API）

- Host 插件 `lib/index.js`：`ctx.provide('yangmao', store)` 提供数据服务，
  `ctx.tools.register(defineTool(...))` 注册 7 个工具，
  `ctx.skills.register(...)` 注册刷新 skill；另以 `ctx.plugin(...)`
  注册子插件 `yangmao-auto`（`inject: ['schedule']`，宿主无此服务时
  不启用），维护自动复核任务，并给 store 挂上
  `getAutoStatus()` / `refreshNow()` 供 Web 子插件调用。
  一个实现细节：宿主在启动早期会拒绝创建 `new_once` 任务（会话创建
  提供方尚未注册），子插件的对账会在该提供方出现时及定时重试，
  直到落定（采用/创建/墓碑三者之一）。
- Web 子插件 `lib/web.js`（patch 里的第二行 `dsh-plugin-yangmao/web`）：
  依赖 `webServer` 与 `yangmao` 服务，用一条 prefix 路由托管看板页与 API
  （resource 路由只答 GET/HEAD，故用 handler 形态以便 POST 标记）。
- **页面级 UI（Client 半）**：`main` 是 keyed 槽位，按侧边栏选中的
  面板 id 派发——没选面板时宿主回落到 key `conversation`（会话），
  插件页与会话是同一个槽的两个 key，不存在「会话独占」。Client 半
  （`lib/client.js`，`__ModuleLoader__` 产物格式）按标准做法注册两处：
  `sidebar.panellist`（list，`id: 'yangmao'`、`order: 30`、字典 label +
  手写 SVG 图标）与 `main`（keyed，`key: 'yangmao'`），两处都声明
  `locale: 'yangmao'`，字典经 `ctx.locale.register` 注册（zh/en）。
  页面组件只依赖 `react` 基线、手写组件与样式（主题 token），
  不 require 任何 @deepseek-ai 内部 client 包；数据走上方 Host 路由的
  `/api/state` 与 `/api/mark`。Host 的 HTML 页保留为直达/降级页。
  机制依据：实测教程《从零写一个 DSH 插件：在左侧菜单栏加一个「测试」》
  https://jishuzhan.net/article/2117461349811617794
  （注：本仓库早期版本曾误判 `main` 为会话独占单槽、用
  `shell.overlay` 悬浮入口 + iframe 降级，已按上述机制纠正。）
- 安全提示：看板路由是同源明文 HTTP 路由，**不经过 Web UI 的一次性
  token 门禁**（0.2.2-rc.1 实测）；dsh web 默认只绑回环地址，
  请勿把该端口直接暴露到公网。

## 验证

在本机以隔离 `DSH_HOME` 对 dsh 0.2.2-rc.1 做过完整实测、并在 0.2.2-rc.3 复测通过（v0.1.1 起 peer 依赖放宽为 `>=0.2.2-rc.1 <0.3.0`，覆盖整个 0.2.2 线）：bundle 安装、
`--dump-config` 合入、服务启动与插件激活、看板页/API/标记落盘、
数据层单测；Client 半另有无头自测（`scripts/selftest-client.mjs`，
34 项断言）与宿主 combo 下发实测（启动页 boot graph 含本包 client
模块、combo 脚本 200 且内容含新版注册代码）。命令与输出摘录见
[docs/VERIFICATION.md](docs/VERIFICATION.md)。仍未验证的如实记录在该
文件末尾：Client 半在真实浏览器内的像素级渲染（需人工打开 Web UI
看一眼）与工具的端到端模型调用（需要模型 API Key）。

## 目录

```
lib/index.js    Host 插件：数据服务 + 工具 + skill + 自动更新子插件
lib/store.js    JSON 数据层（种子初始化、查询、标记、复核回写）
lib/sensitive.js 敏感内容规则（种子清洗/加载清洗/落库丢弃共用）
lib/tools.js    7 个 yangmao_* 工具定义
lib/skill.js    yangmao-refresh skill（数据口径）
lib/web.js      Web 子插件：API 与直达页路由
lib/board.html  直达/降级看板页（单文件）
lib/client.js   Client 半：侧边栏面板行 + main 整页看板（预构建格式）
scripts/selftest-client.mjs  Client 半无头自测（stub 宿主/ctx/React）
scripts/clean-seed.mjs       种子敏感内容清洗（已执行，结果已入库）
seed/yangmao-seed.json  种子快照（标记全清零）
skills/yangmao/SKILL.md 同一 skill 的文件版
cordis.patch.yml        bundle 补丁（两行插件）
```

## License

MIT
