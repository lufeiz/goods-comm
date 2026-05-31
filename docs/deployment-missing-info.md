# goods-comm 部署前置信息清单

更新日期：2026-05-30

本文件记录真实部署仍缺少的信息。缺失项不阻塞工程开发：当前 `.env.dev/test/pre/prod` 已使用占位值，后端、数据库 schema、环境校验、构建产物和 prod 到 pre 同步脚本都可以先行开发和验证。真实部署前可从 `.env.pre.local.example` / `.env.prod.local.example` 复制出 `.env.pre.local` / `.env.prod.local` 并填入真实值；本地覆盖文件已被 `.gitignore` 排除，GitHub Actions 则使用 `GOODS_COMM_PRE_ENV_LOCAL` / `GOODS_COMM_PROD_ENV_LOCAL` 多行 Secret 写入同名文件。部署后 smoke 的短期登录 code、坐标和已审核测试图等一次性输入可从 `.env.smoke.pre.example` / `.env.smoke.prod.example` 复制出 `.env.smoke.pre.local` / `.env.smoke.prod.local`，部署 smoke、部署脚本和生产审计会自动读取这些文件。

## 1. 平台账号与应用

| 项 | dev | test | pre | prod | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| 微信小程序 AppID | `REPLACE_WITH_DEV_WECHAT_APP_ID` | `REPLACE_WITH_TEST_WECHAT_APP_ID` | `REPLACE_WITH_PRE_WECHAT_APP_ID` | `REPLACE_WITH_PROD_WECHAT_APP_ID` | 缺真实值 |
| 支付宝小程序 AppID | `REPLACE_WITH_DEV_ALIPAY_APP_ID` | `REPLACE_WITH_TEST_ALIPAY_APP_ID` | `REPLACE_WITH_PRE_ALIPAY_APP_ID` | `REPLACE_WITH_PROD_ALIPAY_APP_ID` | 缺真实值 |
| 微信 `code2Session` AppSecret | 平台密钥 | 平台密钥 | 平台密钥 | 平台密钥 | 缺真实值 |
| 支付宝 auth code 换取凭据 | 平台密钥 | 平台密钥 | 平台密钥 | 平台密钥 | 缺真实值 |

## 2. 云资源

| 资源 | 要求 | 当前占位 |
| --- | --- | --- |
| 微信云托管 / CloudBase 环境 ID | dev/test/pre/prod 各一套，或至少 test/pre/prod 独立 | `.env.*` 中的 `GOODS_COMM_CLOUDBASE_ENV_ID` |
| 腾讯云 fallback 服务 | 当微信云托管不可用时，准备 Tencent Cloud 运行区域、服务 ID 和容器镜像地址 | `.env.*` 中的 `GOODS_COMM_TENCENT_REGION` / `GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE` / `GOODS_COMM_TENCENT_CONTAINER_IMAGE` |
| HTTPS API 域名 | test/pre/prod 必须 HTTPS，并配置为微信/支付宝合法 request/upload 域名 | `test-api.goods-comm.example.com`, `pre-api.goods-comm.example.com`, `api.goods-comm.example.com` |
| 腾讯云数据库 PostgreSQL | dev/test/pre/prod 独立库；pre/prod 两套不同数据库 | `.env.*` 中的 `GOODS_COMM_DATABASE_URL` |
| COS / CloudBase storage bucket | dev/test/pre/prod 独立 bucket；pre/prod 不共用 | `.env.*` 中的 `GOODS_COMM_COS_BUCKET` |
| COS SecretId / SecretKey / Region | pre/prod 需要真实腾讯云 COS 上传权限 | `.env.*` 中的 `GOODS_COMM_COS_SECRET_ID` / `GOODS_COMM_COS_SECRET_KEY` / `GOODS_COMM_COS_REGION` |
| CDN 域名 | test/pre/prod 图片访问域名 | `.env.*` 中的 `GOODS_COMM_CDN_BASE_URL` |
| 腾讯地图 WebService Key | 后端逆地址解析调用，不能放端侧 | `GOODS_COMM_TENCENT_MAP_KEY` |
| 社区 / 街道网格数据 | 将腾讯地图行政区和街道结果映射到业务稳定 `communityId` / `streetId`；当前 `.env.*` 已放入可解析的非空 JSON 数组占位，真实部署前仍要替换为正式社区 / 街道网格数据 | `GOODS_COMM_MAP_REGION_DATASET` |
| 内容安全服务 | 文本和图片审核，发布前或异步审核 | `GOODS_COMM_CONTENT_SECURITY_PROVIDER=wechat` |
| 审核回调密钥 | 微信异步图片审核回调调用 `/moderation/media/:traceId/review`、内部审核任务调用 `/moderation/items/:id/review` 时使用 | `GOODS_COMM_MODERATION_WEBHOOK_SECRET` |
| 会话签名密钥 | 服务端签发登录 token 后，只持久化 HMAC-SHA256 hash；pre/prod 必须独立配置 | `GOODS_COMM_SESSION_SECRET` |
| 运营后台账号与会话密钥 | 内部运营控制台登录、短期 token 签发、操作人注入和审计 | `GOODS_COMM_OPS_ACCOUNTS` / `GOODS_COMM_OPS_SESSION_SECRET` |
| 微信订阅消息模板 | 交易创建、确认、完成、取消、争议、争议处理、评价等平台模板消息 | `GOODS_COMM_PLATFORM_NOTIFY_PROVIDER=wechat`、`GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS`、`GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_FIELDS` |
| 生产告警 Webhook | 平台通知投递失败、通知重试失败等后端异常事件外发到值班/监控系统；pre/prod 必须使用 HTTPS 且配置鉴权 token | `GOODS_COMM_ALERT_PROVIDER=webhook`、`GOODS_COMM_ALERT_WEBHOOK_URL`、`GOODS_COMM_ALERT_WEBHOOK_TOKEN`、`GOODS_COMM_ALERT_TIMEOUT_MS` |
| 结构化访问日志 | pre/prod 必须开启 stdout JSON 访问日志，云侧再接日志采集；当前不需要外部密钥 | `GOODS_COMM_ACCESS_LOG_ENABLED=true` |

## 3. 部署执行凭据

真实部署前需要准备：

- GitHub Actions / CI Secret：`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`，临时密钥场景再加 `TENCENTCLOUD_SESSION_TOKEN`；运行时覆盖使用 `GOODS_COMM_PRE_ENV_LOCAL` / `GOODS_COMM_PROD_ENV_LOCAL`，部署后 smoke 输入优先使用 `GOODS_COMM_PRE_SMOKE_ENV_LOCAL` / `GOODS_COMM_PROD_SMOKE_ENV_LOCAL`。
- 云 API 权限：CloudBase / 微信云托管部署、TencentDB PostgreSQL 连接与迁移、COS 读写、CDN 域名管理、Tencent Cloud Run / TEM fallback 部署。
- 本地手动执行可使用已登录的 CloudBase CLI；非交互 CI 必须提供上述腾讯云 API 凭据。
- 容器构建能力：本地 Docker、云构建，或腾讯云容器镜像服务。
- 数据库迁移账号：可执行 `backend/db/schema.sql`。
- 数据库验证账号：可在 pre/prod 临时执行主链路 smoke，验证 `backend/src/postgres-state-store.mjs` 对规范化表的真实读写。
- prod 到 pre 同步账号：prod 只读导出权限，pre 写入/截断权限。

当前本机检查结果：`cloudbase`、`tcb`、`tccli`、`docker`、`pg_dump`、`pg_restore`、`psql` 均未安装或不在 `PATH`，且当前 shell 未提供 `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`。这不影响代码、构建和 smoke；实际推送云环境或执行 prod 到 pre 数据同步时再补 CLI、PostgreSQL 客户端工具与部署凭据。

当前已提供可执行计划脚本：

- `npm run audit:production-readiness`：生成上线前审计报告，汇总本机工具、pre/prod 真实配置、后端部署包完整性、三端构建产物、部署 smoke 输入和 prod 到 pre 同步条件，默认写入 `docs/deployment-readiness-audit.md` 和机器可读的 `docs/deployment-readiness-audit.json`。
- `npm run audit:production-readiness -- --check-only`：只做检查并在存在上线 blocker 时返回非 0，可放入发布门禁或 CI。
- `npm run audit:production-readiness:strict`：生成严格上线审计报告，额外把部署后主链路 smoke 输入缺失视为 blocker，默认写入 `docs/deployment-readiness-audit-strict.md` 和 `docs/deployment-readiness-audit-strict.json`。
- `npm run audit:production-readiness:strict-check`：只做严格上线检查并在存在 blocker 时返回非 0；`verify:release:strict` 使用同一口径。
- `npm run verify:release:quick`：本地快速门禁，执行语法检查、核心 smoke、默认三端构建和生产审计报告；命令结束时会明确提示 quick/full 不是生产放行口径。
- `npm run verify:release`：CI / 发布候选门禁，执行语法检查、完整 smoke、HTTP 后端 smoke、三端四环境构建、迁移 / 部署 / 同步 plan 和生产审计报告；命令结束时会明确提示 full 只生成生产审计，不会因为剩余生产 blocker 失败。
- `npm run verify:release:strict`：真实上线门禁，在 full 门禁基础上先刷新 `docs/deployment-readiness-audit-strict.md` / `docs/deployment-readiness-audit-strict.json`，再把生产就绪审计改为强制 `--check-only --require-deployed-smoke-inputs`；pre/prod 真实资源、密钥、工具链和部署后 smoke 输入未补齐时会失败。
- `npm run github:push:preflight`：推送 GitHub 前检查 `origin`、`main` upstream、工作区干净和 GitHub CLI token 的 `repo` / `workflow` scope；用于人工推送和每天 21:00 自动推送前置检查，避免 release gate 已通过但 workflow 文件因 token 权限不足推送失败。
- `npm run smoke:env-local-templates`：检查 `.env.pre.local.example` / `.env.prod.local.example` 是否覆盖真实上线需要替换的关键变量，并保持 pre/prod 的 PostgreSQL、COS、腾讯地图、微信内容安全、Webhook 告警、访问日志和平台登录/通知模式。
- `npm run smoke:pages`：静态检查 `src/pages.json`、tabBar、页面文件、模板事件处理器、页面跳转路径，以及登录、定位、发布、交易、运营、协议等关键页面必须接入的 service 和关键显示状态；`verify:release` / `verify:release:strict` 已接入该检查。
- `npm run smoke:main-flow-contract`：检查登录协议与账号生命周期、定位解析与显示可信边界、发布与图片上传、交易售卖生命周期，以及 release gate 是否串联页面、BFF、HTTP 后端和部署后主链路 smoke 证据；`verify:release` / `verify:release:strict` 已接入该检查。
- `npm run smoke:location-permissions`：用 mock `uni` 和浏览器 geolocation 覆盖定位授权拒绝、首次授权拒绝、系统定位关闭、超时、网络异常、无效坐标、低精度、区域解析失败、H5 浏览器权限、缓存过期和最终交易必须使用实时 GPS 的权限/质量矩阵；`verify:release` / `verify:release:strict` 已接入该检查。
- `npm run smoke:ops-alerts`：检查生产告警适配器的关闭态、Webhook 投递、鉴权头、敏感字段脱敏、占位 URL 拒绝、pre/prod HTTPS 要求和失败响应处理；`verify:release` / `verify:release:strict` 已接入该检查。
- `npm run smoke:request-logger`：检查结构化访问日志开关、JSON 输出、错误级别、query/header/body 不落日志，以及动态交易路径归一化；`verify:release` / `verify:release:strict` 已接入该检查。
- `npm run smoke:deployed-input-templates`：检查 `.env.smoke.pre.example` / `.env.smoke.prod.example` 是否覆盖部署后 health / main-flow smoke 所需 API、登录 code、坐标、范围、重试窗口、已审核测试图和可选账号注销输入，并强制生产模板默认 `GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=false`；`verify:release` / `verify:release:strict` 已接入该检查。
- `npm run smoke:deployed-env-files`：检查 `.env.smoke.<env>.local` 自动加载语义，确保 shell 显式变量优先，缺省值才从本地 smoke 文件补入；`verify:release` / `verify:release:strict` 已接入该检查。
- `npm run smoke:h5:render`：启动本地 H5 构建产物和 headless Chrome，用真实渲染页面验证 H5 登录、浏览器定位显示、发布表单、图片预览、商品发布、买家发起交易、卖家确认和完成售卖主链路；脚本不引入 Playwright 依赖，可用 `GOODS_COMM_CHROME_PATH` 指定 Chrome/Chromium，可用 `--dist` 指向 dev/test/pre/prod H5 产物；`verify:release` / `verify:release:strict` 已在 H5 构建后接入该检查。
- `npm run smoke:backend:artifact`：检查 `dist/backend` 后端部署包包含 `package.json`、`package-lock.json`、Node HTTP server、BFF、PostgreSQL store、数据库 schema、容器 Dockerfile 和关键业务依赖，并验证 Dockerfile 会用 `npm ci` 按 artifact lockfile 安装生产依赖，避免真实 PostgreSQL store 部署时缺少或漂移 `pg`；`verify:release` / `verify:release:strict` 已在 `build:backend` 后接入该检查。
- `npm run smoke:artifacts`：检查默认 H5 / 微信 / 支付宝构建产物是否包含 `src/pages.json` 中的核心页面、tabBar、关键组件、H5 页面 chunk 和小程序开发者工具导入配置；`verify:release` / `verify:release:strict` 会用同一脚本检查 dev/test/pre/prod 四环境三端产物。
- `npm run smoke:workflows`：检查 `.github/workflows/ci.yml`、`release-strict.yml` 和 `prod-to-pre-sync.yml` 的关键发布保护，确保 CI 调用 release gate、strict gate 上传普通/严格审计、部署后 smoke 不能被部署动作绕过、prod 部署/主链路 mutation 需要显式确认、prod-to-pre sync 不上传生产 dump；`verify:release` / `verify:release:strict` 已接入该检查。
- `.github/workflows/release-strict.yml`：真实上线前手动 GitHub Actions 门禁。工作流会先安装 PostgreSQL client、CloudBase CLI 和 Tencent `tccli`，但仍需要配置 `GOODS_COMM_PRE_ENV_LOCAL` / `GOODS_COMM_PROD_ENV_LOCAL` 多行 Secret 覆盖 `.env.pre` / `.env.prod` 占位值，配置 `GOODS_COMM_PRE_SMOKE_ENV_LOCAL` / `GOODS_COMM_PROD_SMOKE_ENV_LOCAL` 多行 Secret 覆盖 `.env.smoke.pre.local` / `.env.smoke.prod.local` 一次性 smoke 输入，配置 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY` 和可选 `TENCENTCLOUD_SESSION_TOKEN` 做非交互部署认证；也可继续配置单个 `GOODS_COMM_SMOKE_SELLER_CODE`、`GOODS_COMM_SMOKE_BUYER_CODE`、`GOODS_COMM_SMOKE_LATITUDE`、`GOODS_COMM_SMOKE_LONGITUDE` 和可选 `GOODS_COMM_SMOKE_APPROVED_IMAGE_URL`，这些非空 shell 变量会覆盖 `.env.smoke.*.local`。工作流会同时上传普通审计和严格审计产物，避免 strict gate 失败时只留下普通 warning 口径；如果启用 `run_frontend_deploy=true`，工作流会按 `frontend_targets` 执行前端部署，H5 使用 CloudBase 静态托管，小程序端需要额外配置 `GOODS_COMM_WECHAT_DEVTOOLS_CLI` / `GOODS_COMM_ALIPAY_MINI_CLI` Secret 指向上传 CLI；如果启用 `run_backend_deploy=true`，工作流会先迁移目标数据库并部署后端，且强制 `run_deployed_smoke=true`，避免部署后跳过 health / main-flow smoke；独立 deployed health smoke 默认等待 12 次、每次 10 秒，可用 `health_attempts` / `health_interval_ms` 调整；生产部署还需要手动输入 `allow_prod_deploy=true`，并传入脚本级 `GOODS_COMM_DEPLOY_ALLOW_PROD=true` / `GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true`；生产主链路 smoke 需要手动输入 `allow_prod_mutation=true`。
- Codex 本地自动化 `goods-comm-nightly-github-push` 已配置为每天 21:00 在本仓库运行：先执行 `npm run verify:release:quick -- --skip-http-backend`，通过后再提交变更、执行 `npm run github:push:preflight` 并推送 `origin/main`；验证失败时不推送。
- `npm run db:migrate:plan -- --env pre`：输出 pre 数据库 schema 初始化计划。
- `GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre npm run db:migrate:pre`：真实执行 pre 数据库 schema 初始化，要求真实连接串和 `psql`；生产迁移还必须额外设置 `GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true`。
- `npm run deploy:frontend:pre:plan`：输出 pre H5、微信小程序、支付宝小程序前端部署计划和缺失前置条件；计划会要求真实 `VITE_API_BASE_URL`、H5 CloudBase 静态托管环境、微信 / 支付宝真实 AppID、微信开发者工具 CLI、支付宝小程序 CLI 和非交互云凭据。
- `GOODS_COMM_FRONTEND_DEPLOY_CONFIRM=deploy-frontend-pre npm run deploy:frontend:pre`：真实执行 pre 前端部署；脚本先跑 `env:check:pre`，再构建目标前端产物、运行环境定向 artifact checks，之后校验微信 / 支付宝构建产物 AppID 与环境配置一致，最后才上传 H5 到 CloudBase 静态托管，并通过对应 CLI 上传微信 / 支付宝小程序；生产执行还必须额外设置 `GOODS_COMM_DEPLOY_ALLOW_PROD=true`。
- `GOODS_COMM_FRONTEND_DEPLOY_TARGET=h5|mp-weixin|mp-alipay|all` 或 `--target h5,weixin,alipay`：限制前端部署目标，便于先单独验证 H5 或某个小程序端。
- `npm run smoke:mini-program-deploy-config`：检查微信 `project.config.json` 和支付宝 `mini.project.json` 在存在真实 AppID 时会被构建脚本写入真实值，仍为占位值时保留 tourist AppID 供本地 / CI 构建使用。
- `GOODS_COMM_WECHAT_DEVTOOLS_CLI` / `WECHAT_DEVTOOLS_CLI`：微信小程序上传 CLI 路径；真实上传还要求开发者工具登录态、项目成员权限、合法业务域名和真实 AppID。
- `GOODS_COMM_ALIPAY_MINI_CLI` / `ALIPAY_MINI_CLI`：支付宝小程序上传 CLI 路径；真实上传还要求支付宝开放平台权限、合法域名和真实 AppID。
- `npm run deploy:backend:pre:plan`：输出微信优先、腾讯 fallback 的后端部署计划和缺失前置条件；计划包含真实 HTTPS API、CORS Origin、数据库、COS/CDN、地图、内容安全、session、运营账号、可信代理、平台通知、生产告警和平台登录等运行时配置，也包含 `build:backend` 后的 `smoke:backend:artifact`，确保真实部署前先验证后端部署包。
- `GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre GOODS_COMM_DEPLOY_CONFIRM=deploy-pre npm run deploy:backend:pre`：真实执行后端部署，默认先构建并验证后端部署包，再跑 pre 数据库迁移，部署新后端后立即执行 deployed health smoke；health smoke 默认等待 12 次、每次间隔 10 秒，可用 `--health-attempts` / `--health-interval-ms` 或 `GOODS_COMM_DEPLOY_HEALTH_ATTEMPTS` / `GOODS_COMM_DEPLOY_HEALTH_INTERVAL_MS` 调整，用于覆盖云托管冷启动和滚动发布延迟；要求真实云配置、CLI、`psql` 和部署凭据；生产部署必须额外设置 `GOODS_COMM_DEPLOY_ALLOW_PROD=true`，如果同时执行生产数据库迁移还必须设置 `GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true`；只有确认同版本 schema 已迁移时才使用 `--skip-db-migrate` 跳过迁移。需要把部署和主链路验证绑定到同一个直接命令时，可加 `--run-main-smoke` 或 `GOODS_COMM_DEPLOY_RUN_MAIN_SMOKE=true`，脚本会要求 seller/buyer code、经纬度，prod 还要求 `GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=true`。
- `npm run smoke:deployed:pre`：部署后检查 health/ready、生产依赖模式、`opsAlert=webhook`、`accessLog.enabled=true` 和安全响应头；pre/prod 会断言 HSTS，避免云网关 / CDN 把后端安全头剥掉。
- `npm run smoke:deployed:local-health`：启动本地 Node HTTP 后端，并用同一套 `scripts/deployed-health-smoke.mjs` 黑盒验证 `/health`、`/health/ready` 和基础安全响应头；该本地自测通过 `GOODS_COMM_SMOKE_API_BASE_URL` 指向临时后端，真实 pre/prod 仍使用 `.env.pre/.env.prod` 的 HTTPS API 域名。
- `npm run smoke:deployed:pre:main`：部署后检查登录、定位、未登录上传拒绝、上传、发布、交易、卖家确认、交易列表一次性联系码格式与过期时间、交易通知、通知已读、完成售出、完成后联系码清空、售出后详情状态、售出后拒绝再次交易、评价、公开商品响应不暴露卖家联系码、精确经纬度或客户端伪造的审核身份字段、退出登录和退出后 token 拒绝访问；需要短期平台登录 code、网格覆盖坐标，以及必要时的已审核测试图片 URL。可先复制 `.env.smoke.pre.example` 到 `.env.smoke.pre.local` 并填值，脚本会自动读取；shell 中显式提供的同名变量仍会覆盖本地文件。写请求会带幂等键并立即验证回放；跨进程重试同一次 smoke 时可固定 `GOODS_COMM_SMOKE_RUN_ID` 和 `GOODS_COMM_SMOKE_CAPTURED_AT`。如需把账号注销也纳入真实部署后验收，可额外提供一次性测试账号 `GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE`，脚本会发布一件独立烟测商品、注销该账号、验证 token 失效和商品下架；该 code 必须不同于 seller/buyer 主烟测账号。
- `npm run smoke:deployed:local-main`：启动本地 Node HTTP 后端，并用同一套 `scripts/deployed-main-flow-smoke.mjs` 黑盒验证登录、定位、未登录上传拒绝、上传、发布、交易、卖家确认、交易列表一次性联系码生命周期、交易通知、通知已读、完成售出、完成后联系码清空、售出后详情状态、售出后拒绝再次交易、评价、公开商品隐私脱敏、客户端伪造审核身份字段不外泄、可选账号注销、退出登录和退出后 token 拒绝访问，避免部署后主链路 smoke 脚本只做语法检查。该本地自测通过 `GOODS_COMM_SMOKE_API_BASE_URL` 指向临时后端，并默认注入独立注销测试账号；真实 pre/prod 仍使用 `.env.pre/.env.prod` 的 HTTPS API 域名。
- `npm run sync:prod-to-pre:plan`：输出 prod 到 pre 数据同步计划，不写数据库。
- `GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre npm run sync:prod-to-pre`：手动执行 prod 到 pre 同步，要求真实连接串、PostgreSQL 工具、确认变量，并要求 pre/prod 关键拓扑变量一致。
- `GOODS_COMM_SYNC_AUTO_ENABLED=true npm run sync:prod-to-pre:auto`：给可信定时任务使用的自动同步入口，带锁文件、审计日志和占位连接串保护；同步成功或失败后都会尝试删除本地生产 dump，并把 `remove_prod_dump` 写入审计阶段；可选 `GOODS_COMM_SYNC_RUN_PRE_SMOKE=true` 在同步后跑带重试的 pre 健康 smoke，可选 `GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true` 在同步后跑 pre 主链路 smoke；健康 smoke 等待窗口可用 `GOODS_COMM_SYNC_HEALTH_ATTEMPTS` / `GOODS_COMM_SYNC_HEALTH_INTERVAL_MS` 调整。
- `.github/workflows/prod-to-pre-sync.yml`：prod 到 pre 数据同步的 GitHub Actions 运维入口。手动 `plan` 只输出计划，手动 `execute` 需要输入 `confirm_sync=sync-prod-to-pre`；手动执行可选择 `run_pre_smoke` 和 `run_pre_main_smoke`，并可用 `health_attempts` / `health_interval_ms` 调整同步后 pre health smoke 等待窗口；定时任务只有仓库变量 `GOODS_COMM_SYNC_AUTO_ENABLED=true` 时才会真正执行，且可用仓库变量 `GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true` 开启同步后 pre 主链路 smoke，用 `GOODS_COMM_SYNC_HEALTH_ATTEMPTS` / `GOODS_COMM_SYNC_HEALTH_INTERVAL_MS` 调整健康检查重试。需要配置 `GOODS_COMM_PRE_ENV_LOCAL` / `GOODS_COMM_PROD_ENV_LOCAL` 多行 Secret、数据库可访问网络；主链路 smoke 可配置 `GOODS_COMM_PRE_SMOKE_ENV_LOCAL` 多行 Secret，或继续配置单个 `GOODS_COMM_SMOKE_SELLER_CODE`、`GOODS_COMM_SMOKE_BUYER_CODE`、`GOODS_COMM_SMOKE_LATITUDE`、`GOODS_COMM_SMOKE_LONGITUDE`。工作流只上传脱敏同步审计日志，不上传生产 dump，脚本也会清理 runner 临时 dump。

## 4. 不阻塞开发的占位策略

- 前端使用 `.env.dev/test/pre/prod` 里的 `VITE_API_BASE_URL` 构建不同环境产物。
- 后端通过 `GOODS_COMM_ENV`、`GOODS_COMM_ALLOWED_ORIGINS`、`GOODS_COMM_DATABASE_URL` 区分运行环境。
- `npm run env:check` 会阻断 dev/test/pre/prod 复用同一个 `GOODS_COMM_DATABASE_URL`、`GOODS_COMM_STATE_PATH`、`GOODS_COMM_OBJECT_DIR` 或 `GOODS_COMM_COS_BUCKET`；即使还在占位阶段，也必须保持四套环境的持久化边界互相独立。
- pre/prod 后端通过 `GOODS_COMM_STATE_STORE=postgres` 连接 PostgreSQL；文件状态存储会被运行时拒绝。
- pre/prod 后端通过 `GOODS_COMM_PLATFORM_AUTH_MODE=platform` 调用真实微信 / 支付宝登录换身份接口；演示登录会被运行时拒绝。
- pre/prod 后端通过 `GOODS_COMM_OBJECT_STORE=cos` 上传商品图片到 COS/CDN；本地对象存储会被运行时拒绝。
- pre/prod 后端通过 `GOODS_COMM_CONTENT_SECURITY_PROVIDER=wechat` 做文本和图片内容安全；mock 审核会被运行时拒绝。
- pre/prod 后端通过 `GOODS_COMM_MAP_PROVIDER=tencent` 做服务端区域解析；样例区域解析会被运行时拒绝。
- pre/prod 后端通过 `GOODS_COMM_PLATFORM_NOTIFY_PROVIDER=wechat` 投递微信订阅消息；mock 平台通知会被运行时拒绝。
- pre/prod 后端通过 `GOODS_COMM_ALERT_PROVIDER=webhook` 将平台通知失败和通知重试失败外发到告警系统；`/health/ready` 会检查 Webhook URL、HTTPS 和 token 配置，`smoke:deployed:*` 会断言真实环境不是关闭态。
- pre/prod 后端通过 `GOODS_COMM_ACCESS_LOG_ENABLED=true` 写 stdout JSON 访问日志；日志只记录 trace id、HTTP 方法、归一化路由、状态码、耗时、CORS 和限流摘要，不记录 query、请求头、请求体或动态业务 ID，真实部署还需把云侧日志采集和保留策略配好。
- pre/prod 后端通过 `GOODS_COMM_OPS_ACCOUNTS` 和 `GOODS_COMM_OPS_SESSION_SECRET` 签发运营控制台短期会话；账号角色至少应覆盖 `moderation`、`support`、`notifications`、`telemetry`、`risk`；共享审核密钥仍保留给微信回调和内部任务。`GOODS_COMM_OPS_LOGIN_MAX_FAILURES`、`GOODS_COMM_OPS_LOGIN_WINDOW_MS`、`GOODS_COMM_OPS_LOGIN_LOCK_MS` 已提供账号级失败登录锁定；`GOODS_COMM_RATE_LIMIT_MAX_REQUESTS` / `GOODS_COMM_RATE_LIMIT_WINDOW_MS` 已提供后端进程内 IP 级基础限流；`GOODS_COMM_ROUTE_RATE_LIMIT_MAX_REQUESTS` / `GOODS_COMM_ROUTE_RATE_LIMIT_WINDOW_MS` 已提供接口级配额；`GOODS_COMM_USER_RATE_LIMIT_MAX_REQUESTS` / `GOODS_COMM_USER_RATE_LIMIT_WINDOW_MS` 已提供认证主体写请求配额；`GOODS_COMM_TRUSTED_PROXY_IPS` 会限制只有可信代理才能提供 `x-forwarded-for` 客户端地址。真实部署还需在云网关 / WAF 补更稳定的边缘和分布式限流策略，并把实际 CloudBase / CDN / 负载均衡出口 IP 或网段写入 `.env.pre.local` / `.env.prod.local`。
- 数据库先使用 `backend/db/schema.sql` 固化 schema，`backend/src/postgres-state-store.mjs` 已接规范化表；pre/prod 后端默认 `GOODS_COMM_POSTGRES_AUTO_SCHEMA=false`，真实连接串后续替换占位值后必须先执行显式迁移，再在真实库上补跑连接级主链路 smoke。
- 对象存储已提供 COS adapter，真实部署时替换 `.env.pre/.env.prod` 中的占位 COS 凭据。
- 区域解析已提供 Tencent Maps adapter，当前 `.env.dev/test/pre/prod` 的 `GOODS_COMM_MAP_REGION_DATASET` 已是后端可解析的非空 JSON 数组；真实部署时仍要替换 `.env.pre/.env.prod` 中的腾讯地图 Key，并把占位网格替换为正式社区 / 街道网格数据，例如每项包含 `adcode` 或 `streetName`，以及 `communityId` 或 `streetId`。
- prod 到 pre 同步脚本已存在，支持手动执行和自动定时执行；真实连接串和 PostgreSQL 工具缺失时只跑 plan，不执行破坏性同步；同步后可选择跑 pre health smoke 和 pre 主链路 smoke，确保预上线数据库刷新后仍能验证发布、交易和售卖主流程。
