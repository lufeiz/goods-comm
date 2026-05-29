# goods-comm 生产化交付收口状态

生成时间：2026-05-28 23:42 CST

## 收口规则

用户新增约束：2026-05-28 23:40 后，只梳理已完成和未完成任务，不再开启新的开发任务和规划。当前正在执行的“运营封禁 / 解封风控闭环”已在 23:40 前后完成实现，并已跑完验证门禁。

## 当前结论

当前项目已经从单纯小程序 MVP 推进到“端侧生产化边界 + BFF 契约 + Node HTTP 后端 + PostgreSQL 规范化表结构 + 四环境配置 + 发布门禁 + 生产审计”的状态。登录、定位、商品发布、售卖状态机、举报、争议、评价、协议审计、运营处理、用户封禁 / 解封等核心链路都有代码实现和 smoke 覆盖。

但项目还不能宣称真实生产上线完成。最新生产就绪审计仍为：

```text
Production readiness audit: BLOCKED (46 blockers, 9 warnings)
```

阻塞原因不是当前代码主链路失败，而是缺真实云资源、真实密钥、真实数据库 / 对象存储 / 地图服务 / 平台账号和部署工具链。2026-05-29 续做后，`GOODS_COMM_MAP_REGION_DATASET` 已从数据集标签改为后端可解析的 JSON 数组占位，pre/prod 拓扑一致性仍通过；正式上线仍要替换为真实社区 / 街道网格数据。

2026-05-29 续做后，当前项目已初始化 Git 仓库，源码、占位环境配置、后端、数据库 DDL、脚本、文档和 CI workflow 已纳入首个版本快照；`node_modules/`、`dist/`、`.env.*.local`、`.DS_Store` 等依赖、产物和本地敏感覆盖文件已通过 `.gitignore` 排除。

## 已完成任务

### 1. 架构与报告闭环

- 已输出并持续更新两份核心报告：`docs/first-principles-evaluation.md`、`docs/project-analysis.md`。
- 已把逐项生产化方案沉淀到 `docs/production-hardening-plan.md`。
- 已把接口契约沉淀到 `docs/api-contract.md`。
- 已把数据库边界沉淀到 `docs/database-schema.md`。
- 已把部署缺失项沉淀到 `docs/deployment-missing-info.md`。
- 已生成并刷新生产就绪审计：`docs/deployment-readiness-audit.md`。

### 2. 登录与账号体系

- 端侧登录已从本地用户缓存升级为 session/token 模型。
- BFF / 后端已签发随机 session token，只持久化 HMAC token hash。
- 已支持 `/auth/login`、`/auth/logout`、`/auth/delete-account`。
- 账号注销会吊销 session、下架活跃商品、取消活跃交易。
- pre/prod 缺真实 session secret 时会拒绝签发 session。
- 登录前协议确认已从端侧状态扩展到服务端审计字段：协议版本、确认时间、来源落入用户记录。

### 3. 定位、展示与 LBS

- 定位服务已覆盖权限拒绝、系统定位关闭、超时、网络异常、取消选择、精度不足、缓存过期等分支。
- 发布和交易不再信任客户端传入的社区 / 街道字段，服务端会重算区域归属。
- dev/test 可用样例区域；pre/prod 禁止 mock 区域数据，要求真实腾讯地图配置。
- 商品列表和详情会隐藏卖家精确经纬度和用户级联系码。
- 2026-05-29 续做后，商品列表展示也会复用交易资格规则：本地和远端请求都必须带当前位置，端侧无有效坐标时不请求远端 `/items`，Node HTTP 后端用服务端地图解析当前位置，BFF 只返回同社区 / 同街道和半径范围内的在线商品。

### 4. 商品发布与图片

- 发布前强制登录、协议确认、社区 / 街道定位、至少 1 张图片。
- 商品发布支持远端 `/uploads/items` 上传边界。
- Node HTTP 后端支持 multipart 图片落盘或 COS 适配边界。
- 商品文本审核、本地违禁词拦截、重复发布拦截已覆盖。
- 图片审核回调契约 `/moderation/media/:traceId/review` 已补。

### 5. 售卖与交易闭环

- 商品状态已覆盖 `pending_review`、`online`、`reserved`、`sold`、`removed`。
- 交易状态已覆盖 `pending_seller_confirm`、`pending_meetup`、`completed`、`cancelled`、`disputed`。
- 卖家确认后生成一次性联系码，完成 / 取消 / 争议后清空。
- 完成交易后支持买卖双方评价，并拒绝重复评价。
- 写请求已补 `Idempotency-Key`，避免重复发布、重复状态流转、重复通知。
- 争议工单支持客服裁决：释放商品、确认完成、下架商品。

### 6. 举报、运营与风控

- 举报接口已支持对象校验、原因校验、禁止举报自己商品、重复举报幂等。
- 高风险举报会预下架商品并冻结活跃交易。
- 运营接口已支持登录、待处理队列、举报处理、争议裁决、通知重试、操作审计查询。
- 运营账号已从共享密钥推进到短期会话和角色校验。
- 2026-05-29 续做后，运营控制台通知投递 fallback 的作用域异常已修复：`fetchNotificationDeliveries` 失败时会使用外层 `moderationQueue?.notificationDeliveries` 回退，不再引用块级作用域外的 `queue`。
- 2026-05-29 续做后，`smoke:pages` 增加了运营台通知 fallback 契约，禁止再出现 `Array.isArray(queue.notificationDeliveries)` 这类作用域外引用。
- 新增用户封禁 / 解封闭环：
  - `/ops/users`
  - `/ops/users/:id/status`
  - `risk` 角色
  - 封禁吊销 session
  - 封禁下架活跃发布
  - 封禁冻结相关活跃交易并进入争议
  - 写入 `moderation_events` 和 `ops_audit_events`

### 7. 后端、数据库与环境

- 已新增 `backend/` Node HTTP 后端。
- 已新增文件状态 store 和 PostgreSQL 规范化状态 store。
- 2026-05-29 续做后，文件状态 store 的普通事务失败回滚语义已对齐 PostgreSQL：业务 callback 抛错时不再保存部分状态，并由 `smoke:backend:env` 覆盖。
- 2026-05-29 续做后，发布审核拒绝不再依赖文件 store 失败落盘副作用；BFF 会显式标记 `commitStateOnError`，让 file/PostgreSQL store 提交审核拒绝事件后继续返回错误。
- 2026-05-29 续做后，带幂等键的审核拒绝会记录为 `committed_error` 并回放首次错误，弱网重试不会重复追加 `moderation_events`。
- 2026-05-29 续做后，PostgreSQL readiness 从“仅检查表存在”升级为“检查规范化表和关键列”，pre/prod 迁移漏列会提前返回 `schema is outdated`，避免写请求时才暴露旧库问题。
- 已新增 PostgreSQL / TencentDB DDL：`backend/db/schema.sql`。
- 已新增 dev/test/pre/prod 四套 `.env.*` 占位配置。
- pre/prod 默认要求 PostgreSQL store，阻止文件 store 进入受保护环境。
- pre/prod 数据库要求不同连接串；审计能识别 pre/prod 隔离。
- 已提供 prod 到 pre 手动 / 自动同步脚本和脱敏 SQL。

### 8. 部署与交付门禁

- 已生成后端部署产物 `dist/backend`。
- 2026-05-29 续做后，后端构建会生成 `dist/backend/package-lock.json`；Dockerfile 会在容器构建时通过 `npm ci --omit=dev` 安装锁定后的生产依赖，并通过 `smoke:backend:artifact` 检查 server、BFF、PostgreSQL store、schema、Dockerfile、启动脚本、lockfile 和生产依赖安装步骤。
- 2026-05-29 续做后，真实后端部署脚本会在迁移数据库和推送后端前强制执行 `smoke:backend:artifact`，避免绕过 release gate 直接部署未验证 artifact。
- 2026-05-29 续做后，后端新增 `GOODS_COMM_MAX_REQUEST_BYTES` 请求体上限，JSON / multipart 解析前会拒绝超限请求并返回 `413 PAYLOAD_TOO_LARGE`，避免异常请求把运行时内存打满；pre/prod 也会把该变量纳入拓扑一致性校验。
- 2026-05-29 续做后，运营后台登录新增账号级失败窗口和短期锁定：`GOODS_COMM_OPS_LOGIN_MAX_FAILURES`、`GOODS_COMM_OPS_LOGIN_WINDOW_MS`、`GOODS_COMM_OPS_LOGIN_LOCK_MS` 控制失败次数、统计窗口和锁定时长；后端返回 `429 TOO_MANY_REQUESTS`，pre/prod 拓扑一致性也会检查这些配置。
- 2026-05-29 续做后，后端新增 `GOODS_COMM_RATE_LIMIT_MAX_REQUESTS` / `GOODS_COMM_RATE_LIMIT_WINDOW_MS` 客户端基础限流，进入业务 handler 前按客户端 IP 拦截超频请求并返回 `429 TOO_MANY_REQUESTS`；`/health` / `/health/ready` 保持可探测，pre/prod 拓扑一致性也会检查这些配置。
- 2026-05-29 续做后，后端新增 `GOODS_COMM_TRUSTED_PROXY_IPS`：只有直连来源命中可信代理 IP / CIDR 白名单时，才读取 `x-forwarded-for` 作为限流客户端标识；否则忽略该头，避免公网客户端伪造来源绕过基础限流。
- 2026-05-29 续做后，后端部署 plan 的缺失前置项已与生产审计口径对齐：会列出真实 HTTPS API、CORS Origin、数据库、COS/CDN、地图、内容安全、session、运营账号、可信代理、平台通知和平台登录等运行时配置，避免真实部署前遗漏运营后台或代理安全配置。
- 2026-05-29 续做后，真实后端部署脚本在 deploy execute 成功后会默认执行 deployed health smoke；如需把写入型主链路验证绑定到同一次部署命令，可用 `--run-main-smoke` / `GOODS_COMM_DEPLOY_RUN_MAIN_SMOKE=true`，脚本会提前校验 seller/buyer code、经纬度和 prod 写入 opt-in。
- 2026-05-29 续做后，`scripts/deployed-health-smoke.mjs` 支持 `--attempts` / `--interval-ms`，真实部署脚本默认用 12 次、10 秒间隔等待 `/health` 和 `/health/ready`，避免云托管冷启动或滚动发布延迟导致刚部署即误判失败。
- 2026-05-29 续做后，prod 到 pre 同步脚本的同步后 pre health smoke 也接入同一套重试等待：默认 12 次、10 秒间隔，可用 `GOODS_COMM_SYNC_HEALTH_ATTEMPTS` / `GOODS_COMM_SYNC_HEALTH_INTERVAL_MS` 调整。
- 2026-05-29 续做后，后端 JSON、OPTIONS 和资产响应统一补充基础安全响应头：`x-content-type-options: nosniff`、`x-frame-options: DENY`、`referrer-policy: no-referrer`、`permissions-policy: geolocation=(), camera=(), microphone=()`；pre/prod 运行环境额外返回 HSTS。
- 已提供 CloudBase 配置、Dockerfile、腾讯云部署说明。
- 已新增发布候选门禁 `npm run verify:release`。
- 已新增快速门禁 `npm run verify:release:quick`。
- 已新增严格门禁 `npm run verify:release:strict`。
- 已新增 GitHub Actions CI 配置。

## 本轮最终验证

本轮已跑通：

```bash
npm run smoke
npm run smoke:bff
npm run smoke:bff:fetch
npm run smoke:postgres-store
npm run smoke:ops-auth
npm run smoke:backend
npm run build:backend
npm run smoke:backend:artifact
npm run build:h5
npm run build:weixin
npm run build:alipay
npm run verify:release:quick -- --skip-http-backend
npm run verify:release
```

说明：

- `smoke:backend` 和 `verify:release` 在沙箱内直接监听 `127.0.0.1` 会触发 `EPERM`，按权限流程授权后通过。
- `verify:release` full profile 已覆盖语法检查、环境检查、核心 smoke、真实 HTTP 后端 smoke、迁移 plan、部署 plan、prod-to-pre sync plan、dev/test/pre/prod 三端构建矩阵和生产就绪审计。
- 2026-05-29 续做后，`verify:release` / `verify:release:quick` 已接入 `scripts/artifact-smoke.mjs`，会在构建后断言 H5 / 微信 / 支付宝产物包含核心页面、tabBar、关键组件和 H5 页面 chunk。
- 2026-05-29 续做后，产物 smoke 进一步覆盖 H5 / 微信 / 支付宝四环境运行时配置，断言产物内嵌的 `VITE_APP_ENV` 和 `VITE_API_BASE_URL` 匹配对应 `.env.*`，降低 pre/prod 错包风险。
- 2026-05-29 续做后，新增 `npm run smoke:workflows`，并接入 `verify:release` / `verify:release:strict`，覆盖 CI release gate、strict 审计上传、部署后 smoke 强制、prod 显式确认和 prod-to-pre sync 不上传生产 dump 等发布工作流保护。
- 2026-05-29 续做后，新增 `npm run smoke:pages` 并接入 `verify:release` / `verify:release:strict`，静态校验页面注册、tabBar、页面跳转、模板事件处理器和登录 / 定位 / 发布 / 交易 / 运营 / 协议关键 service 接入。
- 2026-05-29 续做后，已用 Browser 打开本地 H5 构建产物 `http://127.0.0.1:4187/` 做渲染 QA：桌面首屏、搜索交互和 390x844 移动视口均能渲染核心内容，浏览器 console 无相关 error / warn；截图证据保存于 `/private/tmp/goods-comm-h5-qa/`，未写入仓库。
- 2026-05-29 续做后，prod-to-pre 同步新增 `GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true`，可在同步并脱敏后自动跑 pre 主链路 smoke；GitHub `prod-to-pre-sync` workflow 已增加 `run_pre_main_smoke` 输入和所需 smoke secret 透传。
- 2026-05-29 续做后，新增 `npm run smoke:deployed:local-health`，会启动本地 HTTP 后端并复用部署后 health smoke 脚本验证 `/health` 与 `/health/ready`；`verify:release` full profile 会在本地 HTTP 后端 smoke 后运行它。
- 2026-05-29 续做后，新增 `npm run smoke:deployed:local-main`，会启动本地 HTTP 后端并复用部署后主链路 smoke 脚本验证登录、定位、上传、发布、交易、卖家确认、完成售出、评价和退出登录；`verify:release` full profile 会在本地 HTTP 后端 smoke 后运行它。
- 2026-05-29 续做后，严格发布 workflow 已禁止“部署后端但关闭部署后 smoke”：启用 `run_backend_deploy=true` 时必须保持 `run_deployed_smoke=true`，否则 workflow 直接失败。
- 2026-05-29 续做后，`verify:release:strict` 会用 `--require-deployed-smoke-inputs` 把 `GOODS_COMM_SMOKE_SELLER_CODE`、`GOODS_COMM_SMOKE_BUYER_CODE`、`GOODS_COMM_SMOKE_LATITUDE`、`GOODS_COMM_SMOKE_LONGITUDE` 缺失从 warning 升级为 blocker。
- 2026-05-29 续做后，新增 `npm run audit:production-readiness:strict` / `strict-check`，并让 `.github/workflows/release-strict.yml` 上传 `docs/deployment-readiness-audit-strict.md` / `.json`，使 strict gate 的失败证据和上传报告保持同一口径。
- 2026-05-29 续做后，`npm run smoke:backend:env` 已覆盖文件状态 store 的普通事务失败回滚和 `commitStateOnError` 审计提交，避免本地 HTTP smoke 与 PostgreSQL 生产语义在失败写入上分叉。
- 2026-05-29 续做后，`npm run smoke:bff` 和 `npm run smoke:backend` 已覆盖“发布违禁商品返回 422、商品不落库、审核拒绝事件落库、同一幂等键重试不重复追加审核事件”的链路。
- 2026-05-29 续做后，`npm run smoke`、`npm run smoke:bff`、`npm run smoke:backend` 和 `npm run smoke:deployed:local-main` 已覆盖商品列表展示的 LBS 准入：无当前位置或超出同社区 / 同街道半径时不展示，当前位置可交易时才进入列表和主链路交易。
- 2026-05-29 续做后，`npm run smoke:ops-auth` 和 `npm run smoke:backend` 已覆盖运营登录失败锁定；`npm run smoke:backend` 已覆盖超限请求 `413 PAYLOAD_TOO_LARGE`、客户端基础限流 `429 TOO_MANY_REQUESTS`、不信任伪造 `x-forwarded-for`、可信代理 forwarded 客户端限流、JSON / OPTIONS / 资产响应安全头和 pre/prod HSTS；`npm run smoke:postgres-store` 已覆盖 PostgreSQL schema readiness 的缺表和缺列失败分支；`npm run smoke:backend:artifact` 已覆盖后端部署包完整性、artifact lockfile 和容器 `npm ci` 生产依赖安装步骤；`verify:release:quick -- --skip-http-backend` 84/84 通过。
- 2026-05-29 续做后，运营台通知投递 fallback 修复已通过 `node --check scripts/page-contract-smoke.mjs`、`npm run smoke:pages`、`npm run smoke:bff` 和 `npm run verify:release:quick -- --skip-http-backend` 验证；quick release gate 84/84 通过并重建 backend、H5、微信、支付宝默认产物。
- 2026-05-29 续做后，生产就绪审计的 Build artifacts 区域也会运行后端 artifact smoke，把后端部署包完整性和容器生产依赖安装步骤纳入权威审计报告。
- 最新生产就绪审计仍是 `BLOCKED (46 blockers, 9 warnings)`，严格审计仍是 `BLOCKED (48 blockers, 7 warnings)`；2026-05-29 续做后，区域网格配置格式阻塞已解除，并新增可信代理配置缺失项作为上线前真实环境输入，剩余阻塞仍来自真实云资源、密钥、工具链、可信代理 IP / 网段和部署后验证。

## 未完成任务

### 1. 真实云资源未补齐

- 缺真实 CloudBase / 腾讯云环境 ID。
- 缺真实腾讯云托管服务名或镜像仓库配置。
- 缺真实 HTTPS API 域名。
- 缺合法 H5 / 小程序业务域名。
- 缺云平台 CLI 登录态。

### 2. 真实数据库未执行

- 目前只有 DDL、PostgreSQL store、迁移 plan 和同步脚本。
- 未在真实 TencentDB / PostgreSQL 上执行 migration。
- 未在真实 pre/prod 数据库上跑主链路 smoke。
- 本机缺 `psql`、`pg_dump`、`pg_restore`。

### 3. 真实对象存储与 CDN 未接入

- 目前已有本地对象存储和 COS 适配边界。
- 缺真实 COS bucket、SecretId、SecretKey、CDN 域名。
- 缺真实图片审核回调配置。

### 4. 真实平台身份未接入

- 后端已有微信 `jscode2session` 和支付宝 OAuth 适配入口。
- `.env.*` 仍是占位 AppID、AppSecret、支付宝私钥。
- 未用真实平台 code 验证 pre/prod 登录。

### 5. 真实地图与社区网格未接入

- 后端已有腾讯地图解析边界。
- pre/prod 禁止 mock 区域数据。
- 缺真实腾讯地图 Key。
- 当前 `.env.*` 已提供可解析 JSON 数组占位，但仍缺正式社区 / 街道网格数据或自有区域库。

### 6. 平台通知与内容安全未实测

- 平台通知 outbox、失败重试和微信通知适配器已实现。
- 缺真实微信订阅消息模板 ID。
- 缺真实微信内容安全凭据和回调验证。
- 缺真实通知送达验证。

### 7. 生产合规材料未完成

- 端侧和服务端协议审计已补。
- 仍缺法务审核后的正式用户协议 / 隐私政策文本。
- 仍缺平台后台隐私配置、数据删除材料、合法域名备案材料。

### 8. 测试矩阵仍缺真机和页面自动化

- 当前 smoke 覆盖主链路、大量异常分支和静态页面契约。
- 已完成一次本地 H5 构建产物浏览器渲染 QA，但仍缺可纳入 CI 的浏览器 / 小程序渲染级页面 E2E。
- 仍缺微信 / 支付宝开发者工具自动导入验证。
- 仍缺真机定位权限矩阵。

## 当前可运转状态

在本地 / 占位环境下，项目可运行、可构建、可通过发布候选门禁。可交付的产物包括：

- H5 构建产物
- 微信小程序构建产物
- 支付宝小程序构建产物
- Node HTTP 后端产物
- 数据库 DDL
- 部署 plan
- prod-to-pre 同步 plan
- 生产就绪审计报告

不可宣称的状态：

- 不能宣称已经真实上线。
- 不能宣称已完成真实云数据库验证。
- 不能宣称已完成微信 / 支付宝真实平台登录验证。
- 不能宣称已完成真实地图、对象存储、内容安全和订阅消息验证。

## 交接判断

当前代码主链路已经达到“可本地验证、可构建、可部署前演练”的状态；真实生产上线仍取决于 `docs/deployment-missing-info.md` 中列出的外部资源和密钥补齐。
