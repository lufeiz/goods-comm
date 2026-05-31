# goods-comm 四套环境矩阵

更新日期：2026-05-30

## 1. 环境原则

本项目按 `dev / test / pre / prod` 四套环境交付：

| 环境 | 用途 | 前端构建 | 后端运行 | 数据库 |
| --- | --- | --- | --- | --- |
| `dev` | 本地开发和个人联调 | `.env.dev`，可连本地后端 | `npm run backend:start:dev` | `goods_comm_dev`，可用本地 PostgreSQL 或文件 store |
| `test` | 测试环境和自动化验证 | `.env.test` | `npm run backend:start:test` 或测试云服务 | `goods_comm_test`，独立测试库 |
| `pre` | 预上线验收，拓扑与生产一致 | `.env.pre` | 预上线云托管 / 腾讯云服务 | `goods_comm_pre`，独立预上线库 |
| `prod` | 生产环境 | `.env.prod` | 生产云托管 / 腾讯云服务 | `goods_comm_prod`，独立生产库 |

`pre` 和 `prod` 必须保持同一套代码版本、同一份数据库 schema、同一类云资源拓扑，但使用两套不同数据库、不同对象存储 bucket、不同服务账号和不同运行时密钥。

## 2. 配置文件

根目录已提供四份占位配置：

- `.env.dev`
- `.env.test`
- `.env.pre`
- `.env.prod`

这些文件只放可提交的占位值和非密钥配置。真实数据库密码、云密钥、AppSecret、地图 key、内容安全 key 应在云平台环境变量或本地 `.env.*.local` 中维护，不提交到仓库。本地脚本读取 `.env.dev/test/pre/prod` 后，会自动加载同名 `.env.*.local` 覆盖文件；例如 `.env.pre.local` 可覆盖预上线数据库连接串和云密钥。仓库提供 `.env.pre.local.example` / `.env.prod.local.example` 作为真实覆盖模板，复制后填真实值即可被审计和部署脚本读取；模板覆盖度由 `npm run smoke:env-local-templates` 校验。部署后 health / main-flow smoke 的一次性输入使用 `.env.smoke.pre.example` / `.env.smoke.prod.example` 单独维护，复制到 `.env.smoke.*.local` 后会被部署 smoke、部署脚本和生产审计自动读取，模板覆盖度由 `npm run smoke:deployed-input-templates` 校验。

关键变量：

| 变量 | 说明 |
| --- | --- |
| `VITE_APP_ENV` | 前端构建环境，必须等于 `dev/test/pre/prod` |
| `VITE_API_BASE_URL` | 小程序 / H5 调用的 HTTPS API 网关，dev 可用本地 HTTP |
| `GOODS_COMM_CLOUDBASE_ENV_ID` | 微信 CloudBase / 云托管环境 ID，部署脚本优先使用 |
| `GOODS_COMM_TENCENT_REGION` / `GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE` / `GOODS_COMM_TENCENT_CONTAINER_IMAGE` | 腾讯云 fallback 部署区域、服务和容器镜像 |
| `GOODS_COMM_ENV` | 后端运行环境，必须等于 `dev/test/pre/prod` |
| `GOODS_COMM_ALLOWED_ORIGINS` | H5 / 浏览器 CORS 合法 Origin |
| `GOODS_COMM_DATABASE_URL` | 当前环境数据库连接串 |
| `GOODS_COMM_STATE_STORE` | 后端状态存储类型；dev/test 可为 `file`，pre/prod 必须为 `postgres` |
| `GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS` | PostgreSQL bridge store 的 snapshot-rewrite 安全上限，默认 `20000`；超过后写事务失败，要求先改为增量 SQL 仓储 |
| `GOODS_COMM_POSTGRES_ADVISORY_LOCK_KEY` | PostgreSQL snapshot-rewrite 事务级 advisory lock key；pre/prod 应保持一致，确保多实例写入串行化 |
| `GOODS_COMM_POSTGRES_AUTO_SCHEMA` | 是否允许后端启动时自动创建 / 补齐 PostgreSQL schema；dev/test 可为 `true`，pre/prod 必须为 `false`，由显式迁移脚本先初始化数据库 |
| `GOODS_COMM_COS_BUCKET` | 当前环境对象存储 bucket |
| `GOODS_COMM_OBJECT_STORE` | 图片存储类型；dev/test 可为 `local`，pre/prod 必须为 `cos` |
| `GOODS_COMM_PUBLIC_ASSET_BASE_URL` | 图片公开访问前缀 |
| `GOODS_COMM_COS_REGION` / `GOODS_COMM_COS_SECRET_ID` / `GOODS_COMM_COS_SECRET_KEY` | 腾讯 COS 上传凭据 |
| `GOODS_COMM_COS_BASE_URL` / `GOODS_COMM_CDN_BASE_URL` | COS 源站和 CDN 图片访问域名 |
| `GOODS_COMM_MAX_REQUEST_BYTES` | 后端 HTTP 请求体大小上限，应略高于图片上限并在 pre/prod 保持一致 |
| `GOODS_COMM_RATE_LIMIT_MAX_REQUESTS` / `GOODS_COMM_RATE_LIMIT_WINDOW_MS` | 后端进程内客户端 IP 请求限流窗口；pre/prod 应保持一致，真实公网仍应叠加云网关 / WAF 限流 |
| `GOODS_COMM_ROUTE_RATE_LIMIT_MAX_REQUESTS` / `GOODS_COMM_ROUTE_RATE_LIMIT_WINDOW_MS` | 后端进程内接口级请求配额，按客户端和归一化接口路径计数 |
| `GOODS_COMM_USER_RATE_LIMIT_MAX_REQUESTS` / `GOODS_COMM_USER_RATE_LIMIT_WINDOW_MS` | 后端进程内认证主体写请求配额，按 Authorization / 运营 token / 审核密钥的哈希计数，不保存明文 token |
| `GOODS_COMM_TRUSTED_PROXY_IPS` | 可信代理 IP / IPv4 CIDR 列表，或 `none`；只有直连来源命中该列表时，后端才会信任 `x-forwarded-for` 作为限流客户端标识 |
| `GOODS_COMM_MAP_PROVIDER` | 地图 / 社区网格服务提供方；dev/test 可为 `mock`，pre/prod 必须为 `tencent` |
| `GOODS_COMM_MAP_REGION_DATASET` | 内部社区 / 街道网格映射，供后端把腾讯地图结果转换为稳定业务编码；pre/prod 必须是非空 JSON 数组，不能只是数据集标签 |
| `GOODS_COMM_TENCENT_MAP_KEY` / `GOODS_COMM_TENCENT_MAP_GEOCODER_URL` | 腾讯地图 WebService 服务端 Key 和逆地址解析地址 |
| `GOODS_COMM_CONTENT_SECURITY_PROVIDER` | 文本与图片内容安全服务提供方 |
| `GOODS_COMM_MODERATION_WEBHOOK_SECRET` | 微信异步图片审核回调调用 `/moderation/media/:traceId/review`、内部审核任务调用 `/moderation/items/:id/review` 的共享密钥 |
| `GOODS_COMM_SESSION_SECRET` | 服务端 session token 的 HMAC 密钥；pre/prod 必须是真实密钥 |
| `GOODS_COMM_OPS_SESSION_SECRET` | 运营控制台短期会话 token 的 HMAC 密钥；pre/prod 必须是真实密钥 |
| `GOODS_COMM_OPS_ACCOUNTS` | 运营账号配置，格式可为 `account:password:role|role` 或 JSON 数组；用于替代单共享密钥的后台登录；支持 `moderation`、`support`、`notifications`、`telemetry`、`risk` |
| `GOODS_COMM_OPS_LOGIN_MAX_FAILURES` / `GOODS_COMM_OPS_LOGIN_WINDOW_MS` / `GOODS_COMM_OPS_LOGIN_LOCK_MS` | 运营控制台登录失败窗口和短期锁定配置；pre/prod 应保持一致，并配合网关 / WAF 做 IP 级限流 |
| `GOODS_COMM_PLATFORM_AUTH_MODE` | 登录身份模式；dev/test 可为 `demo`，pre/prod 必须为 `platform` |
| `GOODS_COMM_PLATFORM_NOTIFY_PROVIDER` | 平台通知投递提供方；dev/test 可为 `mock`，pre/prod 必须为 `wechat` |
| `GOODS_COMM_ALERT_PROVIDER` | 后端生产告警提供方；dev/test 可为 `none`，pre/prod 必须为 `webhook` |
| `GOODS_COMM_ALERT_WEBHOOK_URL` / `GOODS_COMM_ALERT_WEBHOOK_TOKEN` | 告警 Webhook 地址和鉴权 token；pre/prod 必须替换真实 HTTPS 地址和真实 token |
| `GOODS_COMM_ALERT_TIMEOUT_MS` | 告警 Webhook 超时时间；pre/prod 应保持一致 |
| `GOODS_COMM_ACCESS_LOG_ENABLED` | 后端结构化访问日志开关；dev/test 可关闭，pre/prod 必须为 `true`，日志写 stdout JSON 且只记录归一化路由、状态、耗时和限流摘要 |
| `GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS` | 微信订阅消息模板映射，例如 `trade_created:tmpl1,trade_confirmed:tmpl2` |
| `GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_FIELDS` | 订阅消息模板字段映射，默认兼容 `title:thing1,body:thing2,time:time3` |
| `GOODS_COMM_WECHAT_SUBSCRIBE_SEND_URL` | 微信订阅消息发送接口地址 |
| `GOODS_COMM_WECHAT_APP_ID` / `GOODS_COMM_WECHAT_APP_SECRET` | 微信服务端 code 换 openid 凭据 |
| `GOODS_COMM_ALIPAY_APP_ID` / `GOODS_COMM_ALIPAY_PRIVATE_KEY` | 支付宝服务端 auth code 换 user_id 凭据 |

校验命令：

```bash
npm run env:check
npm run env:check:pre
npm run env:check:prod
npm run audit:production-readiness
npm run verify:release
```

校验脚本会阻断缺失变量、非 HTTPS 的 test/pre/prod API、dev/test/pre/prod 数据库连接串、状态文件路径、对象目录和 COS bucket 互相复用，pre/prod 误用同一数据库或对象存储 bucket，以及 pre/prod 误用 mock 地图服务。`GOODS_COMM_MAX_REQUEST_BYTES` 必须是正整数，后端会在解析 JSON 或 multipart 前拒绝超过该上限的请求体，避免异常请求把运行时内存打满；`GOODS_COMM_RATE_LIMIT_MAX_REQUESTS` / `GOODS_COMM_RATE_LIMIT_WINDOW_MS`、`GOODS_COMM_ROUTE_RATE_LIMIT_MAX_REQUESTS` / `GOODS_COMM_ROUTE_RATE_LIMIT_WINDOW_MS`、`GOODS_COMM_USER_RATE_LIMIT_MAX_REQUESTS` / `GOODS_COMM_USER_RATE_LIMIT_WINDOW_MS` 也必须是正整数，后端会分别按客户端 IP、接口路径和认证主体写请求做基础限流；`GOODS_COMM_TRUSTED_PROXY_IPS` 必须是 `none` 或可信代理 IP / IPv4 CIDR 列表，后端只在直连来源命中该列表时读取 `x-forwarded-for`。`GOODS_COMM_ALERT_PROVIDER` 在 pre/prod 必须是 `webhook`，且 Webhook URL 必须使用 HTTPS。`GOODS_COMM_ACCESS_LOG_ENABLED` 必须是 `true` 或 `false`，pre/prod 必须保持 `true`。`GOODS_COMM_ALLOWED_ORIGINS` 在 pre/prod 必须配置真实 HTTPS Origin，后端启动时会拒绝空值或 `*`。占位值会以 warning 形式输出，不阻塞开发；生产就绪审计不会把 pre/prod 占位连接串、占位 bucket、占位可信代理列表或占位告警 Webhook 计为真实上线条件满足。

上线前审计脚本会额外检查本机是否具备 `cloudbase/tcb` 或 `docker+tccli` 部署链路、`TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` 非交互部署凭据、`psql/pg_dump/pg_restore` 数据库工具、pre/prod 生产依赖模式、pre/prod 拓扑变量一致性、可解析的社区 / 街道网格 JSON、构建产物目录、H5 / 微信 / 支付宝产物内嵌环境与 API Base URL，以及部署后主链路 smoke 所需的临时登录 code / 经纬度输入。默认生成 `docs/deployment-readiness-audit.md` 和 `docs/deployment-readiness-audit.json`；JSON 会把 blockers / warnings / passes 拆成带 `id`、`area`、`severity` 和 `message` 的条目，便于 CI、发布看板或部署脚本逐项消费。使用 `npm run audit:production-readiness -- --check-only` 时，如果仍存在上线 blocker，会返回非 0 退出码；使用 `npm run audit:production-readiness:strict` 会额外生成 strict 审计产物，并把部署后主链路 smoke 输入缺失升级为 blocker。

`npm run verify:release` 是 CI / 发布候选门禁，会串行执行语法检查、核心 smoke、页面契约 smoke、主链路证据矩阵 smoke、workflow smoke、HTTP 后端 smoke、三端四环境构建、前端 / 后端部署 plan、迁移 / 同步 plan 和生产审计报告；quick/full profile 结束时会明确提示它们不是生产放行口径。`npm run verify:release:strict` 只适合真实上线前使用，会先刷新 strict 审计 Markdown / JSON，再把生产就绪审计作为强制 gate；当前占位配置下会因真实云资源、工具链和部署后 smoke 输入缺失失败。

微信 / 支付宝小程序构建脚本会在对应环境存在真实 `GOODS_COMM_WECHAT_APP_ID` 或 `GOODS_COMM_ALIPAY_APP_ID` 时，把 AppID 写入 `project.config.json` / `mini.project.json`。真实上传前 `deploy:frontend:*` 会再次校验构建产物 AppID 与环境配置一致；占位 AppID 不会覆盖 tourist AppID，避免本地和 CI 构建被真实平台配置阻塞。

部署后主链路 smoke 会对商品发布、交易创建、卖家确认、交易列表联系码、交易通知、通知已读、完成售出、售出后详情状态、售出后拒绝再次交易、交易评价、退出登录和退出后 token 拒绝访问带稳定 `Idempotency-Key` 或明确错误码断言。默认每次运行生成新的 `GOODS_COMM_SMOKE_RUN_ID`；如果 CI 需要跨进程复跑同一次写入链路，应同时固定 `GOODS_COMM_SMOKE_RUN_ID` 和 `GOODS_COMM_SMOKE_CAPTURED_AT`，且时间戳仍需在定位有效期内。

GitHub Actions 已分成两类：

- `.github/workflows/ci.yml`：用于 PR / 主干质量门禁，运行 `npm run verify:release`，适合在占位 pre/prod 配置仍存在时保持开发节奏。
- `.github/workflows/release-strict.yml`：用于真实上线前手动触发，先在 runner 安装 `postgresql-client`、CloudBase CLI 和 Tencent `tccli`，再运行 `npm run verify:release:strict`。工作流会从 `GOODS_COMM_PRE_ENV_LOCAL` / `GOODS_COMM_PROD_ENV_LOCAL` 两个多行 Secret 写入 `.env.pre.local` / `.env.prod.local`，从 `GOODS_COMM_PRE_SMOKE_ENV_LOCAL` / `GOODS_COMM_PROD_SMOKE_ENV_LOCAL` 两个多行 Secret 写入 `.env.smoke.pre.local` / `.env.smoke.prod.local`，并从 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY` 和可选 `TENCENTCLOUD_SESSION_TOKEN` 读取非交互部署凭据；strict gate 会先生成 strict 审计 Markdown / JSON，即使随后因 blocker 失败也能上传当前证据；可选 `run_frontend_deploy=true` 在 strict gate 通过后按 `frontend_targets` 部署 H5 / 微信 / 支付宝前端，可选 `run_backend_deploy=true` 在 strict gate 通过后先迁移数据库并部署 pre/prod 后端，再按输入选择运行部署后 health smoke 和主链路 smoke；独立 health smoke 默认等待 12 次、每次 10 秒，可通过 `health_attempts` / `health_interval_ms` 调整；生产部署必须显式开启 `allow_prod_deploy=true`，该输入会传入脚本级 `GOODS_COMM_DEPLOY_ALLOW_PROD=true` 和 `GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true`；生产主链路 smoke 必须显式开启 `allow_prod_mutation=true`；无论成功失败都会上传普通审计和 strict 审计 Markdown / JSON。

后端运行时也会做保护：`pre/prod` 默认选择 PostgreSQL store，如果显式配置 `GOODS_COMM_STATE_STORE=file` 会直接启动失败，避免预上线或生产误连本地文件状态；`pre/prod` 还要求 `GOODS_COMM_POSTGRES_AUTO_SCHEMA=false`，后端只校验 schema 是否已通过迁移脚本初始化，不会在正式流量路径里静默建表；`pre/prod` 同时禁止 `GOODS_COMM_PLATFORM_AUTH_MODE=demo`、`GOODS_COMM_OBJECT_STORE=local`、`GOODS_COMM_CONTENT_SECURITY_PROVIDER=mock`、`GOODS_COMM_MAP_PROVIDER=mock` 和 `GOODS_COMM_PLATFORM_NOTIFY_PROVIDER=mock`，避免正式环境使用演示登录、本地图片、mock 审核、样例区域数据或 mock 模板消息。生产告警通过 `/health/ready` 校验 `GOODS_COMM_ALERT_PROVIDER=webhook` 的 Webhook URL、HTTPS 和 token 配置；结构化访问日志通过 `GOODS_COMM_ACCESS_LOG_ENABLED=true` 写 stdout JSON，只记录 trace id、HTTP 方法、归一化路由、状态码、耗时、CORS 和限流摘要，不记录 query、请求头、请求体或动态业务 ID。配置仍是占位值时 readiness 不应通过。

## 3. 构建和运行命令

前端四环境构建：

```bash
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

H5 构建可用于浏览器联调：端侧会优先使用浏览器 geolocation 获取实时位置；dev/test 在没有小程序登录 API 时可以生成本地 H5 演示登录态。pre/prod 后端仍要求 `GOODS_COMM_PLATFORM_AUTH_MODE=platform`，不会接受演示登录作为正式身份；如果 H5 对公网开放，需要另行接入 OAuth / SSO，并把 H5 域名加入 `GOODS_COMM_ALLOWED_ORIGINS` 和平台合法域名配置。

后端四环境启动：

```bash
npm run backend:start:dev
npm run backend:start:test
npm run backend:start:pre
npm run backend:start:prod
```

后端 `/health` 会返回当前 `environment`、`stateStore`、`objectStore`、`contentSafety`、`mapProvider`、`platformNotify`、`opsAlert` 和 `accessLog`，用于部署后快速确认服务实际加载的环境与生产依赖。

数据库迁移与后端部署计划：

```bash
npm run db:migrate:plan -- --env pre
npm run deploy:backend:pre:plan
```

执行真实迁移或部署时必须额外提供确认变量，例如 `GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre` 和 `GOODS_COMM_DEPLOY_CONFIRM=deploy-pre`，并替换 `.env.pre/.env.prod` 中的占位云资源、密钥和数据库连接串。生产数据库迁移还必须显式设置 `GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true`，生产后端部署还必须显式设置 `GOODS_COMM_DEPLOY_ALLOW_PROD=true`，避免绕过 GitHub release workflow 直接误操作生产。pre/prod 后端启动前必须先执行对应环境的数据库迁移；真实后端部署脚本默认会先构建并验证 `dist/backend`，再跑迁移、部署新版本，并立即执行部署后 health smoke，默认等待 12 次、每次间隔 10 秒，只有确认同版本 schema 已迁移时才允许用 `--skip-db-migrate` 或 `GOODS_COMM_DEPLOY_SKIP_DB_MIGRATE=true` 跳过。如果缺表，`/health/ready` 会返回依赖未就绪，而不是自动创建表。需要把主链路 smoke 合并到直接部署命令时，可额外传 `--run-main-smoke` 或设置 `GOODS_COMM_DEPLOY_RUN_MAIN_SMOKE=true`；需要调整 health 等待窗口时，可传 `--health-attempts` / `--health-interval-ms`。

部署完成后运行：

```bash
npm run smoke:deployed:pre
npm run smoke:deployed:pre:main
npm run smoke:deployed:prod
```

`smoke:deployed:*` 会检查 `/health` 和 `/health/ready`，确认 pre/prod 实际使用 `postgres`、`cos`、内容安全 `wechat`、地图 `tencent`、平台通知 `wechat`、生产告警 `webhook` 和结构化访问日志 `accessLog.enabled=true`，并断言 `x-content-type-options`、`x-frame-options`、`referrer-policy`、`permissions-policy` 等安全响应头未被云网关 / CDN 覆盖；pre/prod 还会要求 HSTS。

`smoke:deployed:pre:main` 会对真实 HTTPS API 执行登录、区域解析、未登录上传拒绝、图片上传、商品发布、发起交易、卖家确认、买卖双方交易列表、交易通知、一次性联系码格式 / 过期时间 / 完成后清空、买家完成、售出后拒绝二次交易、公开商品响应隐私脱敏、客户端伪造审核身份字段不外泄、评价、退出登录和退出后旧 token 拒绝访问。它需要注入短期平台登录 code 与一个业务覆盖范围内的经纬度；如果要把账号注销也纳入真实部署后验收，可额外提供独立一次性测试账号 `GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE`，不要复用 seller/buyer 主烟测账号：

```bash
cp .env.smoke.pre.example .env.smoke.pre.local
# replace one-time codes, API URL, coordinates and approved image URL
npm run smoke:deployed:pre:main
```

如果真实微信图片审核把上传图片置为异步待审，还需要设置 `GOODS_COMM_SMOKE_APPROVED_IMAGE_URL` 指向一张已审核通过的 HTTPS 测试图，供完整发布/交易链路继续执行。生产主链路 smoke 会写入真实数据，必须额外设置 `GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=true`。

## 4. pre/prod 数据同步

目标：生产数据支持自动或手动同步到预上线，方便使用接近真实的数据回归，但不能把生产登录态、联系码等敏感信息原样带入预上线。

已提供命令：

```bash
npm run sync:prod-to-pre:plan
GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre npm run sync:prod-to-pre
GOODS_COMM_SYNC_AUTO_ENABLED=true npm run sync:prod-to-pre:auto
```

执行脚本的保护：

- prod 和 pre 数据库连接串必须不同。
- pre/prod 关键拓扑变量必须一致，包括 PostgreSQL schema、状态存储模式、对象存储模式、地图 provider、社区网格数据、内容安全 provider、平台登录 / 通知 provider 和平台网关等。
- `.env.pre` 必须设置 `GOODS_COMM_ACCEPTS_PROD_SYNC=true`。
- `.env.prod` 必须设置 `GOODS_COMM_PROD_SYNC_EXPORT=true`。
- 有 `REPLACE_WITH` 或 placeholder 数据库连接串时拒绝执行真实同步。
- 需要本机或云任务环境存在 `pg_dump`、`pg_restore`、`psql`。
- 真实执行时会写同步锁，默认路径为 `/private/tmp/goods-comm-prod-to-pre.lock`，避免定时任务重入。
- 执行结果会追加到审计日志，默认路径为 `/private/tmp/goods-comm-prod-to-pre-audit.jsonl`；审计记录包含 `acquire_lock`、`verify_toolchain`、`dump_prod`、`reset_pre`、`restore_pre`、`anonymize_pre`、`remove_prod_dump` 和可选 smoke 阶段的状态、时间戳、耗时与失败原因，便于定时任务排障。
- 同步后执行 `backend/db/pre-sync-anonymize.sql`：吊销 session、清空交易联系码、删除旧版 `bff_state_snapshots` JSON 快照、脱敏平台 openid/unionid、用户昵称/头像/联系码、商品标题/描述/精确坐标、交易标题、位置审计坐标、图片 URL / COS key / checksum / 审核 trace、举报/争议/评价/运营日志内容。

推荐自动同步方式：

- 在腾讯云定时任务、云托管定时触发器或内部 CI runner 上每天低峰执行一次 `npm run sync:prod-to-pre:auto`。
- 执行前注入真实 prod/pre 数据库连接串和 `GOODS_COMM_SYNC_AUTO_ENABLED=true`；自动模式不读取手动确认变量，便于放入定时任务。
- 如需同步后自动检查 pre 健康状态，可额外设置 `GOODS_COMM_SYNC_RUN_PRE_SMOKE=true`，脚本会执行 `node scripts/deployed-health-smoke.mjs --env pre`，默认等待 12 次、每次间隔 10 秒；可用 `GOODS_COMM_SYNC_HEALTH_ATTEMPTS` / `GOODS_COMM_SYNC_HEALTH_INTERVAL_MS` 调整等待窗口。
- 如需同步后自动验证 pre 主链路，可额外设置 `GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true`，脚本会执行 `node scripts/deployed-main-flow-smoke.mjs --env pre`；这需要在 shell 或 `.env.smoke.pre.local` 配置 `GOODS_COMM_SMOKE_SELLER_CODE`、`GOODS_COMM_SMOKE_BUYER_CODE`、`GOODS_COMM_SMOKE_LATITUDE`、`GOODS_COMM_SMOKE_LONGITUDE` 和必要时的 `GOODS_COMM_SMOKE_APPROVED_IMAGE_URL`。
- 可按任务环境设置 `GOODS_COMM_SYNC_LOCK_PATH`、`GOODS_COMM_SYNC_AUDIT_PATH` 和 `GOODS_COMM_SYNC_DUMP_PATH`；锁和审计日志应落在可追踪位置，dump 路径应使用执行机临时目录，脚本会在成功或失败后删除本地生产 dump。
- GitHub Actions 已提供 `.github/workflows/prod-to-pre-sync.yml`：`workflow_dispatch` 支持手动 `plan` / `execute`，`schedule` 支持每天低峰自动运行；只有仓库变量 `GOODS_COMM_SYNC_AUTO_ENABLED=true` 时，定时任务才会真正执行同步。手动执行可选择 `run_pre_main_smoke`，并可用 `health_attempts` / `health_interval_ms` 调整同步后 pre health smoke 等待窗口；定时任务可用仓库变量 `GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true` 打开同步后 pre 主链路 smoke，也可用 `GOODS_COMM_SYNC_HEALTH_ATTEMPTS` / `GOODS_COMM_SYNC_HEALTH_INTERVAL_MS` 调整健康检查重试。工作流从 `GOODS_COMM_PRE_ENV_LOCAL` / `GOODS_COMM_PROD_ENV_LOCAL` 多行 Secret 写入 `.env.pre.local` / `.env.prod.local`，从 `GOODS_COMM_PRE_SMOKE_ENV_LOCAL` 写入 `.env.smoke.pre.local`，dump 和锁文件落在 runner 临时目录，只上传脱敏同步审计日志，不上传生产 dump。

推荐手动同步方式：

- 发布候选版本进入 pre 前，由具备数据库权限的发布人员在受控机器执行同一个脚本。
- 同步完成后进行预上线验收；验收通过后再发布 prod。
- 如使用 GitHub Actions 手动同步，选择 `.github/workflows/prod-to-pre-sync.yml` 的 `execute`，并输入 `confirm_sync=sync-prod-to-pre`。未输入确认值时，脚本会拒绝执行真实同步。
