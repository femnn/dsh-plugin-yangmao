// The yangmao-refresh skill: teaches the agent the board's data rules so a
// "刷新羊毛" request becomes a disciplined verify-and-write-back pass, not a
// free-form scrape. The same text ships as skills/yangmao/SKILL.md for
// filesystem-based skill discovery.
export const SKILL_NAME = 'yangmao-refresh';

export const SKILL_CONTENT = `# 薅羊毛看板刷新与查询口径（yangmao-refresh）

你维护一个「薅羊毛情报」看板：主清单 deals（分类 food/shop/telecom/bank/member/cloud/llm）
加两块侧板 radar（社区雷达帖）/ tokens（免费大模型额度）。
全部读写都走 yangmao_* 工具，不要直接改数据文件。

## 数据口径（铁律）

1. **金额、门槛、免费量只认官网原文**：活动页、定价页、帮助文档、官方博客。
   汇总站、社区帖、转载只能当线索——顺线索找到官网原文核对后才能写入主清单；
   官网核不到的数字，要么不写，要么在字段里明示「汇总站称/社区帖称，未经官网核对」。
2. **主清单只收已核实条目**：社区帖（linux.do 等）的新线索先记心里或进 radar，
   不得直接写进 deals。radar 条目默认 unverified，不要把帖子标题里的金额当事实复述。
3. **过期即下架**：valid_until 早于今天的条目视为过期；刷新时会被自动清除，
   你确认活动已结束的条目放进 retire_titles 主动下架。
4. **核查时间就是 verified_at**：只有你真的打开来源页核对过，才能让条目进
   confirmed_titles（仅刷新核查时间）或 upserts（内容有变）。没打开过的不要碰。
5. **绑卡口径要写清**：card_req 必须明示是否需要绑卡/实名/新用户资格；
   官网没写明的就写「官网未明文」，不要猜。
6. **用户标记是用户本人的事**：claimed/saved/read 只按用户明确指示修改，
   刷新时不得重置它们；种子/发行数据里这些标记恒为未标记。

## 禁区（不收录）

以下类别一律不收录，搜到也不要提交（写进 upserts / yangmao_add 也会被
数据层按 sensitive 规则丢弃，并计入 dropped_sensitive）：

- VPS、云服务器、轻量服务器、云主机、云电脑类租用/白嫖信息；
- 代理、节点、机场、VPN、梯子、科学上网，以及
  Clash / Shadowsocks / V2Ray / Xray / Trojan 订阅类信息；
- 海外银行账户与境外金融账户（如 Wise、Revolut、Payoneer、万里汇）；
- 海外手机号 / 境外 SIM 卡（如 Google Voice、giffgaff、TextNow）；
- 境外云厂商的免费层与免费试用（如 Oracle Cloud、AWS、Azure、GCP 等 IaaS）。

注意区分：免费大模型 API 额度（tokens 板块的本行）不在此列；
国内银行的境外消费优惠、国内运营商的 eSIM 业务也不在此列。

## 被要求「刷新羊毛」时

1. 先 yangmao_stats 看总量与 last_refreshed_at，再 yangmao_search 分批拉现有条目
   （可按分类逐个过；include_expired 默认关，过期条目不用逐个核）。
2. 逐条打开 source_url 核对：金额、门槛、有效期、领取方式有没有变。
   - 没变 → 标题进 confirmed_titles。
   - 变了 → 整个条目（照官网新原文改字段）进 upserts（按 title 匹配更新）。
   - 活动结束/页面下架/官网明确终止 → 标题进 retire_titles。
   - 打不开/登录墙挡住 → 本轮跳过，不要动它的 verified_at，如实向用户说明。
3. 发现新羊毛：先找官网原文核实，再 yangmao_add（或随本轮 upserts 一起写）。
4. 最后一把 yangmao_apply_refresh 回写，报告：新增/更新/确认/下架/过期清除各多少条，
   哪些条目本轮没核到以及原因。

## 查询时

- 「今天有什么值得领」→ yangmao_featured。
- 按品类/关键词找 → yangmao_search；问免费额度 → yangmao_boards board=tokens；
  问社区有什么新帖 → board=radar（提醒用户：雷达帖未经核实）。
- 用户说领过了/收藏一下 → yangmao_mark，不要口头答应了事。
`;

export const SKILL = {
  name: SKILL_NAME,
  description: '薅羊毛看板（yangmao）的数据口径与刷新流程：金额/门槛只认官网原文、过期下架、核查时间规则；被要求刷新羊毛时按此联网复核并用 yangmao_apply_refresh 回写。',
  whenToUse: 'When the user asks to refresh/verify the yangmao deals board （刷新羊毛）, or asks what deals are worth claiming, or wants to add/mark deals.',
  source: 'custom',
  content: SKILL_CONTENT,
};
