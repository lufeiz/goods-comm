# goods-comm 生产化问题逐项解决方案

更新日期：2026-05-30

## 1. 本轮结论

本项目已经从“端侧 Demo”推进到“端侧生产化边界 + 可运行 HTTP 后端 + 数据库 DDL + 可构建部署产物”：登录、定位、发布、交易售卖的关键动作已经不再只散落在页面里，而是收口到 `services` 层和 BFF / 后端层，并补了可执行 smoke 验证。

需要明确的是：没有真实云数据库、腾讯地图 Key、正式社区 / 街道网格数据、COS / CloudBase storage、内容安全和正式 AppID / 域名之前，项目仍不能宣称达到完整生产上线标准。本轮已经补齐可执行的 BFF / 云函数契约处理器、Node HTTP 后端入口、文件持久化 smoke store、本地对象存储适配器、腾讯地图区域解析适配器、PostgreSQL / TencentDB DDL、四套环境占位配置、后端可解析的区域网格占位数据、prod 到 pre 同步脚本和后端构建产物。

## 2. 已落地改造

| 模块 | 已落地能力 | 关键文件 |
| --- | --- | --- |
| API 边界 | 新增 `requestApi`、`uploadApiFile`、`VITE_API_BASE_URL` 和远端 transport；页面通过异步 service 调用，后续可直接接 BFF / 云函数 | `src/config/app.js`, `src/services/api.js`, `src/services/goods.js`, `src/services/reports.js` |
| BFF 契约 | 新增纯函数式 BFF / 云函数处理器和 Fetch Runtime 适配器，覆盖登录、退出登录、账号注销、区域解析、图片上传、商品、交易、评价、举报和状态流转；公开商品响应只返回社区/街道和服务端计算的距离，不暴露卖家精确坐标；Fetch Runtime 与 Node HTTP 后端共用错误码映射、CORS 限制和 `Idempotency-Key` 写请求回放；pre/prod HTTP 后端会拒绝缺少幂等键的核心写请求；成功请求记录 `completed`，已提交审核 / 风控留痕的业务拒绝记录 `committed_error` 并回放首次错误，避免弱网重试重复追加审核事件；幂等请求身份会忽略服务端注入的 `serverRegion` 和 `moderation` 字段，Node HTTP 发布入口可在外部内容安全调用前先重放已有结果；轻量 Fetch adapter 已在 `pre/prod` 默认返回 `503`，避免绕过 Node 后端的平台身份、对象存储、内容安全、地图解析和持久化依赖检查 | `src/bff/handler.js`, `src/bff/fetch-adapter.js`, `src/bff/http-error.js`, `docs/api-contract.md` |
| 后端项目 | 新增 Node HTTP 后端，直接挂载 BFF handler；本地通过文件 store 持久化状态，且文件 store 的 `transact` 在普通业务 callback 抛错时不保存部分状态，与 PostgreSQL 事务回滚语义对齐；发布审核拒绝这类需要留痕的业务错误会显式标记 `commitStateOnError`，由 file/PostgreSQL store 提交审核事件后继续返回错误；发布商品会先完成服务端区域解析、session 解析和幂等重放预检，命中已有成功或已提交拒绝记录时不再调用外部文本内容安全；图片上传会先解析服务端 session，再保存对象并触发图片审核，避免未登录请求写对象存储或触发外部审核；pre/prod 默认 PostgreSQL store 并拒绝文件 store；pre/prod 默认 COS 对象存储、微信内容安全和腾讯地图区域解析，并拒绝本地对象存储 / mock 审核 / 样例区域；HTTP 层已补 traceId、错误 code、状态码映射、可配置 CORS 合法 Origin，且 pre/prod 启动时拒绝空值或 wildcard CORS、资源缺失 `404`、请求体大小上限、基础安全响应头、客户端 IP 基础限流、接口级配额、认证主体写请求配额、可信代理 `x-forwarded-for` 白名单和 `/health/ready` 依赖检查；限流逻辑已拆入独立 `rate-limiter` 模块，便于 focused smoke 和后续替换为分布式限流；后端 HTTP smoke 覆盖登录、定位、发布、交易、完成售出、账号注销、退出登录、超限请求 `413`、IP / 接口 / 用户写请求超频 `429`、可信代理限流和 JSON / OPTIONS / 资产响应安全头 | `backend/src/server.mjs`, `backend/src/rate-limiter.mjs`, `backend/src/state-store.mjs`, `backend/src/file-state-store.mjs`, `backend/src/postgres-state-store.mjs`, `backend/src/object-store.mjs`, `backend/src/content-safety.mjs`, `backend/src/region-resolver.mjs`, `scripts/rate-limiter-smoke.mjs`, `scripts/backend-smoke.mjs` |
| 数据库边界 | 将内存态拆成用户、认证会话、幂等记录、商品、图片、交易、争议工单、交易评价、位置审计、位置风险、举报、审核事件、端侧事件、运营审计、账号注销等表，补 PostgreSQL / TencentDB DDL，并将 pre/prod 的 PostgreSQL store 接到规范化表事务读写；`bff_state_snapshots` 仅保留为旧部署迁移桥；当前 PostgreSQL store 是受保护的 snapshot-rewrite 桥接模式，已通过 `GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS` 和 `/health/ready` 行数暴露控制数据规模，并通过 `GOODS_COMM_POSTGRES_ADVISORY_LOCK_KEY` 对应的事务级 advisory lock 串行化多实例写入；pre/prod 默认关闭运行时自动建表，要求先跑显式数据库迁移，schema 会记录 `20260531_normalized_schema`、`20260531_auth_session_last_seen`、`20260531_location_risk_events` 和 `20260531_location_risk_review` 迁移，readiness 会检查迁移记录、规范化表和关键列，缺迁移、缺表或缺列会提前失败，后续仍需演进为按聚合根增量 SQL 写入 | `backend/src/postgres-state-store.mjs`, `docs/database-schema.md`, `backend/db/schema.sql` |
| 环境体系 | 新增 `dev/test/pre/prod` 四套 `.env` 占位配置、环境校验脚本、四环境前端构建脚本和四环境后端启动脚本；pre/prod 强制不同数据库和对象存储 bucket | `.env.dev`, `.env.test`, `.env.pre`, `.env.prod`, `scripts/check-environments.mjs`, `docs/environment-matrix.md` |
| 登录 | 登录缓存升级为 session 模型，包含 `token`、`sessionExpiresAt`、`contactCode`；后端新增平台身份解析器，微信走 `jscode2session`、支付宝走 `alipay.system.oauth.token`；pre/prod 禁止演示登录；BFF 维护服务端 session 状态，使用密码学随机 session token，只保存基于 `GOODS_COMM_SESSION_SECRET` 的 HMAC-SHA256 `tokenHash`，并拒绝过期/吊销 token；每次有效认证会刷新 `lastSeenAt` 最近使用时间，便于运营排障、异常会话分析和安全审计；退出登录会吊销当前 session，账号注销会吊销所有 session；端侧登录前必须确认用户协议和隐私政策，pre/prod 服务端会校验并持久化协议版本 / 确认时间 / 来源 | `src/services/auth.js`, `src/services/compliance.js`, `src/pages/legal/legal.vue`, `src/bff/handler.js`, `backend/src/platform-auth.mjs`, `backend/src/postgres-state-store.mjs`, `backend/db/schema.sql`, `src/pages/mine/mine.vue` |
| 定位 | 手动选择位置和实时 GPS 定位明确区分；区域解析统一走 API 边界；Node HTTP 层在列表、发布和交易前调用服务端区域解析器，pre/prod 禁止样例区域；端侧归一化权限拒绝、系统定位关闭、超时、网络异常、低精度、过期、坐标无效和区域解析失败等定位状态；最终列表展示、发布和发起交易都必须使用实时 GPS、未过期、有精度、有区域解析的定位结果；BFF 也会拒绝过期、低精度或缺失精度的列表 / 发布 / 交易定位；发布和交易成功后写入 `location_risk_events`，同账号短时间远距离跳变会生成脱敏 `client_events(type=location_risk)`，并通过 `/ops/location-risk-events` 和运营控制台位置风险面板供 `risk` / `support` 角色查询、复核关闭、确认风险或升级处理，当前只审计不误拦截主链路 | `src/services/location.js`, `src/components/LocationGuard.vue`, `src/bff/handler.js`, `backend/src/region-resolver.mjs`, `src/services/ops.js`, `src/pages/ops/ops.vue`, `backend/db/schema.sql` |
| 图片 | 新增商品图片上传边界；有远端 API 时走 `/uploads/items`；Node HTTP 后端已支持 multipart 图片字节落盘或 COS 上传、返回 `storageKey` / `size` / `mimeType` / `checksum`，并通过 `/assets/...` 读取；上传审核使用服务端 session 绑定的微信 `openid`，客户端不能通过 multipart 字段伪造图片审核身份；发布时 `uploaded` 图片必须匹配当前卖家的上传记录，不能复用其他账号上传或客户端伪造的已审核 URL；pre/prod 禁止本地对象存储；资源缺失稳定返回 `404 NOT_FOUND`；本地演示时标记 `local_pending_upload` | `src/services/media.js`, `backend/src/local-object-store.mjs`, `backend/src/cos-object-store.mjs`, `backend/src/server.mjs` |
| 发布 | 发布前强制登录、强制确认协议、强制确认社区/街道、强制至少 1 张图片，并要求新鲜、高精度的实时 GPS 发布位置；BFF 发布时重算发布位置所属区域并覆盖客户端传入的区域字段；Node HTTP 后端会在内容安全前先解析服务端 session 并尝试幂等重放，避免弱网重试重复触发外部审核；文本审核身份只来自服务端 session，客户端提交的 `sellerOpenid` / `platformId` 不会进入审核或商品响应；本地和 BFF 都会拒绝同一卖家重复发布同名活跃商品；有远端 API 时走 `/items`；发布页会按返回状态区分“已发布”和“已提交审核”，避免待审商品跳到公开集市后不可见 | `src/pages/publish/publish.vue`, `src/services/compliance.js`, `src/services/goods.js`, `src/bff/handler.js`, `backend/src/server.mjs` |
| 审核与举报 | BFF 示例和本地演示路径都会拒绝违禁词提交并记录审核事件；Node HTTP 后端新增内容安全适配器，dev/test 使用 mock，pre/prod 使用微信内容安全并禁止 mock，且发布重放会在外部文本审核前命中幂等记录；微信文本和图片审核请求的 `openid` 均由服务端 session 绑定用户生成，不再信任客户端传入的审核身份字段；图片未审核进入 `pending_review`；新增带共享密钥的 `/moderation/items/:id/review` 后台复核入口和 `/moderation/media/:traceId/review` 微信异步图片审核回调入口，审核通过只释放仍处于 `pending_review` 的商品，不会把已下架、已锁定或已售商品改回在售；审核拒绝会下架商品、拒绝图片并将活跃交易转入 `disputed`；高风险举报会先下架再复核；服务端会校验举报对象、举报原因和“不能举报自己发布商品”的权限；同一用户同一目标同一原因的待处理举报幂等返回原记录；新增 `/ops/login`、`/ops/moderation-queue`、`/ops/reports`、`/ops/reports/:id/resolve`、`/ops/users`、`/ops/users/:id/status` 和 `/ops/audit-events`，支持具名运营账号短期会话、账号级失败登录锁定、角色校验、举报处理为确认违规或驳回误报、用户封禁 / 解封，并把 operator id 注入处理记录和 `ops_audit_events`；轻量内部运营控制台已支持待审商品、举报、争议、通知重试、用户风控和操作审计查询；详情页新增举报入口 | `src/bff/handler.js`, `backend/src/server.mjs`, `backend/src/ops-auth.mjs`, `backend/src/content-safety.mjs`, `src/services/goods.js`, `src/services/reports.js`, `src/services/ops.js`, `src/pages/detail/detail.vue`, `src/pages/ops/ops.vue`, `scripts/bff-smoke.mjs`, `scripts/backend-smoke.mjs`, `scripts/ops-auth-smoke.mjs` |
| 售卖 | 商品增加 `online / reserved / sold / removed` 状态；交易增加 `pending_seller_confirm / pending_meetup / completed / cancelled / disputed` 状态机；详情页会按商品状态和当前用户身份禁用已锁定、已售、自己发布商品的发起交易入口；交易进入争议时会生成争议工单，客服可裁决为释放商品、确认完成或下架商品；完成交易后买卖双方可各评价一次，重复评价会被拒绝；发布、交易创建、状态更新、评价和举报都带写请求幂等键，重复提交不会重复追加商品、时间线或通知，联系码过期后的重复创建和交易确认幂等重放都不会泄露旧码；卖家管理不能绕过交易锁定、已售和风控下架状态 | `src/services/goods.js`, `src/pages/detail/detail.vue`, `src/bff/handler.js` |
| 交易页 | 只展示当前登录用户相关交易；支持卖家确认、双方取消、标记完成、发起争议；待确认阶段明确提示“卖家确认后生成一次性联系码”，确认后只展示本次交易的一次性联系码，过期、完成、取消或争议后隐藏并清空；交易创建、确认、完成、取消、争议、争议处理和评价会写入站内通知，交易页展示通知收件箱并支持标记已读；Node HTTP 后端会在事务内创建平台通知 outbox 记录，事务提交后交给平台通知适配器，失败可通过 ops 接口查询和重试，并触发生产告警适配器；dev/test 用 mock，pre/prod 要求微信订阅消息；争议中展示客服处理中，争议处理后展示处理结果；完成后展示评分、标签和评价输入；关键状态操作会二次确认，降低误点导致的锁定、售出或争议 | `src/pages/orders/orders.vue`, `src/services/goods.js`, `src/bff/handler.js`, `backend/src/platform-notifier.mjs`, `backend/src/ops-alerts.mjs` |
| 可观测性 | 端侧登录、定位、发布、交易、举报和注销失败会写入本地遥测缓存，并在有远端 API 时上报 `/telemetry/client-events`；服务端脱敏后持久化 `client_events`，运营控制台可按级别查询排障；位置风险事件可通过 `/ops/location-risk-events` 按风险等级、原因码、用户、动作和复核状态查询，响应不返回经纬度或精度；位置风险复核会写入 `ops.location_risk.review` 操作审计；关键运营写操作会写入 `ops_audit_events` 并可通过 `/ops/audit-events` 查询；Node HTTP 后端新增 `ops-alerts` 生产告警适配器，支持关闭态和 Webhook，平台通知失败 / 通知重试失败会发送脱敏告警；Node HTTP 后端也已新增 stdout JSON 访问日志，记录 trace id、归一化路由、状态、耗时、CORS 和限流摘要，不记录 query、请求头、请求体或动态业务 ID；`/health` / `/health/ready` 会暴露并校验告警配置和访问日志开关；Fetch Runtime 和 Node HTTP 后端都支持 `/ops/client-events` | `src/services/telemetry.js`, `src/bff/handler.js`, `src/services/ops.js`, `backend/src/postgres-state-store.mjs`, `backend/src/ops-alerts.mjs`, `backend/src/request-logger.mjs`, `src/pages/ops/ops.vue` |
| 我的页 | 增加“我的发布”，支持卖家下架和重新上架自己发布的物品；新增账号与数据注销入口 | `src/pages/mine/mine.vue` |
| 展示 | 商品卡和详情页支持真实图片展示，保留无图 fallback；定位组件展示来源、精度和更新时间；本地和远端商品列表都必须带新鲜、高精度当前位置，服务端会按同社区 / 同街道和半径过滤，只展示当前用户交易范围内的在线商品，拒绝只带任意经纬度的探测式列表请求 | `src/components/GoodCard.vue`, `src/pages/detail/detail.vue`, `src/services/goods.js`, `src/bff/handler.js` |
| 部署产物 | 新增后端构建脚本，生成 `dist/backend`；新增数据库迁移、后端部署 plan/execute 脚本、部署后健康 smoke 和部署后主链路 smoke，部署路径按微信 CloudBase 优先、腾讯云 fallback；新增前端部署 plan/execute 脚本，覆盖 H5 CloudBase 静态托管、微信开发者工具上传和支付宝小程序上传，真实执行前会先做环境检查、目标端构建和环境定向 artifact checks；提供容器 Dockerfile 与部署说明；后端构建会生成 artifact 专用 `package-lock.json`，容器构建通过 `npm ci --omit=dev` 安装锁定后的生产依赖，避免真实 PostgreSQL store 部署时缺少或漂移 `pg`；`smoke:backend:artifact` 会检查部署包中的 server、BFF、PostgreSQL store、schema、Dockerfile、启动脚本、lockfile 和生产依赖安装步骤；真实部署脚本在迁移数据库和推送后端前会强制运行 artifact smoke，生产迁移 / 生产部署还要求脚本级 `GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true` / `GOODS_COMM_DEPLOY_ALLOW_PROD=true`，部署完成后默认运行带重试的 deployed health smoke，验证 `/health` / `/health/ready`、生产依赖模式和安全响应头，并可通过 `--run-main-smoke` 把登录、定位、发布、交易、完成售出主链路 smoke 合并到同一次部署命令 | `scripts/build-backend.mjs`, `scripts/backend-artifact-smoke.mjs`, `scripts/migrate-database.mjs`, `scripts/deploy-backend.mjs`, `scripts/deploy-frontend.mjs`, `scripts/frontend-deploy-smoke.mjs`, `scripts/deployed-health-smoke.mjs`, `scripts/deployed-main-flow-smoke.mjs`, `backend/deploy/Dockerfile`, `backend/deploy/tencent-cloud-run.md` |
| 数据同步 | 新增 prod 到 pre 同步 plan / 手动 execute / 自动定时入口；执行路径会校验 pre/prod 库不相同、pre/prod 关键拓扑变量一致、拒绝占位连接串，并在恢复到 pre 后执行扩展脱敏 SQL，覆盖平台身份、商品内容、精确坐标、位置风险坐标、交易标题、图片对象存储元数据、审核标题和运营日志内容；生产审计和同步脚本已共用 `PRE_PROD_TOPOLOGY_MATCH_KEYS`，避免新增限流、PostgreSQL 锁或平台网关变量时出现审计通过但同步执行漏检；同步脚本会在成功或失败后执行 `remove_prod_dump` 阶段并清理本地生产 dump，审计日志记录清理结果，降低同步执行机上的生产数据残留风险；自动模式需要 `GOODS_COMM_SYNC_AUTO_ENABLED=true`，带锁文件、防重入和分阶段审计日志，可选同步后带重试的 pre 健康 smoke，也可用 `GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true` 跑 pre 主链路 smoke 验证刷新后的预上线数据库；新增 `.github/workflows/prod-to-pre-sync.yml`，支持手动 plan / execute 和定时自动同步，工作流只上传脱敏审计日志，不上传生产 dump | `scripts/environment-topology.mjs`, `scripts/sync-prod-to-pre.mjs`, `scripts/prod-sync-smoke.mjs`, `backend/db/pre-sync-reset.sql`, `backend/db/pre-sync-anonymize.sql`, `.github/workflows/prod-to-pre-sync.yml` |
| 验证 | smoke 覆盖距离、区域、定位过期、定位精度、权限拒绝、系统定位关闭、定位超时、定位网络异常、取消选择、最终 GPS 校验、发布、取消、争议、客服争议裁决、完成售出、交易通知、平台通知 mock/微信适配器、失败 outbox 查询和重试、生产告警 Webhook、访问日志 JSON/脱敏、交易评价、端侧遥测上报 / ops 查询、远端上传/发布/交易接口路径、幂等发布回放、幂等拒绝回放、幂等状态更新不重复写时间线 / 通知 / 审核事件；BFF、Fetch、真实 HTTP 后端 smoke 覆盖服务端契约、图片字节上传落盘与读取、媒体 `trace_id` 审核回调、通知收件箱、争议工单、评价防重复、账号注销后 token 吊销、卖家注销下架商品、买家注销取消交易并释放商品、一次性交易联系码格式 / 过期时间 / 过期后重复创建与幂等重放脱敏 / 完成后清空、公开商品响应不暴露卖家联系码或精确经纬度、401 未登录、403 权限、409 冲突、422 校验错误、CORS 拒绝、traceId 和审核拒绝审计持久化，并断言图片审核和文本审核都使用服务端 session `openid`、客户端伪造审核身份不会进入审核 payload 或商品响应、幂等发布重放/冲突/拒绝重放都只调用一次商品文本内容安全；backend env smoke 覆盖受保护环境依赖保护、文件 store 普通事务失败回滚和 `commitStateOnError` 审计提交；区域解析 smoke 覆盖 dev mock、pre/prod 禁 mock、腾讯地图响应映射和缺 Key 失败；页面契约 smoke 会检查页面注册、tabBar、页面文件存在、模板事件处理器、页面跳转路径，首页、发布、详情、交易、我的、运营、协议页必须接入的关键 service，核心页面和关键组件必须暴露稳定 `data-testid` 渲染测试锚点，以及定位错误、空状态、已售/锁定、交易联系码、评价、通知、注销和图片 fallback 等关键显示状态；主链路证据矩阵 smoke 会把登录协议与账号生命周期、定位解析与显示可信边界、发布与图片上传、交易售卖生命周期、部署后 smoke 和 release gate 串联起来，避免页面 / service / BFF / 部署验证各自通过但主链路证据断裂；交易页的通知已读、交易状态、联系码、争议、售卖动作和评价控件也有独立锚点，重复动态元素额外带交易 id、状态、评分和标签等选择器属性；运营台登录、用户风控、商品审核、举报处理、争议裁决、通知重试、端侧事件和操作审计也有独立锚点及业务 id 选择器，便于后续页面 E2E 精确定位；后端 artifact smoke 会检查 `dist/backend` 的 package、lockfile、server、BFF、PostgreSQL store、schema、Dockerfile、Node 语法和容器 `npm ci` 生产依赖安装步骤，并已接入生产就绪审计的 Build artifacts 区域；产物 smoke 会检查 H5 / 微信 / 支付宝构建产物包含核心页面、tabBar、关键组件、H5 页面 chunk、编译后渲染测试锚点和选择器属性，并断言 dev/test/pre/prod 产物内嵌的运行环境与 API Base URL 匹配对应 `.env.*`；workflow smoke 会检查 CI、strict release 和 prod-to-pre sync 的关键保护，避免发布工作流跳过审计、部署后 smoke、prod opt-in 或误上传生产 dump；本地部署 health/main-flow smoke 会启动 Node HTTP 后端，并复用真实部署后 smoke 脚本黑盒验证 `/health`、`/health/ready`、登录、定位、未登录上传拒绝、上传、发布、客户端伪造审核身份字段不外泄、交易、卖家确认、一次性联系码生命周期、完成售出、公开商品隐私脱敏、评价、独立测试账号注销和退出登录；新增 `verify:release` 发布候选门禁和 GitHub Actions CI，把语法检查、smoke、HTTP 后端 smoke、部署后 smoke 自测、三端四环境构建、页面契约 smoke、主链路证据矩阵 smoke、后端 artifact smoke、产物 smoke、workflow smoke、迁移 / 部署 / 同步 plan 和生产审计串成同一入口；生产审计现在同时输出 Markdown 和机器可读 JSON，方便 CI 或发布看板逐项追踪 blocker；新增手动 `release-strict` GitHub Actions 工作流，真实上线前先安装 release 工具链并运行 strict gate，可选先迁移数据库并部署后端，再执行部署后 smoke | `scripts/smoke.mjs`, `scripts/bff-smoke.mjs`, `scripts/bff-fetch-smoke.mjs`, `scripts/backend-smoke.mjs`, `scripts/backend-env-smoke.mjs`, `scripts/ops-alerts-smoke.mjs`, `scripts/request-logger-smoke.mjs`, `scripts/backend-artifact-smoke.mjs`, `scripts/deployed-health-local-smoke.mjs`, `scripts/deployed-health-smoke.mjs`, `scripts/deployed-main-flow-local-smoke.mjs`, `scripts/deployed-main-flow-smoke.mjs`, `scripts/page-contract-smoke.mjs`, `scripts/main-flow-contract-smoke.mjs`, `scripts/platform-notifier-smoke.mjs`, `scripts/region-resolver-smoke.mjs`, `scripts/artifact-smoke.mjs`, `scripts/workflow-smoke.mjs`, `scripts/production-readiness-audit.mjs`, `scripts/verify-release-gate.mjs`, `.github/workflows/ci.yml`, `.github/workflows/release-strict.yml`, `.github/workflows/prod-to-pre-sync.yml` |

## 3. 两份报告问题逐项方案

| 报告问题 | 生产解决方案 | 本轮状态 | 剩余依赖 |
| --- | --- | --- | --- |
| 客户端 LBS 校验不可信 | 客户端只做预校验；发布和发起交易时调用服务端重算坐标、社区/街道和距离；保存位置审计 | 端侧已强制最终 GPS 校验；区域解析已统一走 API 边界；HTTP 后端已在 `/items` 和 `/trades` 入口调用服务端区域解析器；BFF handler 会覆盖发布区域并写 `locationAudit` | 真实腾讯地图 Key、区域网格库、云端部署 |
| 社区/街道仍是样例数据 | 服务端接入腾讯地图或自有社区网格，返回标准社区/街道编码 | 已新增 `backend/src/region-resolver.mjs`：dev/test 可用 mock，pre/prod 默认腾讯地图且禁止 mock；支持把腾讯行政区/街道结果映射为内部社区/街道编码；`.env.*` 已从数据集标签改为后端可解析的 JSON 数组占位 | 真实腾讯地图 Key、合法域名、标准区域网格数据 |
| 没有后端账号体系 | `auth/login` 用微信/支付宝 code 换 `openid/unionid`，签发业务 token，返回用户状态 | 端侧已升级 session/token 模型；后端已新增微信 / 支付宝 code 换平台身份适配器；BFF handler 已以服务端注入的 `platformIdentity` 绑定用户，签发随机 session token，并只持久化 HMAC-SHA256 `tokenHash`；已覆盖过期校验、账号注销吊销 token 和 pre/prod 缺会话密钥时拒绝签发 session | 真实 AppID / AppSecret / 支付宝私钥、真实持久化用户表连接验证 |
| 本地存储不可共享 | 商品、用户、交易、审计迁移到数据库；本地只存 token、定位缓存和轻量草稿 | 已新增 Node HTTP 后端、文件持久化 store、PostgreSQL 规范化表 store 和 PostgreSQL / TencentDB DDL；文件 store 的事务失败回滚语义已对齐 PostgreSQL；pre/prod 已阻断文件 store；HTTP smoke 已验证跨请求状态，`smoke:postgres-store` 已验证状态到表的映射 | 云数据库实例、真实 PostgreSQL 连接 smoke |
| 缺少环境隔离 | 建立 dev/test/pre/prod 四套配置、四套数据库和对象存储；pre/prod 同拓扑不同库 | 已新增四套 `.env` 占位配置、环境校验脚本、四环境构建/启动命令；pre/prod 误用同库会被 `env:check` 拦截 | 真实云资源 ID、真实连接串、云平台密钥 |
| 预上线缺真实数据 | 支持 prod 自动或手动脱敏同步到 pre，用生产形态数据做发布候选验证 | 已新增 `sync:prod-to-pre:plan` 和 execute 脚本，包含 pre 清空、prod 恢复、脱敏 SQL | PostgreSQL 工具、prod 只读导出账号、pre 写入账号、定时任务 |
| 发布身份不可信 | 发布必须绑定服务端 userId，服务端校验 token、位置归属和审核状态 | 端侧已强制登录；BFF handler 已从 token 绑定卖家，不接受客户端 seller，并重算发布区域；Node HTTP 内容安全审核也从服务端 session 获取 `openid`，不信任客户端审核身份字段 | 真实持久化和真实平台凭据 |
| 联系方式和精确位置明文风险 | 使用站内联系、一次性联系码或平台 IM；未确认交易前不暴露真实联系方式；公开商品响应不返回卖家精确经纬度；登录、发布、交易和举报前确认协议 | 详情页不再提供复制入口；BFF 商品响应会脱敏卖家用户级联系码和精确坐标；交易确认后生成本次交易的一次性联系码并带过期时间，过期、交易完成、取消或争议后清空；已新增用户协议 / 隐私政策页面、同意状态存储、关键动作拦截和服务端协议审计字段 | 后续接平台 IM、法务审核后的正式协议文本和客服可追溯沟通 |
| 商品缺图片和审核 | 图片选择、上传、压缩、审核状态、违规下架、重复发布拦截 | 端侧要求至少 1 张图片；已提供 `/uploads/items` 上传边界；Node HTTP 后端可保存上传字节或上传 COS 并返回存储元数据，且图片审核身份来自服务端 session；pre/prod 已强制 COS 和微信内容安全；BFF 和本地演示路径都支持违禁词拒绝与重复发布拦截；BFF 支持 `pending_review`、举报下架和带密钥的审核回调上架 / 拒绝；发布重试会先按幂等键重放已有成功或已提交拒绝结果，不重复触发外部文本审核 | 真实 COS / CDN 凭据、微信内容安全凭据、微信异步回调配置、后台复核台 |
| 定位失败状态不细 | 区分拒绝授权、系统定位关闭、低精度、过期、超时、网络异常、坐标无效、区域解析失败、手动选择和 GPS 最终校验 | 端侧已统一 `LOCATION_*` 错误码，展示来源、精度、相对更新时间，并阻断非 GPS 最终交易；BFF 已在 `/items` 和 `/trades` 中二次校验 `capturedAt` 和 `accuracy`；`smoke:location-permissions` 已用 mock `uni` 和浏览器 geolocation 覆盖定位授权拒绝、首次授权拒绝、系统定位关闭、超时、网络异常、无效坐标、低精度、区域解析失败、H5 浏览器权限、缓存过期和最终交易必须使用实时 GPS 的权限/质量矩阵 | 真机覆盖更多平台错误码 |
| 交易流程只有意向 | 增加卖家确认、待验货、完成、取消、争议、客服裁决、站内通知和平台模板消息；商品状态随交易变化；写请求必须幂等 | 已实现本地状态机和交易页操作；卖家手动上下架已被交易锁定、已售和风控状态约束；交易页会在确认、完成、取消、争议前二次确认；远端状态更新边界、争议工单、客服裁决、站内通知收件箱、平台通知适配器、投递 outbox、重试接口、轻量运营控制台、运营短期会话和 `Idempotency-Key` 重放已补 | 真实服务端连接级事务、真实微信订阅消息模板 ID、完整客服后台和细粒度 RBAC |
| 缺少举报和数据删除闭环 | 新增举报表、运营处理接口、账号注销接口、账号注销后商品下架、活跃交易取消和 session 吊销 | BFF handler 已覆盖 `/reports`、`/ops/login`、`/ops/moderation-queue`、`/ops/reports/:id/resolve`、`/ops/users`、`/ops/users/:id/status`、`/ops/audit-events`、`/auth/delete-account`，轻量运营控制台已接待审商品、举报、争议、通知重试、用户风控和操作审计，并支持具名运营账号会话、角色校验和 actor 注入；封禁用户会吊销 session、下架活跃发布、冻结相关交易并写审计；端侧举报前需要确认用户协议 / 隐私政策；烟测覆盖举报对象/原因/权限校验、重复举报幂等、高风险举报下架、运营驳回误报恢复商品、冻结活跃交易、封禁 / 解封、过期 token 拒绝、操作审计，以及 HTTP 层账号注销后的 token 吊销、卖家商品下架、买家交易取消和商品释放 | 完整客服后台、数据保留策略、正式协议法务审核 |
| 缺完整测试体系 | 保留 smoke，增加 service 单测、uni mock、页面 E2E、双端 CI | smoke 已覆盖本地、远端 service 路径、BFF 契约、Fetch 适配器、真实 HTTP 后端、文件 store 事务失败回滚和端侧遥测链路；新增 `smoke:pages` 静态页面契约检查，覆盖页面注册、tabBar、页面跳转、模板事件处理器和关键 service 接入；新增 `smoke:main-flow-contract` 主链路证据矩阵，检查登录、定位展示、发布、图片上传、交易售卖、部署后 smoke 与 release gate 串联；新增 `smoke:location-permissions` 聚焦定位权限和质量矩阵；新增 `verify:release` 门禁和 GitHub Actions CI，覆盖三端四环境构建、迁移 / 部署 / 同步 plan 和生产审计报告 | 真机/开发者工具自动化、渲染级页面 E2E |
| AppID / 合规配置未生产化 | 配置真实 AppID、合法域名、隐私协议、用户协议、数据删除入口 | 端侧已有账号注销入口、用户协议 / 隐私政策页面、协议同意状态和登录 / 发布 / 交易 / 举报前拦截；pre/prod 登录会服务端校验并持久化协议确认事实；未在代码中写死真实 AppID，避免误提交；后端已支持 `GOODS_COMM_ALLOWED_ORIGINS` 约束 H5 / 浏览器合法 Origin，且 pre/prod 不允许空值或 `*` CORS | 真实平台账号、合法域名、正式协议法务审核和平台合规材料 |
| H5 未适配 | H5 使用浏览器 geolocation 获取实时定位；dev/test 无小程序登录 API 时生成本地 H5 演示登录态；pre/prod 后端仍拒绝演示登录，不能把 H5 本地身份当作正式账号体系 | 已补基础浏览器定位、演示登录 smoke、协议确认和四环境 H5 构建 | 若要对公网开放 H5，需要接正式 OAuth/SSO、合法 H5 域名策略和浏览器 E2E |

## 4. 交付验证

本轮已执行：

```bash
node --check src/services/auth.js
node --check src/services/goods.js
node --check src/services/media.js
node --check src/services/reports.js
node --check src/services/location.js
node --check src/bff/handler.js
node --check src/bff/fetch-adapter.js
node --check backend/src/server.mjs
node --check backend/src/rate-limiter.mjs
node --check backend/src/state-store.mjs
node --check backend/src/file-state-store.mjs
node --check backend/src/postgres-state-store.mjs
node --check backend/src/platform-auth.mjs
node --check backend/src/object-store.mjs
node --check backend/src/cos-object-store.mjs
node --check backend/src/content-safety.mjs
node --check backend/src/region-resolver.mjs
node --check backend/src/platform-notifier.mjs
node --check backend/src/request-logger.mjs
node --check scripts/smoke.mjs
node --check scripts/bff-smoke.mjs
node --check scripts/bff-fetch-smoke.mjs
node --check scripts/backend-smoke.mjs
node --check scripts/backend-env-smoke.mjs
node --check scripts/page-contract-smoke.mjs
node --check scripts/platform-auth-smoke.mjs
node --check scripts/platform-notifier-smoke.mjs
node --check scripts/request-logger-smoke.mjs
node --check scripts/storage-content-smoke.mjs
node --check scripts/region-resolver-smoke.mjs
node --check scripts/postgres-store-smoke.mjs
node --check scripts/migrate-database.mjs
node --check scripts/deploy-backend.mjs
node --check scripts/deployed-health-smoke.mjs
node --check scripts/deployed-main-flow-smoke.mjs
node --check scripts/check-environments.mjs
node --check scripts/environment-topology.mjs
node --check scripts/start-backend.mjs
node --check scripts/sync-prod-to-pre.mjs
node --check scripts/backend-artifact-smoke.mjs
npm run env:check
npm run smoke
npm run smoke:bff
npm run smoke:bff:fetch
npm run smoke:backend
npm run smoke:backend:env
npm run smoke:platform-auth
npm run smoke:platform-notifier
npm run smoke:request-logger
npm run smoke:storage-content
npm run smoke:region
npm run smoke:postgres-store
npm run smoke:pages
npm run smoke:main-flow-contract
npm run smoke:artifacts
npm run smoke:deployed:local-health
npm run smoke:deployed:local-main
npm run smoke:backend:artifact
npm run db:migrate:plan -- --env pre
npm run deploy:backend:pre:plan
npm run sync:prod-to-pre:plan
npm run verify:release
npm run build:backend
npm run build:weixin:dev
npm run build:weixin:test
npm run build:weixin:pre
npm run build:weixin:prod
npm run build:alipay:dev
npm run build:alipay:test
npm run build:alipay:pre
npm run build:alipay:prod
npm run build:h5:dev
npm run build:h5:test
npm run build:h5:pre
npm run build:h5:prod
```

验证结果：

```text
Smoke checks passed
BFF smoke checks passed
BFF fetch smoke checks passed
Backend HTTP smoke checks passed
Backend environment guard checks passed
Platform auth smoke checks passed
Platform notifier smoke checks passed
Request logger smoke checks passed
Storage and content safety smoke checks passed
Region resolver smoke checks passed
PostgreSQL normalized store smoke checks passed
Page contract smoke checks passed for 7 pages
Main flow contract smoke checks passed for 5 flows and 117 evidence points
Artifact smoke checks passed for 3 targets
Local deployed health smoke checks passed
Local deployed main-flow smoke checks passed
Backend artifact smoke checks passed
Database migration plan for pre
Backend deployment plan for pre
Environment check passed for dev, test, pre, prod
Prod to pre sync plan generated
Backend artifact built at dist/backend
DONE  Build complete.  # Weixin dev
DONE  Build complete.  # Weixin test
DONE  Build complete.  # Weixin pre
DONE  Build complete.  # Weixin prod
DONE  Build complete.  # Alipay dev
DONE  Build complete.  # Alipay test
DONE  Build complete.  # Alipay pre
DONE  Build complete.  # Alipay prod
DONE  Build complete.  # H5 dev
DONE  Build complete.  # H5 test
DONE  Build complete.  # H5 pre
DONE  Build complete.  # H5 prod
```

部署后健康验证入口已补齐，但当前 `.env.pre/.env.prod` 仍是占位域名，因此 `npm run smoke:deployed:pre` / `npm run smoke:deployed:prod` 要在真实 HTTPS API 域名替换后执行。
部署后健康和主链路验证入口已补齐：`npm run smoke:deployed:pre` 会验证 `/health` / `/health/ready`、生产依赖模式和安全响应头，pre/prod 会额外要求 HSTS，避免云网关或 CDN 覆盖响应头后仍误判健康；`npm run smoke:deployed:pre:main` 会验证登录、区域解析、未登录上传拒绝、上传、发布、交易、卖家确认、买卖双方交易列表、交易通知、通知已读、一次性联系码格式 / 非固定用户联系码 / 未来过期时间、完成售出、完成后联系码清空、售出后详情状态、售出后拒绝再次交易、公开商品响应不暴露卖家联系码、精确经纬度或客户端伪造审核身份字段、交易评价、退出登录和退出后 token 拒绝访问；它需要真实平台登录 code、网格覆盖坐标，以及微信图片异步审核场景下的已审核测试图片 URL。写入型步骤会携带 `Idempotency-Key` 并立即重放断言，避免部署后 smoke 因网络重试或 CI 重试重复创建商品、交易或评价；需要跨进程复跑同一 smoke 时，可固定 `GOODS_COMM_SMOKE_RUN_ID` 和 `GOODS_COMM_SMOKE_CAPTURED_AT`。如需把账号注销也纳入真实部署后验收，可额外提供一次性测试账号 `GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE`，脚本会验证该账号注销后 token 失效和活跃商品下架，且会拒绝把 seller/buyer 主烟测 code 复用于注销测试。`npm run smoke:deployed:local-health` / `npm run smoke:deployed:local-main` 会启动本地后端并通过 `GOODS_COMM_SMOKE_API_BASE_URL` 复用同一套部署后 smoke 脚本做黑盒自测，本地 main-flow 会默认注入独立注销测试账号，避免真实部署前只验证到脚本语法。

## 5. 下一阶段必须做

1. 补齐 `docs/deployment-missing-info.md` 中的真实云信息，并用 `npm run env:check` 校验四套环境。
2. 用 `npm run db:migrate:plan -- --env pre` / `--env prod` 复核迁移计划，替换真实连接串后用 `backend/db/schema.sql` 初始化 dev/test/pre/prod 四套 TencentDB / PostgreSQL。
3. 用 `npm run deploy:backend:pre:plan` / `npm run deploy:backend:prod:plan` 复核部署计划，真实执行时让部署脚本先构建并验证 `dist/backend`，再迁移目标数据库，最后部署到微信云托管或腾讯云，并配置 HTTPS 合法域名；部署后在真实 pre/prod 数据库上跑 PostgreSQL store 主链路 smoke。
4. 接真实腾讯地图 Key 与社区网格数据：当前占位网格只用于保持配置格式和部署预检可运行，真实上线前必须替换为正式社区/街道标准编码数据。
5. 在真实云环境替换 `.env.pre/.env.prod` 的 COS / CDN、微信内容安全、微信订阅消息模板、生产告警 Webhook、`GOODS_COMM_MODERATION_WEBHOOK_SECRET` 和 `GOODS_COMM_SESSION_SECRET` 占位值，并接好云侧 stdout 日志采集与保留策略；发布先进入审核，再通过微信异步回调或后台复核上架，交易事件通过平台通知适配器投递订阅消息，通知投递失败通过告警 Webhook 外发。
6. 配置 prod 到 pre 定时同步任务，执行前校验 pre/prod 关键拓扑变量一致，执行后跑预上线 health smoke；真实候选发布前开启 `GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true`，同步后继续跑 pre 主链路 smoke；可直接使用 `.github/workflows/prod-to-pre-sync.yml`，或迁移到腾讯云定时任务 / 内部 runner。
7. 将 GitHub Actions 或内部 CI 绑定到受保护分支，至少运行 `npm run verify:release`；真实上线前配置 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY` 和可选 `TENCENTCLOUD_SESSION_TOKEN`，运行 `npm run verify:release:strict` 或手动触发 `.github/workflows/release-strict.yml`，并上传普通生产审计与 strict 审计 Markdown / JSON 作为发布证据；strict gate 会先刷新 strict 审计产物，再通过 `--require-deployed-smoke-inputs` 把部署后 smoke 输入缺失升级为 blocker，避免失败时只留下普通审计口径；如果 workflow 启用 `run_backend_deploy=true`，必须保持 `run_deployed_smoke=true`，否则直接失败，避免部署后跳过 health / main-flow smoke。
8. 接平台合规：真实 AppID、合法域名、正式协议法务审核、平台隐私配置和数据删除材料。

## 6. 部署尝试状态

已生成后端部署产物 `dist/backend`，并提供 `backend/deploy/Dockerfile`、`backend/deploy/cloudbase.json` 和腾讯云部署说明。真实部署仍缺少的信息已经整理到 `docs/deployment-missing-info.md`；当前可先用 `.env.dev/test/pre/prod` 的占位值推进构建、环境校验和部署脚本开发。当前本机未安装 `cloudbase`、`tcb`、`tccli`、`docker`、`pg_dump`、`pg_restore` 或 `psql`，也没有可用云账号凭据、腾讯地图 Key 或正式社区网格数据，因此本轮无法直接推送到微信云托管 / 腾讯云或执行真实 prod 到 pre 数据同步。下一次部署需要先准备云环境 ID、合法 HTTPS 域名、数据库实例、PostgreSQL 客户端工具、地图服务 Key、正式社区网格数据，以及具备 CloudBase / TencentDB / COS / CDN / TEM 权限的 `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`。
