# 邻里旧货

微信、支付宝平台通用的社区二手交易小程序。当前工程使用 `uni-app + Vue 3`，一套代码可编译到 `mp-weixin` 和 `mp-alipay`。

## 已实现

- 附近二手物品列表、分类筛选、关键词搜索
- 发布物品，选择同社区或同街道交易范围
- 获取当前位置并按 LBS 判断是否满足交易要求
- 详情页发起交易前强制校验位置
- 我的交易意向列表
- 内部运营控制台，输入运营密钥后处理待审商品、举报、争议、通知重试和用户封禁 / 解封
- 端侧失败遥测，上报登录、定位、发布、交易等关键错误并供运营排障
- 用户协议 / 隐私政策页面，登录、发布、交易和举报前校验协议同意状态，pre/prod 登录会服务端持久化协议审计字段
- 微信、支付宝定位权限配置和平台封装
- H5 浏览器定位兜底和 dev/test 演示登录态
- 纯领域层资格校验，便于后端/云函数复用
- BFF / 云函数契约处理器和 Fetch 适配器，覆盖登录、区域解析、发布、交易、举报、站内通知、平台通知和账号注销

## 运行

```bash
npm install
npm run dev:weixin
npm run dev:alipay
```

产物会输出到 `dist/dev/mp-weixin` 或 `dist/dev/mp-alipay`，再分别用微信开发者工具、支付宝小程序开发者工具打开。

如需连接真实 BFF / 云函数网关，在构建或开发前设置：

```bash
VITE_API_BASE_URL=https://api.example.com npm run dev:weixin
```

未配置 `VITE_API_BASE_URL` 时，端侧会回落本地演示存储和样例区域数据。

四套环境已经提供占位配置：`.env.dev`、`.env.test`、`.env.pre`、`.env.prod`。test/pre/prod 应使用 HTTPS API 域名；pre 与 prod 拓扑保持一致，但连接两套不同数据库和对象存储。

```bash
npm run env:check
npm run build:weixin:pre
npm run build:alipay:pre
npm run backend:start:pre
```

环境矩阵见 `docs/environment-matrix.md`，部署缺失信息见 `docs/deployment-missing-info.md`。

上线前审计会汇总本机 CLI、pre/prod 真实配置、构建产物、部署 smoke 前置项和 prod 到 pre 同步条件：

```bash
npm run audit:production-readiness
npm run audit:production-readiness -- --check-only
```

审计报告输出到 `docs/deployment-readiness-audit.md`，同时输出机器可读的 `docs/deployment-readiness-audit.json`，供 CI、发布看板或部署脚本逐项消费 blocker。 如需在本机放真实密钥，可从 `.env.pre.local.example` / `.env.prod.local.example` 复制出 `.env.pre.local` / `.env.prod.local` 并填入真实值；这些本地文件会被脚本读取，并已被 `.gitignore` 忽略。部署后 health / main-flow smoke 的一次性输入可从 `.env.smoke.pre.example` / `.env.smoke.prod.example` 复制到 `.env.smoke.pre.local` / `.env.smoke.prod.local` 后加载，模板完整性由 `npm run smoke:deployed-input-templates` 校验。

prod 到 pre 数据同步同时支持手动和自动定时入口；真实执行前必须替换数据库连接串并准备 PostgreSQL 工具：

```bash
npm run sync:prod-to-pre:plan
GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre npm run sync:prod-to-pre
GOODS_COMM_SYNC_AUTO_ENABLED=true npm run sync:prod-to-pre:auto
```

也可以使用 `.github/workflows/prod-to-pre-sync.yml`：

- 手动触发 `plan`：只输出同步计划。
- 手动触发 `execute`：需要输入 `confirm_sync=sync-prod-to-pre`，并依赖 `GOODS_COMM_PRE_ENV_LOCAL` / `GOODS_COMM_PROD_ENV_LOCAL` 两个多行 Secret 提供真实数据库连接。
- 定时触发：每天低峰执行；只有仓库变量 `GOODS_COMM_SYNC_AUTO_ENABLED=true` 时才会真正执行自动同步，否则只跳过并保留工作流记录。

该工作流会在 runner 临时目录写 dump、lock 和审计日志，只上传脱敏后的同步审计日志，不上传生产 dump。

后端部署执行会在发布新后端前默认先应用对应环境数据库 schema，避免新版本启动后才发现缺表：

```bash
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre GOODS_COMM_DEPLOY_CONFIRM=deploy-pre npm run deploy:backend:pre
```

只有确认数据库已经由同一版本迁移过时，才使用 `--skip-db-migrate` 或 `GOODS_COMM_DEPLOY_SKIP_DB_MIGRATE=true` 跳过这一步。

纯逻辑烟测不依赖小程序运行时：

```bash
npm run smoke
npm run smoke:main-flow-contract
npm run smoke:bff
npm run smoke:bff:fetch
npm run smoke:backend
npm run smoke:platform-notifier
```

发布门禁把语法检查、环境检查、smoke、构建、迁移 / 部署 / 同步 plan 和生产审计串成同一入口；CI 使用 full profile，本地快速回归可用 quick profile：

```bash
npm run verify:release:quick
npm run verify:release
npm run verify:release:strict
```

`verify:release:strict` 会执行 `audit:production-readiness -- --check-only`，只有 pre/prod 真实云资源和密钥补齐后才会通过。

GitHub 推送前先跑 release gate，再确认本地 `main`、`origin` 和 GitHub token 权限：

```bash
npm run verify:release:quick -- --skip-http-backend
npm run github:push:preflight
git push origin main
```

`github:push:preflight` 会检查 `origin=https://github.com/lufeiz/goods-comm`、`main` 跟踪 `origin/main`、工作区干净，以及 GitHub CLI token 具备 `repo` 和 `workflow` scope，避免 `.github/workflows/*.yml` 因权限不足推送失败。

真实部署后 smoke 可先加载对应环境的一次性输入模板：

```bash
cp .env.smoke.pre.example .env.smoke.pre.local
# replace login codes, coordinates, API URL and approved image URL
set -a; source .env.smoke.pre.local; set +a
npm run smoke:deployed:pre
npm run smoke:deployed:pre:main
```

生产主链路 smoke 会写真实数据，`.env.smoke.prod.example` 默认保持 `GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=false`，必须在明确批准对应生产 smoke 运行时才改为 `true`。

GitHub Actions 中有两个门禁：

- `.github/workflows/ci.yml`：PR / 主干日常门禁，运行 `npm run verify:release`，会生成生产审计但不因占位 pre/prod 阻断普通开发。
- `.github/workflows/release-strict.yml`：真实上线前手动门禁，先在 runner 安装 `postgresql-client`、CloudBase CLI 和 Tencent `tccli`，再运行 `npm run verify:release:strict`；可选 `run_backend_deploy=true` 在通过后先迁移目标数据库并部署后端，再执行 `smoke:deployed:*`。它读取 `GOODS_COMM_PRE_ENV_LOCAL` / `GOODS_COMM_PROD_ENV_LOCAL` 两个多行 Secret 生成 `.env.pre.local` / `.env.prod.local`，读取 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY` 和可选 `TENCENTCLOUD_SESSION_TOKEN` 执行非交互式 CloudBase / 腾讯云部署，同时读取 `GOODS_COMM_SMOKE_SELLER_CODE`、`GOODS_COMM_SMOKE_BUYER_CODE`、`GOODS_COMM_SMOKE_LATITUDE`、`GOODS_COMM_SMOKE_LONGITUDE` 和可选 `GOODS_COMM_SMOKE_APPROVED_IMAGE_URL` 作为部署后主链路 smoke 输入；生产后端部署必须显式开启 `allow_prod_deploy=true`，生产主链路 smoke 必须显式开启 `allow_prod_mutation=true`，避免误发生产或误写生产测试数据。

## 关键目录

- `src/domain/eligibility.js`：同社区/同街道交易资格判断
- `src/utils/geo.js`：GCJ-02 坐标距离计算
- `src/services/location.js`：跨端定位、区域解析、交易校验编排
- `src/services/goods.js`：本地演示商品和交易意向存储
- `src/services/reports.js`：举报提交和本地演示处理
- `src/bff/handler.js`：BFF / 云函数核心契约处理器
- `src/bff/fetch-adapter.js`：Fetch Runtime / 边缘函数适配器
- `src/pages/home`：附近集市
- `src/pages/publish`：发布物品
- `src/pages/detail`：详情与交易校验
- `docs/architecture.md`：正式上线架构与后端接口建议
- `docs/environment-matrix.md`：dev/test/pre/prod 四套环境与数据库同步策略
- `docs/deployment-missing-info.md`：真实部署仍缺少的信息和占位值

## 正式上线注意

当前演示用本地样例数据解析社区/街道。生产环境应接入服务端或云函数，由后端调用地图服务做逆地理编码，并在发布和发起交易时服务端重算区域归属、距离和资格，避免客户端伪造位置。
