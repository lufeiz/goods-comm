# goods-comm 生产整改矩阵

生成日期：2026-06-01
来源报告：

- `docs/first-principles-objective-assessment-20260531.md`
- `docs/first-principles-objective-assessment-20260601.md`
- `docs/deployment-readiness-audit.md`
- `docs/deployment-readiness-audit-strict.md`

当前审计快照：

| 审计 | 当前结果 | 说明 |
| --- | --- | --- |
| 普通生产审计 | `BLOCKED (48 blockers, 9 warnings)` | 仍可用于开发和发布候选证据，不是生产放行口径。 |
| 严格生产审计 | `BLOCKED (50 blockers, 8 warnings)` | 真实上线前 gate；会把 deployed main-flow smoke 输入缺失升级为 blocker。 |

## 1. 整体判断

当前项目已经具备生产化骨架：四环境、BFF、Node 后端、PostgreSQL schema、对象存储抽象、平台登录抽象、内容审核、运营控制台、prod-to-pre 同步、部署脚本、发布门禁和多类 smoke。

剩余问题分成三类：

| 类型 | 判断 | 处理方式 |
| --- | --- | --- |
| 真实外部资源缺失 | 阻塞生产上线，但不阻塞工程开发 | 用占位值继续开发；真实部署前补 `.env.*.local`、云资源和 CI Secret。 |
| 工程债务 | 不阻塞试点，但会影响长期迭代 | 按业务域拆分大模块，补单元/契约/数据库集成测试。 |
| 商业验证缺失 | 代码无法单独证明 | 跑真实 pre 后做封闭社区/园区试点，用数据判断是否继续投入。 |

## 2. 逐项整改方案

| 问题 | 生产风险 | 解决方案 | 当前状态 | 验收证据 |
| --- | --- | --- | --- | --- |
| pre/prod 真实 API 缺失 | deployed smoke 无法证明真实后端可用 | 配置 `VITE_API_BASE_URL` / `GOODS_COMM_SMOKE_API_BASE_URL` 为真实 HTTPS API，并加入微信/支付宝合法域名 | 未完成，当前仍为 blocker | `npm run smoke:deployed:pre`、`npm run smoke:deployed:pre:main` 通过 |
| 真实数据库缺失 | 无法证明用户、商品、交易、通知、审计可持久化 | 按 `docs/database-provisioning-runbook.md` 为 dev/test/pre/prod 建独立 PostgreSQL/TencentDB；先用 `GOODS_COMM_DATABASE_ADMIN_URL` 创建应用角色和目标库，再用 `GOODS_COMM_DATABASE_URL` 跑 schema 迁移、部署后端和 deployed smoke | 开通脚本、schema、权限边界、runbook 和 release-strict 可选数据库开通已接入，真实实例未接 | `npm run db:provision:pre`、`npm run db:migrate:pre`、`/health/ready`、deployed main-flow smoke |
| pre/prod 数据同步未真实运行 | 预上线不能使用接近生产的数据回归 | 使用 `sync:prod-to-pre:plan` / `sync:prod-to-pre` / GitHub workflow 定时同步；同步后脱敏并跑 pre smoke | 脚本已完成，真实数据库账号未接 | `npm run sync:prod-to-pre` 成功，审计 JSONL 无生产 dump 残留 |
| COS/CDN 缺真实值 | 图片上传和公开访问无法生产验证 | 配置 COS bucket、secret、CDN base URL；pre/prod 禁止 local object store | 适配器和校验已有，真实值未接 | deployed main-flow smoke 覆盖上传、发布、公开商品脱敏 |
| 腾讯地图 Key 与社区网格缺真实值 | LBS 匹配无法证明可信 | 使用服务端腾讯地图逆地址解析 + 正式社区/街道网格数据；客户端只做预校验 | 代码路径已完成，占位网格未替换 | `smoke:location-permissions`、deployed main-flow smoke |
| 平台身份凭据缺失 | 微信/支付宝 code 无法换真实 openid/user_id | 配置微信 AppID/AppSecret、支付宝 AppID/private key；pre/prod 禁止 demo login | 适配器已完成，真实凭据未接 | `smoke:platform-auth` + deployed login smoke |
| session/ops secret 缺真实值 | token、运营登录、审计身份不可上线 | 为 pre/prod 配置独立强随机 `GOODS_COMM_SESSION_SECRET`、`GOODS_COMM_OPS_SESSION_SECRET`、`GOODS_COMM_OPS_ACCOUNTS` | 模板和检查已有，真实值未接 | `env:check:pre/prod`、`smoke:ops-auth`、deployed smoke |
| 内容审核密钥和回调缺失 | 违规商品可能公开，异步图片审核无法闭环 | 配置微信内容安全和 `GOODS_COMM_MODERATION_WEBHOOK_SECRET`；发布默认走待审/审核状态 | 代码路径已完成，真实密钥未接 | `smoke:storage-content`、deployed publish smoke |
| 微信订阅消息模板缺失 | 交易通知只能本地/mock，真实用户无法收到状态变化 | 配置模板 ID 和字段映射；失败进入 outbox，可重试和告警 | 适配器和 outbox 已有，模板未接 | `smoke:platform-notifier`、ops notification retry |
| 告警 Webhook 缺真实值 | 生产通知失败、重试失败不能触达值班系统 | 配置 HTTPS webhook URL/token；pre/prod `/health/ready` 校验 | 适配器已有，真实值未接 | `smoke:ops-alerts`、deployed health smoke |
| 云部署工具链缺失 | 后端无法实际部署到微信/腾讯云 | 按 `docs/cloud-deployment-runbook.md` 优先 CloudBase/tcb；不可用时 docker + tccli Tencent fallback；CI 配置 `TENCENTCLOUD_SECRET_ID/KEY`，使用 release-strict workflow 先跑 strict gate、按需开通数据库、再部署后端、跑 deployed smoke、最后部署前端 | 部署脚本、workflow、runbook 和执行保护已有；当前本机和 CI Secret 未就绪 | `deploy:backend:pre` 成功 + `smoke:deployed:pre` / `smoke:deployed:pre:main` 通过 |
| deployed smoke 输入缺失 | 上线后主链路无法验收 | 配置 `.env.smoke.pre.local` / `.env.smoke.prod.local` 或 GitHub multi-line secrets，包含一次性 seller/buyer code、坐标、已审核测试图；上线前先跑 `release:inputs -- --check-only` 汇总缺口 | 模板、自动加载和发布输入检查器已完成；`release-strict.yml` 已在 strict gate 前执行输入束检查并上传发布输入报告；真实输入未接 | `release:inputs -- --check-only`、`audit:production-readiness:strict-check` 无 deployed smoke blocker |
| GitHub workflow-aware preflight | workflow 文件变更时需要证明 token 具备 `workflow` scope；Actions 运行时弃用告警会影响后续 CI 稳定性 | 保持 `gh` auth 可用；失效时恢复 `gh auth` 或依赖 `git push --dry-run` fallback；workflow 文件变更时优先确保 `workflow` scope；CI、strict release 和 prod-to-pre sync workflow 使用 `actions/checkout@v5` / `actions/setup-node@v5` 的 Node 24 runtime，并保留 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` 兜底 | workflow smoke 已固化 Node 24 Actions runtime tag 和 opt-in；普通生产审计已记录 workflow-aware push preflight scope 通过，`gh` auth 失效时会退回 warning | `npm run smoke:workflows`、`npm run github:push:preflight` 通过 |
| README workflow 工具链描述旧 | 部署人员可能误以为还要安装 PostgreSQL client | 文档统一为“数据库迁移/同步使用项目依赖 `pg`，strict workflow 只安装 CloudBase CLI 和 tccli” | 本轮修正 | `npm run smoke:workflows` 和文档检查 |
| LBS 可信度天然风险 | 恶意用户可能伪造位置或频繁跨区 | 服务端重算区域；记录位置审计；新增位置风险事件；后续引入设备/账号/频率策略和人工复核 | 基础审计已有，真实风控策略待试点数据校准 | location risk ops 查询与复核记录 |
| 线下撮合不等于完整电商 | 无支付、担保、退款、资金风控 | 产品定位限定为社区线下自提；如要做平台交易，再新增支付、担保、退款和财务对账域 | 当前不做资金闭环 | 产品说明和试点指标不以 GMV 误导 |
| 商业冷启动未验证 | 代码好不代表社区供需成立 | 单社区/园区/校园封闭试点，记录供给、转化、确认率、完成率、举报率、7 日留存 | 未开始 | 试点数据报表 |
| 核心模块过大 | 后续功能和 bugfix 成本升高 | 拆 `src/bff/handler.js`、`src/services/goods.js`、`backend/src/server.mjs`、`postgres-state-store` | 已先把 PostgreSQL store 的 schema baseline、表/列要求、row limit、advisory lock 和 auto schema 保护拆到 `backend/src/postgres-state-store-config.mjs`；BFF、goods service、HTTP server 仍待拆 | 拆分 PR 后 smoke/verify 全绿 |
| 测试偏 smoke | 回归定位慢，覆盖率不可见 | 保留 smoke，补领域单测、BFF 契约测试、PostgreSQL 集成测试、页面 E2E、类型/schema 校验 | 已新增 `npm test`，覆盖距离、交易资格、定位缓存/精度/最终 GPS 判断、BFF 登录/发布/交易/评价/幂等契约，以及 PostgreSQL 规范化行往返后的登录、定位展示、发布、售卖、评价和幂等持久化契约；后续继续补真实 PostgreSQL 实例集成测试 | `npm test`、`npm run verify:release:quick -- --skip-http-backend` 通过 |
| PostgreSQL snapshot rewrite 债务 | 数据规模和并发增加后风险上升 | 短期用 row limit + advisory lock；中期按聚合根改增量 SQL repository | 桥接实现已有保护，未增量化 | 数据库集成测试 + 压测 + row count 监控 |
| 云侧日志/WAF/分布式限流缺失 | 单进程限流和 stdout 日志不足以抗公网风险 | 云网关/WAF 配置限流、日志采集、保留策略、告警值班 | 应用层已有基础能力，云侧未接 | 真实云控制台配置和 deployed health 证据 |
| H5 公开访问身份体系 | H5 dev/test 演示登录不能用于正式公网 | 若 H5 对公网开放，必须接 OAuth/SSO，并加入合法 Origin；小程序端继续使用平台 code | 当前 H5 适合联调，不适合正式身份 | H5 E2E + OAuth/SSO 验收 |

## 3. 主链路交付验收口径

登录、定位、显示、发布和售卖不能只靠单点脚本证明。生产交付前必须按下面顺序验收：

| 主链路 | 最低验收命令 | 生产验收命令 |
| --- | --- | --- |
| 登录和协议 | `npm run smoke:platform-auth`、`npm run smoke:main-flow-contract` | `npm run smoke:deployed:pre:main` |
| 定位和显示 | `npm test`、`npm run smoke:location-permissions`、`npm run smoke:h5:render` | `npm run smoke:deployed:pre` + 真机小程序定位验证 |
| 发布和图片 | `npm run smoke:storage-content`、`npm run smoke:bff`、`npm run smoke:backend` | `npm run smoke:deployed:pre:main` |
| 售卖和交易 | `npm run smoke:main-flow-contract`、`npm run smoke:backend`、`npm run smoke:deployed:local-main` | `npm run smoke:deployed:pre:main` |
| 部署和回滚准备 | `npm run verify:release` | `npm run verify:release:strict` 或 `release-strict.yml` |

生产放行必须满足：

1. 普通审计和严格审计无 blocker。
2. pre 后端部署成功，pre deployed health 和 main-flow smoke 通过。
3. 前端 H5 / 微信 / 支付宝产物指向同一轮已验证后端。
4. prod 发布前有 prod-to-pre 同步和 pre 回归证据。
5. prod 主链路 smoke 只有在显式允许生产写入时运行，并使用专用测试账号和可清理测试数据。

## 4. 执行优先级

| 优先级 | 工作 | 目的 |
| --- | --- | --- |
| P0 | 修正文档口径、刷新普通/严格审计、保持 gate 可信 | 防止生产部署人员按旧信息操作。 |
| P1 | 补真实 pre 环境和 deployed smoke 输入 | 先证明技术闭环。 |
| P2 | 跑通 pre 数据库迁移、后端部署、deployed health/main-flow smoke | 证明登录、定位、发布、售卖主链路在真实环境无阻塞。 |
| P3 | 配置 prod-to-pre 同步和封闭试点数据指标 | 证明预上线验收和商业假设。 |
| P4 | 拆核心模块、补测试金字塔、改 PostgreSQL 增量写入 | 支撑长期生产迭代。 |
