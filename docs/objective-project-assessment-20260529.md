# goods-comm 项目客观判断报告

生成日期：2026-05-30  
项目路径：`/Users/lufeiz/Downloads/项目/codexProject/goods-comm`  
评估方法：基于当前工作目录代码、文档、脚本、最新生产审计产物、本地 smoke / release gate 验证、一次 H5 Browser 渲染 QA，以及 4 个只读 agent 从产品、前端、后端、测试发布四个视角交叉评分。Git 历史从本次本地初始化后的项目快照开始，因此本文主要基于当前文件状态和本轮提交链判断。

## 1. 一句话结论

`goods-comm` 是一个方向清楚、主链路较完整、工程化程度明显高于普通页面 Demo 的社区 LBS 二手交易 MVP。它已经具备端侧页面、LBS 领域规则、BFF 契约、Node HTTP 后端、PostgreSQL schema、四环境配置、风控/运营雏形、发布门禁和较多 smoke 验证。

但从第一性原理看，它还不能被判断为“可生产上线”的真实交易产品。交易产品成立的关键不是页面能点通，而是可信身份、可信位置、可信数据、可信审核、可信通知、可信告警、可信部署和可验证履约都在真实环境里闭环。当前普通生产审计仍为 `BLOCKED (50 blockers, 9 warnings)`，严格审计仍为 `BLOCKED (52 blockers, 7 warnings)`。

最终判断：

```text
可演示，可继续迭代，可做封闭试点；不可直接生产上线承载真实交易。
```

综合评分：`63/100`。这个分数不是简单平均，而是把“生产可信度”作为交易产品的硬门槛加权后的结果；本轮 H5 渲染主链路验证和异常路径修复提升了工程可信度，但真实 pre/prod 资源缺口仍压低上线分。

## 2. 第一性原理拆解

一个“同社区 / 同街道二手交易”产品至少要满足 8 个底层条件：

1. 有真实供给：卖家能发布真实商品，商品有图片、审核、状态和可见性控制。
2. 有真实需求：买家能浏览、搜索、筛选、查看详情并发起交易。
3. 有空间匹配：系统能判断买卖双方是否在允许范围内，且不能信任客户端伪造位置。
4. 有可信身份：用户身份能跨设备、跨会话稳定识别，能注销、封禁、审计。
5. 有可信交易记录：商品、交易、评价、举报、通知和位置审计不能只存在本机。
6. 有安全与合规边界：联系方式、精确位置、违规内容、协议确认和运营操作都要可控。
7. 有履约与争议处理：线下交易要有状态机、证据、举报、争议、通知和客服处理路径。
8. 有可交付运维能力：四环境隔离、部署、数据库迁移、数据同步、监控、发布门禁和回归验证能跑通。

当前项目在第 1、2、4、5、6、7 点上已经有较完整代码雏形；第 3 点有正确的服务端裁决方向，但缺真实腾讯地图 Key、社区/街道网格和生产验证；第 8 点有脚本和审计框架，但真实云资源、工具链和部署后 smoke 仍未闭环。

## 3. 评分总览

| 视角 | 分数 | 判断 |
| --- | ---: | --- |
| 产品与用户价值 | 58/100 | 近场二手交易场景真实，主链路较完整；商业模式、冷启动、线下履约、用户增长和运营成本没有验证。 |
| 前端 / 小程序工程 | 77/100 | 页面、service、domain、平台封装和多端构建较完整；状态分散、页面逻辑重复、真机矩阵不足；本轮发现的运营台通知 fallback、首页空定位和详情页空坐标异常路径已修复并加了 smoke / 页面契约防回归。 |
| 后端 / 数据 / 安全 | 66/100 | 后端边界、schema、幂等、适配器、请求体上限、基础安全响应头、客户端 IP 限流、接口级配额、认证主体写请求配额、可信代理白名单、运营登录锁定和 fail-closed 意识较好；发布重试已能在外部文本审核前命中幂等重放，审核 `openid` 已绑定服务端 session；PostgreSQL snapshot rewrite 已用事务级 advisory lock 串行化；真实 DB、凭据、边缘 WAF、分布式限流和增量仓储不足。 |
| 测试 / 发布 / 运维 | 59/100 | release gate、artifact smoke、页面契约 smoke、主流程证据矩阵、H5 渲染主链路 smoke 和 strict workflow 较完整；真实部署后 smoke、微信/支付宝真机矩阵、工具链和真实云资源仍 blocked，普通门禁容易被误读为上线门禁。 |
| 加权综合 | 63/100 | 适合作为作品集、内部 MVP、pre 环境闭环和小范围试点，不适合作为已上线产品对外承诺。 |

按使用场景拆开看更准确：

| 使用场景 | 判断 | 成熟度 |
| --- | --- | ---: |
| 作品集 / 技术展示 | 有亮点，能展示产品完整度和工程推进能力 | 83/100 |
| 内部 MVP 验证 | 可以继续投入，适合做封闭试点 | 74/100 |
| 商业化产品验证 | 需要真实社区资源、冷启动和收入假设 | 56/100 |
| 真实生产上线 | 当前不建议上线 | 50/100 |

## 4. 关键证据

| 证据 | 说明 |
| --- | --- |
| `README.md:1-18` | 项目定位为微信、支付宝通用社区二手交易小程序，已列出浏览、发布、LBS、交易、运营、协议和 BFF 契约。 |
| `src/pages.json:2-75` | 页面包含集市、发布、交易、我的、详情、运营控制台、协议与隐私页，产品骨架不是空壳。 |
| `src/config/app.js:21-32` | 默认同社区 1200m、同街道 4000m，交易范围有集中配置。 |
| `src/domain/eligibility.js:16-96` | 同社区 / 同街道 + 距离的 LBS 资格判断被抽成纯领域逻辑，是项目的核心业务资产。 |
| `src/bff/handler.js:120-252` | BFF 契约覆盖登录、上传、商品、交易、评价、通知、举报、运营、审核和争议处理。 |
| `src/bff/handler.js:260-334` | 主要写请求有 `Idempotency-Key` 机制，弱网重试和重复点击风险有处理意识。 |
| `src/services/goods.js:51-55` / `src/bff/handler.js:672-690` | 端侧无有效坐标时不请求远端列表；本地和远端公开商品列表复用 LBS 交易资格规则，只返回当前位置可交易范围内的在线商品。 |
| `backend/src/server.mjs:22-73` | Node HTTP 后端装配 state store、平台登录、对象存储、内容安全、区域解析、平台通知、生产告警、运营鉴权和限流器。 |
| `backend/src/server.mjs:117-176` | `/health` 和 `/health/ready` 能暴露运行环境、依赖状态和 `opsAlert` 告警配置，适合部署后验收。 |
| `backend/src/rate-limiter.mjs` / `scripts/rate-limiter-smoke.mjs` / `scripts/backend-smoke.mjs` | 后端在进入业务 handler 前执行客户端 IP、接口级和认证主体写请求三层基础限流，超频请求返回 `429 TOO_MANY_REQUESTS`；认证主体只保存 token / 密钥哈希，不保存明文。 |
| `backend/src/server.mjs` / `scripts/backend-smoke.mjs` | 后端只在直连来源命中 `GOODS_COMM_TRUSTED_PROXY_IPS` 时信任 `x-forwarded-for`，并用 smoke 覆盖不信任伪造头和可信代理转发两种限流路径。 |
| `backend/src/ops-alerts.mjs` / `scripts/ops-alerts-smoke.mjs` / `scripts/backend-smoke.mjs` | 后端已有生产告警适配器，平台通知失败会发送脱敏告警；smoke 覆盖关闭态、Webhook 投递、鉴权头、占位 URL 拒绝、pre/prod HTTPS 要求和 HTTP 后端集成。 |
| `backend/src/server.mjs:1319-1354` / `scripts/backend-smoke.mjs` / `scripts/deployed-health-smoke.mjs` | JSON、OPTIONS 和资产响应已统一带 `x-content-type-options`、`x-frame-options`、`referrer-policy`、`permissions-policy`，pre/prod 还会加 HSTS；后端 smoke 和部署后 health smoke 已断言这些响应头。 |
| `backend/src/server.mjs:1135-1184` | 后端在 JSON / multipart 解析前执行请求体大小上限，超限请求返回 `413 PAYLOAD_TOO_LARGE`。 |
| `backend/db/schema.sql:5-260` | PostgreSQL schema 覆盖用户、会话、幂等、商品、图片、交易、争议、评价、位置审计、举报、通知。 |
| `package.json:7-74` | 三端构建、四环境构建、后端构建、smoke、部署 plan、生产审计和 release gate 已脚本化。 |
| `scripts/verify-release-gate.mjs:23-31` | 只有 `release` profile 执行 strict check；quick/full profile 只生成生产审计报告，不能等同于上线放行。 |
| `.github/workflows/ci.yml:28-29` / `.github/workflows/release-strict.yml:107-193` | 默认 CI 跑 `verify:release`，真实上线前 strict gate、部署后 smoke、prod opt-in 在手动 workflow 中。 |
| `docs/environment-matrix.md:7-87` | dev/test/pre/prod 四环境原则、关键变量和 pre/prod 保护规则写得较完整。 |
| `docs/deployment-readiness-audit.md:5` | 普通生产审计仍为 `BLOCKED (50 blockers, 9 warnings)`。 |
| `docs/deployment-readiness-audit-strict.md:5` | 严格生产审计仍为 `BLOCKED (52 blockers, 7 warnings)`。 |
| `src/pages/ops/ops.vue:452-479` / `scripts/page-contract-smoke.mjs:134-173` | 运营台通知投递 fallback 已改为使用外层 `moderationQueue`，页面契约 smoke 也禁止再出现作用域外 `queue.notificationDeliveries` 引用。 |
| `src/services/goods.js:1747-1752` / `src/pages/detail/detail.vue:411-419` | 商品列表和详情页坐标判断都已对 `null` / 非对象位置 fail closed，避免无定位或异常商品位置导致首屏/详情渲染崩溃。 |
| `scripts/main-flow-contract-smoke.mjs` | 主流程证据矩阵把登录协议、定位可信边界、发布图片、交易售卖生命周期、部署后 smoke 和 release gate 串成 5 条可回归检查。 |
| `scripts/h5-render-smoke.mjs` | 真实启动 H5 构建产物和 headless Chrome，验证登录、浏览器定位显示、商品发布、买家发起交易、卖家确认和完成售卖的渲染级主链路。 |

## 5. 项目优势

### 5.1 产品主链路完整

项目已经覆盖浏览、搜索、发布、详情、LBS 校验、交易意向、卖家确认、完成 / 取消 / 争议、评价、举报、通知、账号注销、用户封禁和运营处理。对 MVP 来说，这不是单页 Demo，而是有完整交易流程意识的产品原型。

### 5.2 LBS 差异化清楚

它不是泛二手平台，而是把交易限定在同社区 / 同街道，用近场位置降低信任成本和履约成本。`src/domain/eligibility.js` 的纯函数化设计也让这部分规则能同时用于交易准入和本地 / 远端列表展示，降低“看得到但不能交易”的产品割裂。

### 5.3 后端与数据边界已经成型

项目不再只依赖端侧 localStorage。它已经有 BFF handler、Fetch adapter、Node HTTP 后端、文件 store、PostgreSQL schema、PostgreSQL store、请求体大小上限、基础安全响应头、客户端 IP / 接口 / 认证主体写请求三层基础限流、可信代理白名单、运营登录失败锁定和后端构建产物。生产依赖虽然未落地，但系统边界已经从“页面能跑”推进到“后端契约可验证”。

### 5.4 风控和运营意识较强

登录、协议确认、内容安全、举报、封禁、争议、运营审计、通知 outbox、通知重试和端侧遥测都有实现或脚本支撑。对交易类产品，这是正确方向。

### 5.5 发布门禁比普通 MVP 更完整

`verify:release` / `verify:release:quick` / `verify:release:strict` 把语法检查、smoke、构建、页面契约、产物检查、部署 plan、同步 plan 和生产审计串成同一入口。构建产物审计显示后端 artifact 和 pre/prod 三端前端 artifact 已通过完整性检查。

需要注意：`verify:release` 是发布候选门禁，当前会生成生产审计报告但不会因为占位 pre/prod 资源直接失败；真正上线应以 `verify:release:strict`、`audit:production-readiness:strict-check`、部署后 health smoke 和主链路 smoke 为准。

### 5.6 四环境和数据同步意识明确

文档明确 dev/test/pre/prod 的职责，pre/prod 要保持同拓扑但不同数据库和对象存储；prod 到 pre 同步有计划、锁、审计和脱敏 SQL。2026-05-30 续做后，生产审计和同步脚本共用同一份 pre/prod 拓扑一致性变量清单，接口级限流、认证主体限流和 PostgreSQL advisory lock 不一致都会在同步前被 smoke 覆盖。这是生产化项目才会考虑的问题。

## 6. 项目短板

### 6.1 生产环境事实没有落地

这是最大短板。pre/prod 仍缺真实 API 域名、数据库连接串、COS/CDN、腾讯地图 Key、平台 AppID/AppSecret/支付宝私钥、订阅消息模板、session/ops secret、运营账号、CloudBase/Tencent 部署配置、非交互云凭据，以及 `cloudbase/tcb`、`docker`、`tccli`、`psql`、`pg_dump`、`pg_restore` 等工具链。

所以当前只能证明“生产化方向和门禁设计正确”，不能证明“生产环境可用”。

### 6.2 商业模式和冷启动没有验证

社区二手交易最大难点不是写交易状态机，而是本地供给密度、用户信任、持续活跃和运营成本。当前代码没有明确佣金、广告、会员、物业合作、校园服务或本地服务撮合等收入假设，也没有真实社区冷启动策略。

### 6.3 真实身份和真实位置未生产验证

代码已有微信/支付宝平台身份边界和腾讯地图解析适配器，但没有真实 AppID/AppSecret、支付宝私钥、腾讯地图 Key 和正式社区/街道网格数据。LBS 是本项目核心卖点，这部分没有真实验证前，产品价值不能按上线标准打高分。

### 6.4 PostgreSQL store 仍是桥接模式

`backend/src/postgres-state-store.mjs` 已接规范化表，但当前仍偏 snapshot rewrite：读取整体状态，再按表重写。2026-05-30 续做后，写事务会获取可配置的 PostgreSQL transaction-level advisory lock，并由 `smoke:postgres-store` 断言锁语句，能避免多实例并发 rewrite 互相覆盖；同时仍有 `GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS=20000` 保护。这个形态对迁移和 smoke 够用，但对真实高并发交易、部分失败恢复、增量审计和规模增长仍不如按聚合根增量 SQL 写入。

### 6.5 核心模块过大，后续维护风险偏高

当前关键文件行数偏大：

```text
src/bff/handler.js                    3056
backend/src/postgres-state-store.mjs  2230
src/services/goods.js                 1807
backend/src/server.mjs                1440
src/pages/ops/ops.vue                  969
backend/src/rate-limiter.mjs           400
```

业务规则、状态机、序列化、鉴权、审核、通知和运营逻辑仍有大文件集中问题。2026-05-30 续做后，HTTP 限流已从 `backend/src/server.mjs` 抽到 `backend/src/rate-limiter.mjs`，并补 `smoke:rate-limiter` focused smoke；这降低了 server 入口继续膨胀的风险，但 BFF、PostgreSQL store 和 goods service 后续仍应继续拆分。

### 6.6 测试覆盖仍偏 smoke

当前 smoke 覆盖面很广，这是优点；H5 渲染主链路已经能用 headless Chrome 自动验证。但还缺正式测试分层、覆盖率、微信 / 支付宝开发者工具自动化、真机定位权限矩阵、真实平台登录 code、真实图片审核回调、真实订阅消息送达和真实 PostgreSQL 连接主链路。

本轮实际执行 `npm run smoke:pages`、`npm run smoke`、`npm run smoke:main-flow-contract`、`npm run smoke:h5:render` 和 `npm run verify:release:quick -- --skip-http-backend` 通过，其中 quick release gate 已接入 H5 渲染主链路 smoke，并完成 `88/88` 项。2026-05-30 续做后新增主流程证据矩阵，把登录协议与账号生命周期、定位解析与显示可信边界、发布与图片上传、交易售卖生命周期、部署后 smoke 和 release gate 串成 5 条主链路证据；同时新增 CDP 驱动的 H5 渲染 smoke，真实启动构建产物并验证登录、浏览器定位显示、发布、交易和售卖状态流。H5 Browser 渲染 QA 也覆盖了首页首屏、搜索交互、移动视口，以及首页无定位时不再出现 `Cannot read properties of null (reading 'latitude')`。后续又新增生产告警适配器和 `smoke:ops-alerts`，quick release gate 当前完成 `95/95` 项；同时刷新普通和严格生产审计，当前仍分别是 `BLOCKED (50 blockers, 9 warnings)` 与 `BLOCKED (52 blockers, 7 warnings)`，新增 blocker 来自真实告警 Webhook URL/token 等上线前置输入。

### 6.7 发布门禁口径容易被误读

`verify:release` 适合日常 CI 和发布候选检查，但它在非 release profile 下只生成生产就绪报告；如果团队只看 CI 绿色，就可能误以为已经可上线。真实上线必须跑 strict gate，并且 strict gate 还要求真实 API、真实部署后 smoke 输入、真实云工具链和密钥。

### 6.8 公网安全硬化还不完整

后端已有 CORS、请求体上限、基础安全响应头、单进程客户端 IP 限流、接口级配额、认证主体写请求配额、可信代理 `x-forwarded-for` 白名单、运营登录失败锁定和会话 token hash，这是正确基础；但公网生产还缺真实代理 IP / 网段配置、分布式限流、WAF/网关策略和云侧攻击防护。当前进程内限流不能替代网关级防护。

### 6.9 合规和履约仍不完整

平台目前记录交易意向、状态、评价和争议，但支付、验货、线下安全、纠纷证据和担保履约仍主要在线下完成。用户协议 / 隐私政策也需要法务审核和平台后台配置后才能算正式闭环。

### 6.10 用户体验还偏工程化

登录、协议确认、实时 GPS、LBS 校验、卖家确认、一次性联系码等设计是安全上合理的，但对用户来说步骤较重。运营控制台和部分复杂页面信息密度较高，还不是成熟设计系统。

### 6.11 页面异常路径已修复，但仍需 E2E

本轮已修复 `src/pages/ops/ops.vue:452-479` 的通知投递 fallback 作用域问题：运营队列结果提升为外层 `moderationQueue`，通知投递接口失败时可回退到队列里的 `notificationDeliveries`，或安全返回空数组。`scripts/page-contract-smoke.mjs` 增加了静态契约，防止再次引用作用域外 `queue.notificationDeliveries`，并要求详情页坐标判断显式处理 `null` / 非对象位置。首页商品列表侧也已修复空定位输入导致的 `latitude` 读取异常，并在 `scripts/smoke.mjs` 中补了 `currentLocation: null/undefined` 回归断言。核心 H5 / 小程序页面也已补 `data-testid` 渲染测试锚点，覆盖首页、发布、详情、交易、我的、定位组件和商品卡片；交易页继续补充通知已读、交易状态、联系码、争议、售卖动作、评价评分、评价标签、评价输入和提交评价锚点，并为重复动态元素补充交易 id、状态、评分、标签等选择器属性；运营台继续补充登录、用户风控、商品审核、举报、争议、通知重试、端侧事件和操作审计锚点，并带用户 / 商品 / 举报 / 争议 / 通知 / 审计 id 选择器。`smoke:pages` 会阻断这些主流程测试锚点被误删，`smoke:artifacts` 会继续确认这些锚点和选择器属性在 H5 / 微信 / 支付宝编译产物中真实保留。

这个修复降低了运营台异常路径风险，也为渲染级自动化提供了稳定定位元素。`smoke:main-flow-contract` 已经进一步降低页面、service、BFF、部署后 smoke 各自通过但主链路证据断裂的风险；`smoke:h5:render` 已经把 H5 登录、定位、发布、交易和售卖主路径纳入真实浏览器渲染验证。页面层剩余缺口主要是微信 / 支付宝开发者工具、真机权限矩阵和更多接口失败模拟，而不能只依赖主路径 smoke。

### 6.12 发布幂等已前置到内容安全前

HTTP 发布入口现在先完成服务端区域解析，再用 BFF 幂等记录尝试重放已有成功结果或已提交审核拒绝错误；命中后不再调用外部文本内容安全。幂等请求哈希也不再把服务端注入的 `serverRegion` 和 `moderation` 当作端侧业务意图，降低弱网重试重复触发微信审核、重复追加审核事件或放大外部依赖成本的风险。后端 smoke 已用调用计数覆盖成功重放、幂等键冲突和审核拒绝重放。

### 6.13 内容安全身份已绑定服务端 session

图片上传和商品文本审核现在都会先解析服务端 session，再把 session 绑定用户的微信 `openid` 传给内容安全适配器。客户端提交的 `sellerOpenid`、`platformId` 或类似审核身份字段会被移除，既不会进入微信审核 payload，也不会写入商品响应。后端 smoke 已覆盖图片审核 openid、文本审核 openid、客户端伪造审核身份剥离和幂等重放不重复审核；部署后主链路 smoke 也会黑盒验证未登录上传被拒绝，以及公开商品响应不会泄露客户端伪造的审核身份字段。

## 7. 多 agent 交叉评分

本轮使用 4 个只读 agent 分别从产品、前端、后端、测试发布视角评估。四个分数不一致是正常的，因为它们评估的是不同目标函数。

| Agent 视角 | 本轮评分 | 核心结论 |
| --- | ---: | --- |
| 产品与用户价值 | 58/100 | LBS 差异化和用户闭环成立；冷启动、商业模式、真实社区运营、履约成本和收入假设未验证。 |
| 前端 / 小程序工程 | 77/100 | 页面/service/domain/BFF 边界清楚，三端构建和平台封装较完整；状态分散、页面逻辑重复、真机验证不足；本轮发现并修复运营台通知 fallback、首页空定位和详情页空坐标异常路径。 |
| 后端 / 数据 / 安全 | 66/100 | HTTP 后端、BFF、schema、幂等、会话 hash、请求体上限、基础安全响应头、IP / 接口 / 认证主体写请求限流、可信代理白名单和 fail-closed 方向较好；发布幂等已前置到外部内容安全前，审核身份已绑定服务端 session；PostgreSQL snapshot rewrite 已有事务级 advisory lock；真实 DB、凭据、分布式限流、WAF、增量仓储不足。 |
| 测试 / 发布 / 生产就绪 | 59/100 | npm scripts、smoke、主流程证据矩阵、H5 渲染主链路 smoke、release gate 和 strict workflow 完整度较好；真实部署、部署后 smoke、工具链、微信/支付宝真机矩阵仍 blocked，且普通 CI 绿色不能代表可上线。 |

交叉后的客观判断：

1. 如果目标是作品集或内部技术展示，这个项目有明确亮点。
2. 如果目标是 MVP 继续迭代，应该继续做，但先做单社区 / 单园区封闭试点。
3. 如果目标是真实生产上线，当前不应上线。
4. 如果目标是商业化产品，需要先验证冷启动、供给密度、留存、交易完成率和收入假设。
5. 如果目标是团队协作长期维护，应该继续拆分大模块，并补页面 E2E 和真机矩阵。

## 8. 是否值得继续投入

值得继续投入，但目标要从“直接上线”降到“真实 pre 环境闭环 + 单社区试点”。

原因：

1. 差异化成立：近场二手交易有明确用户问题，LBS 规则不是装饰功能。
2. 工程底座可延续：domain、BFF、backend、schema、smoke、release gate 都有可复用资产。
3. 最大风险不是方向错，而是生产事实未补齐和商业验证未开始。
4. 继续投入的下一步可以很具体，不需要推倒重来。

不建议继续投入的情况：

1. 如果预期是短期直接上线收费，当前风险过高。
2. 如果没有真实社区、校园、园区或物业资源，冷启动很难靠代码解决。
3. 如果不准备补真实后端、数据库、地图、对象存储、内容安全和平台登录，这个项目只能停留在 Demo。

## 9. 推荐路线图

### 阶段一：真实 pre 环境闭环

1. 替换 `.env.pre.local` 中所有占位配置：真实 HTTPS API、PostgreSQL/TencentDB、COS/CDN、腾讯地图 Key、平台 AppID/AppSecret、session/ops secret、订阅消息模板、运营账号。
2. 执行 `backend/db/schema.sql` 到真实 pre 数据库。
3. 部署 `dist/backend` 到 CloudBase 或腾讯云。
4. 跑通 `/health`、`/health/ready`、`npm run smoke:deployed:pre`。
5. 用真实 seller/buyer 平台 code 跑通 `npm run smoke:deployed:pre:main`。

### 阶段二：单社区 / 单园区试点

1. 选择 1-2 个真实社区、园区或校园。
2. 准备真实社区/街道网格数据。
3. 记录核心指标：有效商品数、发布转化率、交易意向率、卖家确认率、完成率、举报率、7 日留存。
4. 观察用户是否愿意承担“登录 + 定位 + 卖家确认”的交易摩擦。

### 阶段三：工程结构收敛

1. 给运营台补渲染级异常路径 E2E，覆盖通知投递接口失败、队列 fallback 和用户风控失败分支。
2. 拆分 `src/bff/handler.js`：商品、交易、举报、通知、运营分模块。
3. 拆分 `src/services/goods.js`：商品 service、交易 service、通知 service、评价/争议 service。
4. 把 PostgreSQL store 从 snapshot rewrite 改为按聚合根增量 SQL 写入。
5. 增加领域单测、BFF 契约测试、PostgreSQL 集成测试、页面 E2E、真机权限矩阵。

### 阶段四：生产上线准入

只有满足以下条件后，才建议进入真实上线：

1. `npm run audit:production-readiness -- --check-only` 通过，blocker 归零。
2. `npm run audit:production-readiness:strict-check` 通过，strict blocker 归零。
3. `.env.pre.local` / `.env.prod.local` 或云环境变量替换所有占位值和 example 域名。
4. pre/prod 使用真实独立数据库和对象存储，而不是不同占位字符串。
5. `/health/ready` 在 pre/prod 均通过，且实际使用 `postgres`、`cos`、`tencent` 地图、`wechat` 内容安全和通知、`webhook` 生产告警。
6. `smoke:deployed:pre` 和 `smoke:deployed:pre:main` 在真实 HTTPS API 上通过。
7. 微信 / 支付宝真实登录 code、COS 上传/CDN 访问、微信内容安全回调、微信订阅消息送达和通知重试链路通过。
8. 网关/WAF、分布式限流、实际可信代理 IP / 网段、生产日志采集和值班告警策略配置完成，并在真实云侧跑通部署后 health smoke，确认安全响应头和 `opsAlert=webhook` 未被代理或环境变量覆盖。
9. 用户协议 / 隐私政策、平台隐私配置、合法域名、备案或平台要求材料完成。
10. 至少一轮微信 / 支付宝开发者工具导入验证、真机定位权限矩阵和页面 E2E 通过。

## 10. 最终判断

`goods-comm` 的优点是真实的：方向清楚，MVP 主链路完整，LBS 领域建模有价值，后端和数据库边界已成型，发布门禁也比普通个人项目更严谨。

它的问题也是真实的：没有真实生产环境、没有真实平台身份和地图验证、没有真实数据库 / 对象存储 / 内容安全 / 通知闭环，也没有商业冷启动和收入假设验证；模块体量、页面 E2E 缺口、网关安全和 strict gate 误读风险也需要正视。

所以最客观的判断是：

```text
这是一个值得继续推进的生产化 MVP，不是一个已经可以上线承载真实交易的产品。
```
