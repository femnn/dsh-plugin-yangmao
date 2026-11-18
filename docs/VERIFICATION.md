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

## 未验证项（如实）

- **Client 半（lib/client.js）的浏览器内渲染**：格式逐项对照一厂包
  `@deepseek-ai/dsh-client-ui-jobs` 的产物手写（`__ModuleLoader__.load` +
  `./client` 导出 + `dsh.client` 声明），但无头环境拿不到 Web UI 的
  一次性 token（`/api/client-modules` 返回 401），未能实测悬浮入口在
  真实 Web UI 里出现。Host 侧看板页（同一块 UI 的服务端版本）已实测可用，
  client 半不出现时不影响任何 Host 功能。
- **工具被模型实际调用**：需要可用的模型 API Key 才能跑 agent 会话，
  本次以「apply 完成 + 无激活警告」为注册成功证据，未做端到端对话调用。
