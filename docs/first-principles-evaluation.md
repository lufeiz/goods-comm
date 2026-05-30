# goods-comm 第一性原理评估报告

评估日期：2026-05-30  
项目路径：`/Users/lufeiz/Downloads/项目/codexProject/goods-comm`  
评估方法：不先按“功能清单”判断，而是先拆解一个社区二手交易小程序必须成立的底层条件，再逐项映射到当前代码证据。

生产化补充：逐项解决方案与本轮落地状态见 `docs/production-hardening-plan.md`；BFF / 云函数接口契约见 `docs/api-contract.md`；更完整的当前客观评分见 `docs/objective-project-assessment-20260529.md`。

## 1. 总结论

`goods-comm` 当前是一个结构清晰、可运行、可演示的社区二手交易小程序 MVP。它已经具备双端小程序框架、基础页面、发布、浏览、详情、登录缓存、定位权限、LBS 预校验、交易意向记录和构建脚本。项目最有价值的工程选择，是把交易资格判断抽成纯领域函数，后续迁移到服务端的成本相对低。

但从第一性原理看，二手交易产品真正成立的前提不是“页面能点通”，而是“身份、位置、商品、交易意向都在可信边界内被记录和校验”。当前项目已经补出可运行 Node HTTP 后端、文件持久化 smoke store、数据库 DDL、腾讯地图区域解析适配器和后端构建产物；但正式云部署、真实数据库事务、平台 `code2Session` 凭据、真实腾讯地图 Key、社区网格数据、对象存储和内容安全仍未接入，因此它适合 Demo、作品集、内部验证，不适合直接生产上线承载真实交易。

当前成熟度判断：

| 维度 | 判断 |
| --- | --- |
| 演示完整度 | 较好，可以说明核心想法 |
| 代码结构 | 较清晰，模块边界基本合理 |
| 小程序可构建性 | 已验证通过 |
| 业务可信性 | 有后端契约和本地 HTTP 后端，但生产可信依赖仍未接入 |
| 生产上线 readiness | 不建议直接上线 |

## 2. 第一性原理框架

一个“同社区 / 同街道二手交易小程序”至少需要满足七个底层条件：

1. 有供给：卖家能发布物品，并且物品能被其他用户看到。
2. 有需求入口：买家能搜索、筛选、查看详情。
3. 有空间匹配：系统能判断买卖双方是否在允许交易范围内。
4. 有可信身份：用户身份能跨设备、跨会话被稳定识别。
5. 有可信事实记录：商品、交易意向、位置审计不能只存在于本机。
6. 有风控和隐私边界：联系方式、精确位置、违规内容不能无保护暴露。
7. 有可演进工程基础：构建、测试、模块边界、配置方式能支撑后续迭代。

以下所有判断都围绕这七个条件展开。

## 3. 证据总览

### 3.1 产品形态与页面骨架成立

项目明确定位为微信、支付宝双端社区二手交易小程序，README 也说明一套 `uni-app + Vue 3` 代码编译到 `mp-weixin` 和 `mp-alipay`（`README.md:1-4`）。页面配置包含集市、发布、交易、我的、详情五个页面，其中前四个进入 TabBar，详情页作为非 TabBar 页面进入（`src/pages.json:1-64`）。

这说明当前不是空壳项目，产品主路径已经具备：

- 集市页：商品列表、搜索、分类、定位刷新、进入详情（`src/pages/home/home.vue:11-17`, `src/pages/home/home.vue:19-55`, `src/pages/home/home.vue:122-140`）。
- 发布页：表单、分类、成色、交易范围、距离半径、发布位置、提交（`src/pages/publish/publish.vue:11-80`, `src/pages/publish/publish.vue:237-264`）。
- 详情页：展示物品、交易资格、刷新/选择校验位置、举报、发起交易（`src/pages/detail/detail.vue`）。
- 交易页：读取已发起交易意向并展示状态和定位审计摘要（`src/pages/orders/orders.vue:3-21`, `src/pages/orders/orders.vue:41-76`）。
- 我的页：登录、定位、交易规则、隐私与风控提示（`src/pages/mine/mine.vue:12-24`, `src/pages/mine/mine.vue:38-62`）。

### 3.2 技术栈简单且目标明确

`package.json` 将目标平台和脚本写得比较清楚：微信、支付宝、H5 三类构建入口都存在，并有 `smoke` 验证脚本（`package.json:7-14`）。核心依赖集中在 `@dcloudio/uni-*`、`vue`、`vite`，没有引入复杂状态管理或 UI 框架（`package.json:15-25`）。Vite 配置也只是接入 `@dcloudio/vite-plugin-uni`（`vite.config.js:1-8`）。

这对 MVP 是优点：依赖面小、认知成本低、迁移空间较大。

### 3.3 LBS 业务规则被抽成纯领域逻辑

交易范围的默认规则写在配置里：同社区半径 1200 米，同街道半径 4000 米（`src/config/app.js:13-24`）。核心校验在 `src/domain/eligibility.js` 中完成，输入是物品、用户位置、用户行政区，输出是 `ELIGIBLE`、`OUT_OF_RANGE`、`REGION_UNKNOWN`、`REGION_MISMATCH` 等明确结果（`src/domain/eligibility.js:16-96`）。

这部分设计是项目的主要亮点：

- 校验前先兜底物品、当前位置、卖家位置、坐标有效性（`src/domain/eligibility.js:16-36`）。
- 同时检查距离和社区/街道匹配，只有两者都成立才通过（`src/domain/eligibility.js:38-55`）。
- 行政区匹配逻辑独立，按 `communityId` 或 `streetId` 判断（`src/domain/eligibility.js:98-127`）。
- 距离计算用 Haversine 公式，且对无效坐标返回 `null`（`src/utils/geo.js:21-40`）。

从工程演进角度看，这个纯函数可以被服务端或云函数复用，是后续补齐可信后端时最容易保留的资产。

### 3.4 定位编排已形成端侧闭环

定位服务完成了权限检查、获取当前位置、精度判断、区域解析、缓存和错误归一化（`src/services/location.js:44-75`, `src/services/location.js:190-220`, `src/services/location.js:238-334`）。端侧会区分权限拒绝、系统定位关闭、超时、网络异常、低精度、过期、坐标无效、区域解析失败、平台不支持和取消选择等状态，并在定位组件展示来源、精度和刷新时间。定位配置使用 `gcj02`，缓存 TTL 为 5 分钟，最大可接受精度为 200 米（`src/config/app.js:5-11`）。

小程序权限也有声明：微信端声明 `scope.userLocation`，并列出 `getLocation`、`chooseLocation` 私有信息；支付宝端也声明了定位权限说明（`src/manifest.json:8-31`）。

这说明“定位可用性”的前端基础是有的。

### 3.5 但可信边界仍在客户端，这是最大问题

第一性原理下，LBS 交易资格不能信任客户端。当前 `API_BASE_URL` 在 dev/test 默认仍可为空，未配置远端 API 时区域解析会回落本地样例区域；pre/prod 已收紧为必须走服务端区域解析，远端失败时不再使用样例区域。配置远端 API 或测试 transport 后，会通过统一 API 边界请求 `/lbs/resolve-region`。

本地样例区域只有三个上海附近社区/街道点位，并通过距离阈值解析社区或街道（`src/data/regions.js:5-42`, `src/data/regions.js:44-70`）。这对演示足够，但不能代表真实城市社区网格。

当前已经补了远端 API 边界、纯函数式 BFF 处理器和 Node HTTP 后端：端侧有 `requestApi` / `uploadApiFile`，可通过 `VITE_API_BASE_URL` 指向真实 BFF；区域解析统一走 `/lbs/resolve-region` API 边界；商品发布走 `/items` 时由服务端重算发布坐标所属社区/街道并覆盖客户端区域字段；公开商品响应只返回社区/街道等展示字段和服务端计算的 `distanceMeters`，不再暴露卖家精确坐标；交易创建走 `/trades` 时由 BFF 先校验买家定位的经纬度、时间和精度，再重新解析买家位置、重算距离和区域匹配，并写入位置审计。`backend/src/region-resolver.mjs` 已提供 dev/test 样例解析和 pre/prod 腾讯地图解析边界，pre/prod 会拒绝 mock 区域数据。`src/bff/fetch-adapter.js` 提供了可迁移到 Fetch Runtime 的适配层，`backend/src/server.mjs` 已提供可运行 HTTP 入口，`backend/src/file-state-store.mjs` 支持本地跨请求状态 smoke。问题在于它仍未部署到真实云环境，也没有接真实数据库事务和真实地图 Key / 社区网格数据。

项目文档本身也承认正式架构应由服务端完成最终资格校验：端侧只负责本地预校验和展示，最终应调用服务端（`docs/architecture.md:13-18`）；LBS 校验应由服务端逆地理编码、计算距离，并在通过后创建交易意向（`docs/architecture.md:50-60`, `docs/architecture.md:85-99`）。

结论：当前 LBS 能力已经从“纯客户端演示”提升到“端侧预校验 + BFF / HTTP 后端最终裁决 + 生产环境禁样例区域”的阶段，并且发布位置和交易位置都不再信任客户端行政区字段。但没有真实腾讯地图 Key、社区网格和云端部署之前，仍不能视为生产可信。

### 3.6 数据持久化不成立

项目目前已经有可运行 HTTP 后端、文件持久化状态 store 和 PostgreSQL 规范化表状态 store，并提供 `backend/db/schema.sql` 作为 PostgreSQL / TencentDB 建库脚本。端侧 service 已经支持远端 API 模式，BFF handler 也模拟了 `users`、`sessions`、`idempotencyRecords`、`items`、`trades`、`uploads`、`reports`、`moderationEvents`、`accountDeletions` 等状态边界。PostgreSQL snapshot rewrite 写事务已通过 transaction-level advisory lock 串行化，降低多实例并发覆盖风险；正式生产仍缺云数据库实例和真实连接验证，但代码层不再只停留在文件 store。

这意味着：

- 换设备后看不到发布记录。
- 清缓存后商品和交易意向会丢失。
- 本地 HTTP 后端可以跨请求共享状态，但多实例、跨设备、备份和审计仍依赖真实数据库。
- 无法可靠做跨设备审核、搜索索引、推荐、风控、争议处理。

对 Demo 来说文件 store 合理；对交易产品来说，真实云数据库实例、真实连接验证和云端部署仍是 P0 级缺口。

### 3.7 登录已有入口，但不是正式账号体系

认证服务已经升级为 session 模型，端侧缓存包含 `token`、`sessionExpiresAt`、`contactCode`，并支持 `/auth/login`、`/auth/logout` 与 `/auth/delete-account` 契约。BFF 示例会维护服务端 session 状态，签发密码学随机 session token，只保存基于 `GOODS_COMM_SESSION_SECRET` 的 HMAC-SHA256 `tokenHash` 而不保存明文 token，并拒绝过期、吊销或用户状态不可用的 token；退出登录会吊销当前 session，账号注销会吊销该用户所有 session；无远端 API 时端侧仍会回落本地 session。

这里的问题是：微信小程序不能只靠客户端 `code` 形成稳定可信身份，正式身份需要后端 `code2Session` 换取 `openid/unionid` 并签发自己的登录态。当前实现可用于演示登录态，但不能作为真实用户系统。

一个正向变化是：当前发布页已经强制发布前登录，未登录会提示跳转“我的”页；账号注销入口也会清理登录态、吊销 BFF session、下架活跃发布并取消相关交易。运营端也已补用户封禁 / 解封能力，封禁会吊销 session、下架活跃发布并把相关活跃交易转入争议。因此“未登录可发布”“明文 token 持久化”“没有数据删除入口”和“完全缺少封禁能力”已经不是当前主要风险；真正剩下的问题，是登录身份仍没有接入真实平台凭据、真实云数据库和更完整的风控规则 / 客服后台。

### 3.8 交易流程已有轻量履约闭环，但还不是完整交易系统

详情页发起交易前会检查登录和最终 GPS 资格，不通过则弹窗说明，通过后创建交易意向并跳转交易页。详情页也会按商品状态和当前用户身份禁用入口：`reserved` 显示交易处理中，`sold` 显示已售出，卖家查看自己发布的商品显示自己的物品，避免用户对不可交易商品继续发起无效请求。交易状态机已经补到 `pending_seller_confirm`、`pending_meetup`、`completed`、`cancelled`、`disputed`，商品状态会随交易流转为 `reserved`、`sold` 或回到 `online`。卖家确认后会生成本次交易的一次性联系码，过期、完成、取消或争议后清空。完成交易后买卖双方可各评价一次，服务端拒绝未完成交易评价和重复评价，并给对方写入站内通知。发布、发起交易、交易状态更新、评价和举报已补 `Idempotency-Key`，弱网重试或重复点击不会重复写商品、时间线、站内通知或平台通知 outbox，联系码过期后的交易确认重放也不会返回旧码。卖家手动上下架也被状态机约束：交易中的商品不能手动下架，已售商品不能重新上架或手动下架，违规 / 注销下架的商品不能重新上架。

这已经能支撑“卖家确认 - 线下验货 - 完成/取消/争议 - 客服裁决 - 双方评价”的轻量交易闭环，并已补站内交易通知收件箱、平台通知适配器、投递 outbox、失败重试接口、争议工单和轻量内部运营控制台。运营侧也已从纯共享密钥推进到 `/ops/login` 短期会话、角色校验、operator id 注入、用户封禁 / 解封和操作审计查询。仍缺的是真实微信订阅消息模板 ID、完整独立客服后台和真实连接级服务端事务验证。

### 3.9 隐私和风控从提示推进到端侧门禁

详情页已经移除交易前复制联系码入口。BFF 商品列表和详情响应会脱敏卖家用户级联系码和精确发布坐标，只保留社区/街道展示字段；带当前位置请求列表时由服务端返回 `distanceMeters`。交易对象在 `pending_seller_confirm` 时也不返回 `contactCode`，只有卖家确认进入 `pending_meetup` 后才在交易页展示本次交易的一次性联系码；联系码过期、交易完成、取消或争议后清空，幂等重放响应也复用同一脱敏规则。举报也不再只依赖详情页拦截：BFF 和本地 service 都会拒绝无效举报原因、不存在或已下架的目标，以及用户举报自己发布的商品；同一用户对同一目标、同一原因的待处理举报会幂等返回原记录，避免重复刷风控记录；高风险举报会下架商品并把该商品活跃交易转入 `disputed`，避免被举报商品继续完成交易。运营侧已补 `POST /ops/login`、`GET /ops/moderation-queue`、`GET /ops/reports`、`POST /ops/reports/:id/resolve`、`GET /ops/users`、`POST /ops/users/:id/status`、`POST /moderation/disputes/:id/resolve`、通知投递重试接口和 `GET /ops/audit-events`，轻量内部运营控制台可用具名账号建立短期会话后处理待审商品、举报、用户风控、争议和通知失败，并把处理人、处理时间、处理结论写入数据库。

这比原始实现更接近合规边界。当前已新增 `src/pages/legal/legal.vue`、`src/services/compliance.js` 和“我的”页协议入口；登录、发布、发起交易和举报前会检查用户协议 / 隐私政策同意状态，未确认时会引导查看协议。服务端也已在 `pre/prod` 登录时校验当前协议版本，并把协议版本、确认时间和来源持久化到用户表，避免只依赖端侧本地存储。剩余风险是一次性联系码仍不是完整 IM，真实生产最好继续接站内 IM 或平台安全沟通能力，并将当前协议文本交给法务和平台审核。

端侧可观测性也已从只弹 toast 推进到可查询链路：登录、定位、发布、交易、举报和注销失败会先写本地遥测缓存，有远端 API 时上报 `/telemetry/client-events`，服务端脱敏后持久化到 `client_events`，运营控制台可通过 `/ops/client-events` 查询最近错误；登录、举报处理、审核、争议处理和通知重试会写入 `ops_audit_events` 并可在运营控制台查询。剩余风险是还没有接入外部告警平台和完整客服后台账号体系。

### 3.10 商品展示缺少真实二手交易所需的图片能力

当前商品卡片和详情页已经支持真实图片展示，发布页要求至少 1 张图片；有远端 API 时走 `/uploads/items`，Node HTTP 后端已经支持 multipart 图片字节落盘、返回 `storageKey` / `size` / `mimeType` / `checksum` / `traceId`，并通过 `/assets/...` 读取；上传和发布审核都会先绑定服务端 session，微信内容安全使用 session 用户的 `openid`，不会信任客户端伪造的审核身份字段；BFF 会将未完成服务端审核的图片商品置为 `pending_review`，并可通过 `/moderation/media/:traceId/review` 接收微信异步图片审核结果。文本命中违禁词时，BFF 和本地演示路径都会拒绝发布并记录审核事件，避免无远端 API 时绕过内容审核。

发布页也会根据返回状态给出不同反馈：`online` 商品提示已发布并回到集市，`pending_review` 商品提示已提交审核并引导到“我的发布”。这让发布成功、公开展示和审核中三个状态不再混在同一个提示里。

发布风控还补了重复发布拦截：同一卖家已有同名 `pending_review` / `online` / `reserved` 商品时，本地演示路径和 BFF 都会拒绝再次发布，避免刷屏和重复审核。

对二手交易来说，图片不是装饰，而是判断成色、降低沟通成本、减少纠纷的核心信息。当前已经有端侧、BFF 契约、本地对象存储适配器边界和异步审核回调链路，生产剩余工作是替换为真实 COS / CloudBase storage、配置微信回调、图片压缩、人工复核台和 CDN 域名。

### 3.11 测试覆盖仍偏窄，但 smoke 信号更高

`package.json` 暴露了 `npm run smoke`、`npm run smoke:bff`、`npm run smoke:bff:fetch` 和 `npm run smoke:backend`。当前 smoke 已覆盖距离、区域、定位过期、定位精度、权限拒绝、系统定位关闭、超时、网络异常、取消选择、最终 GPS、发布、锁定、完成、取消、争议、举报、账号注销、卖家上下架约束、远端上传 / 发布 / 交易 / 举报路径；BFF smoke 覆盖服务端契约、内容审核、举报下架、过期 token 拒绝、交易定位过期 / 低精度拒绝、账号注销吊销、联系码延迟展示和过期后幂等重放脱敏；HTTP 后端 smoke 覆盖真实请求下的登录、区域解析、发布、列表、交易确认、联系码过期后幂等重放脱敏、完成售出和退出登录。

本次执行结果：

```text
npm run smoke
Smoke checks passed

npm run smoke:bff
BFF smoke checks passed

npm run smoke:bff:fetch
BFF fetch smoke checks passed

npm run smoke:postgres-store
PostgreSQL normalized store smoke checks passed

npm run smoke:backend:env
Backend environment guard checks passed

npm run smoke:backend
Backend HTTP smoke checks passed
```

这说明核心逻辑、服务契约、Fetch Runtime 适配、PostgreSQL store 映射和 HTTP 后端主链路目前可用。CI / 发布候选门禁已经补上：`verify:release` 会串行执行语法检查、完整 smoke、HTTP 后端 smoke、三端四环境构建、迁移 / 部署 / 同步 plan、页面契约 smoke 和生产审计报告。2026-05-29 续做时还完成了一次本地 H5 Browser 渲染 QA，覆盖桌面首屏、搜索交互和移动视口；交易页的售卖动作、通知已读和评价控件也已补稳定测试锚点和动态选择器属性；运营台登录、审核、举报、争议、通知重试、用户风控和审计查询也已有稳定锚点和业务 id 选择器，并由源码契约和三端编译产物契约校验。但它仍不是完整测试体系，因为还没有可纳入 CI 的渲染级页面 E2E、真机定位权限分支和微信/支付宝开发者工具导入。

### 3.12 构建验证通过

本次执行结果：

```text
npm run build:weixin
DONE  Build complete.

npm run build:alipay
DONE  Build complete.

npm run build:h5
DONE  Build complete.

npm run build:backend
Backend artifact built at dist/backend
```

构建入口来自 `package.json`（`package.json:10-12`）。微信构建脚本先输出到 `/private/tmp/goods-comm-mp-weixin-build`，再复制到 `dist/build/mp-weixin`，且过滤 `project.config.json`，避免覆盖已有微信开发者工具配置（`scripts/build-weixin.mjs:5-13`, `scripts/build-weixin.mjs:26-30`）。构建后微信项目配置中的 AppID 仍存在（`dist/build/mp-weixin/project.config.json:14-17`）。

这说明当前代码至少可以完成微信、支付宝、H5 和后端部署目录构建。

### 3.13 生产就绪审计仍然阻断上线

本次执行 `npm run env:check` 可以完成 dev/test/pre/prod 四套环境检查，但输出了大量占位配置警告；执行 `npm run audit:production-readiness` 后生成 `docs/deployment-readiness-audit.md`，当前结果为：

```text
Production readiness audit: BLOCKED (46 blockers, 9 warnings)
```

阻断项集中在三个底层事实：本机缺部署和数据库同步工具链及非交互云部署凭据，pre/prod 仍是占位 API / 数据库 / COS / 地图 / 平台密钥，且部署后 smoke 因没有真实 API 域名无法执行。严格审计当前为 `BLOCKED (48 blockers, 7 warnings)`，会额外要求真实部署后 health / 主链路 smoke 输入。当前审计还会把占位数据库连接串和占位 COS bucket 的隔离证明标成 warning，而不是 pass；`GOODS_COMM_MAP_REGION_DATASET` 的格式阻塞已解除，pre/prod 现在都是后端可解析的非空 JSON 网格数组，但真实生产社区 / 街道网格数据仍需替换占位内容。这个审计结果支持本文的核心判断：项目代码已经具备较完整的 MVP 和后端边界，但还没有进入真实生产可上线状态。

## 4. 分项评分

| 维度 | 评分 | 依据 |
| --- | ---: | --- |
| 产品闭环 | 4.5/5 | 浏览、发布、详情、卖家确认、取消、完成、争议工单、客服裁决、评价、举报、用户封禁、写请求幂等、站内通知、平台通知适配器和失败重试路径已具备；仍缺真实微信订阅消息模板 ID、完整客服后台 UI |
| LBS 领域建模 | 4.1/5 | 领域函数清晰，端侧最终 GPS 校验、BFF 重算契约和腾讯地图服务端适配器已补；仍缺真实地图 Key/网格数据 |
| 账号与权限 | 3.9/5 | 有 session/token/注销契约、随机 token、HMAC tokenHash、过期校验、注销吊销、封禁 / 解封和端侧入口；仍缺真实平台凭据、真实数据库连接验证和更完整风控策略 |
| 数据持久化 | 3.5/5 | 已补 HTTP 后端文件 store、数据库 DDL、PostgreSQL 规范化表 store、幂等记录持久化、snapshot rewrite advisory lock 和部署产物；仍缺真实云数据库实例与连接验证 |
| 隐私与风控 | 3.9/5 | 联系码延迟展示、商品响应脱敏、用户协议 / 隐私政策页面、关键动作协议门禁、服务端协议审计、举报/审核/注销/封禁路径、运营队列和举报处理结果已补；仍缺 IM、真实内容安全和完整后台 UI |
| 工程结构 | 4.2/5 | 页面、服务、领域、BFF、HTTP 后端、契约文档边界更清楚 |
| 测试与交付 | 4.4/5 | smoke、BFF smoke、Fetch smoke、PostgreSQL store smoke、HTTP 后端 smoke、页面契约 smoke、主流程证据矩阵 smoke、H5 渲染主链路 smoke、CI 发布候选门禁和微信/支付宝/H5/后端构建覆盖主路径；HTTP 后端 smoke 和 focused `smoke:rate-limiter` 已覆盖 IP、接口级和认证主体写请求三层基础限流；核心页面、交易售卖动作和运营台关键操作已有稳定锚点及动态选择器属性并纳入三端产物检查；生产审计仍被 blocker 阻断，且仍缺微信 / 支付宝开发者工具自动化和真机矩阵 |

综合判断：经过本轮补强后约 `4.35/5`。它已经不是单纯页面 Demo，而是“端侧生产化边界 + BFF 契约 + 可运行 HTTP 后端 + PostgreSQL 规范化表存储 + 可验证核心状态机 + 生产环境依赖保护 + 写请求幂等 + 平台通知 outbox + 端侧协议门禁 + 服务端协议审计 + 基础用户风控 + 可单测的进程内多维限流”的项目。作为可展示 MVP 可到 `8.5/10` 左右；作为真实上线系统仍只有 `6.6/10` 左右，因为关键外部事实还没有落到真实云部署、真实云数据库、真实地图 Key/网格数据、对象存储、微信订阅消息模板和平台合规审核。

### 4.1 多视角 agent 评分

这里用 3 个互相独立的评审视角分别从工程架构、产品闭环、上线风险做交叉判断。三个分数不完全一致，是因为评分对象不同；这比单一总分更能反映项目真实状态。

| 视角 | 分数 | 判断对象 | 核心结论 |
| --- | ---: | --- | --- |
| 工程架构 | 8.6/10 | 代码分层、跨端维护、构建测试 | `pages / components / services / domain / bff / backend / utils` 分层清晰，LBS 领域逻辑、BFF 契约、Fetch 适配器、区域解析适配器、PostgreSQL store 和 Node HTTP 后端都可复用；已补 CI / 发布候选门禁，短板是缺 lint/type/E2E 和真实云部署。 |
| 产品闭环 | 8.0/10 | 用户价值、供需匹配、MVP 可验证性 | “同社区 / 同街道 + 线下验货”的切入点成立，浏览、发布、详情校验、交易状态机、写请求幂等、站内通知、平台通知 outbox 和重试、争议工单裁决、完成后评价、卖家管理、举报、账号注销和用户封禁已能走通。 |
| 上线风险 | 6.2/10 | 微信/支付宝真实上线、交易安全、合规 | 仍不建议直接生产上线。HTTP 后端、数据库 DDL、PostgreSQL store、腾讯地图适配器、端侧遥测、运营操作审计、端侧协议门禁、服务端协议审计、基础用户封禁和进程内 IP / 接口 / 认证主体写请求限流已补，但缺真实云部署、真实数据库连接验证、`code2Session` 真实凭据、地图 Key / 网格数据、对象存储、内容安全、平台合规审核、外部告警平台、网关/WAF/分布式限流和独立客服后台。 |

交叉后的客观判断：

1. 作为作品集或内部演示：比较完整，且亮点明确。
2. 作为 MVP 技术底座：可以继续迭代，优先保留 `domain/eligibility.js`、`services/*` 和 `bff/handler.js` 这类可迁移资产。
3. 作为真实交易产品：仍不能直接上线，必须先把 `dist/backend` 部署到真实云环境，并接入数据库、地图、对象存储和平台合规。

## 5. 关键风险优先级

### P0：上线前必须解决

1. 部署态服务端可信校验缺失  
   当前已有 BFF 契约处理器、Node HTTP 后端和后端构建产物，但还没有真实云部署。必须在云端服务完成 `code2Session`、逆地理编码、距离计算、社区/街道匹配、交易意向创建。

2. 正式账号体系缺失  
   当前 BFF 示例已有 session 过期和吊销，但平台身份仍来自演示 code。必须使用后端 `code2Session` 换取稳定平台身份，并将用户和 session 持久化。

3. 商品和交易数据不可共享  
   本地已有文件 store、`backend/db/schema.sql` 和 PostgreSQL 规范化表 store；生产还必须接入真实云数据库实例，并在 pre/prod 真实连接上验证事务路径。

4. 社区/街道数据不可生产使用  
   当前已新增腾讯地图区域解析适配器，并且 pre/prod 会拒绝样例区域数据；但 `DEMO_REGIONS` 仍只是 dev/test 演示数据。必须配置真实腾讯地图 Key、社区网格数据或自有区域库。

### P1：真实内测前应解决

1. 对象存储、图片压缩、内容安全和后台复核。
2. 联系方式保护升级：一次性联系码已补，下一步接站内联系或平台 IM。
3. 站内交易通知、平台通知适配器、投递失败重试、交易评价、争议工单裁决、运营队列、举报处理接口、轻量运营控制台和操作审计查询已补；下一步补真实微信订阅消息模板 ID，并将运营控制台升级为独立客服后台。
4. 真机权限矩阵、可纳入 CI 的页面交互自动化和微信/支付宝容器差异测试；当前只完成了一次本地 H5 Browser 渲染 QA。
5. 持续同步文档与代码状态，避免已经修复的问题继续出现在风险清单里。

### P2：工程可持续性优化

1. 引入 TypeScript 或至少 JSDoc 约束核心 DTO。
2. 抽象统一 API 层，集中处理 baseURL、鉴权、错误码、重试。
3. 给微信 / 支付宝平台差异建立 adapter，减少页面级条件编译扩散。
4. CI 已接入 `verify:release` 和页面契约 smoke；下一步补可纳入 CI 的页面 E2E、真机矩阵和开发者工具导入验证。

## 6. 建议路线图

### 阶段一：把交易资格从“客户端判断”变成“服务端事实”

- 部署 `dist/backend` 到微信云托管或腾讯云。
- 实现 `POST /auth/login`，完成微信 / 支付宝 code 换身份。
- 实现 `POST /lbs/resolve-region`，服务端逆地理编码并返回标准社区/街道。
- 实现 `POST /trades`，服务端重算距离和行政区匹配后创建交易意向。
- 客户端保留现有 `verifyTradeEligibility` 作为预校验和提示，不作为最终裁决。

### 阶段二：把本地 Demo 市场变成真实市场

- 商品发布写入 PostgreSQL 规范化表，并用真实 pre/prod 数据库验证。
- 商品增加审核状态：`draft`、`pending_review`、`online`、`removed`、`sold`。
- 增加图片上传、压缩、预览、删除、审核；当前上传边界和审核回调已补，仍需真实 COS / 微信回调配置和端侧细节。
- 卖家可以管理自己的商品。

### 阶段三：补齐交易和风控

- 一次性联系码已补；下一步增加站内联系或平台 IM。
- 增加交易状态机。
- 增加举报、黑名单、违禁词、异常定位、频繁交易风控。
- 增加后台审核入口。

### 阶段四：提升工程质量

- 给 `domain` 和 `services` 增加单元测试。
- 已 mock `uni` 覆盖权限拒绝、系统定位关闭、超时、网络异常、取消选择、精度不足、成功定位和缓存过期，并完成一次本地 H5 Browser 渲染 QA；下一步补可纳入 CI 的页面交互自动化和真机矩阵。
- CI 已增加三端四环境构建和发布候选门禁。
- 更新架构文档和项目分析文档，移除与当前代码不一致的风险描述。

## 7. 最终判断

如果目标是“展示一个社区 LBS 二手交易产品的核心想法”，这个项目已经具备较好的表达能力：路由完整、交互路径清楚、LBS 规则抽象合理、双端构建通过。

如果目标是“真实上线做交易”，当前还缺最关键的云端部署、真实云数据库验证和风控基础设施。下一步不应继续堆页面功能，而应优先把身份、位置、商品、交易意向这四类事实接入真实云端可信边界。
