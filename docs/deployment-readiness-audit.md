# goods-comm production readiness audit

Generated: 2026-05-31T11:51:51.677Z
Scope: pre, prod
Result: BLOCKED (50 blockers, 9 warnings)

This report is generated from `.env.*` plus optional `.env.*.local` overrides. It does not execute deployment, database migration, or production data sync.

Machine-readable JSON: `docs/deployment-readiness-audit.json`

## Summary

| Area | Status | Notes |
| --- | --- | --- |
| Tools | BLOCKED | 4 blockers, 2 warnings |
| Environments | BLOCKED | 2 environments checked |
| pre/prod isolation | WARN | 0 blockers, 2 warnings |
| Build artifacts | PASS | 0 blockers, 0 warnings |
| Deployed smoke | BLOCKED | 2 blockers, 3 warnings |

## Toolchain

| Tool | Required for | Status |
| --- | --- | --- |
| cloudbase/tcb | WeChat CloudBase deploy | missing |
| docker | Tencent fallback image build/push | missing |
| tccli | Tencent fallback deploy | missing |
| TENCENTCLOUD_SECRET_ID/KEY | non-interactive CloudBase/Tencent deploy | missing |
| psql | database migration and sync | missing |
| pg_dump | prod-to-pre export | missing |
| pg_restore | prod-to-pre restore | missing |
### Tool blockers

- psql is required to execute database migration locally
- pg_dump, pg_restore, and psql are required to execute prod-to-pre sync locally
- No backend deployment toolchain is currently executable: need cloudbase/tcb or docker+tccli
- TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY are required for non-interactive CloudBase/Tencent deployment in CI
### Tool warnings

- CloudBase deploy CLI is missing: install cloudbase or tcb if using WeChat CloudBase
- Tencent fallback deploy tools are incomplete: docker and tccli are both required
### Tool passes

- None

## Environment details

### pre

Local override: not present

### Blockers

- VITE_API_BASE_URL must be replaced with a real production value
- GOODS_COMM_ALLOWED_ORIGINS must be replaced with a real production value
- GOODS_COMM_DATABASE_URL must be replaced with a real production value
- GOODS_COMM_COS_BUCKET must be replaced with a real production value
- GOODS_COMM_COS_SECRET_ID must be replaced with a real production value
- GOODS_COMM_COS_SECRET_KEY must be replaced with a real production value
- GOODS_COMM_COS_BASE_URL must be replaced with a real production value
- GOODS_COMM_CDN_BASE_URL must be replaced with a real production value
- GOODS_COMM_TENCENT_MAP_KEY must be replaced with a real production value
- GOODS_COMM_MODERATION_WEBHOOK_SECRET must be replaced with a real production value
- GOODS_COMM_SESSION_SECRET must be replaced with a real production value
- GOODS_COMM_OPS_SESSION_SECRET must be replaced with a real production value
- GOODS_COMM_OPS_ACCOUNTS must be replaced with a real production value
- GOODS_COMM_TRUSTED_PROXY_IPS must be replaced with a real production value
- GOODS_COMM_ALERT_WEBHOOK_URL must be replaced with a real production value
- GOODS_COMM_ALERT_WEBHOOK_TOKEN must be replaced with a real production value
- GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS must be replaced with a real production value
- GOODS_COMM_WECHAT_APP_ID must be replaced with a real production value
- GOODS_COMM_WECHAT_APP_SECRET must be replaced with a real production value
- GOODS_COMM_ALIPAY_APP_ID must be replaced with a real production value
- GOODS_COMM_ALIPAY_PRIVATE_KEY must be replaced with a real production value
- No deploy path is ready; missing real GOODS_COMM_CLOUDBASE_ENV_ID, cloudbase/tcb CLI, real Tencent fallback service/image config, docker+tccli
### Warnings

- Placeholder-like values remain: VITE_API_BASE_URL, GOODS_COMM_CLOUDBASE_ENV_ID, GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE, GOODS_COMM_ALLOWED_ORIGINS, GOODS_COMM_PUBLIC_ASSET_BASE_URL, GOODS_COMM_TRUSTED_PROXY_IPS, GOODS_COMM_DATABASE_URL, GOODS_COMM_COS_BUCKET, GOODS_COMM_COS_SECRET_ID, GOODS_COMM_COS_SECRET_KEY, GOODS_COMM_COS_BASE_URL, GOODS_COMM_CDN_BASE_URL, GOODS_COMM_TENCENT_MAP_KEY, GOODS_COMM_MODERATION_WEBHOOK_SECRET, GOODS_COMM_SESSION_SECRET, GOODS_COMM_OPS_SESSION_SECRET, GOODS_COMM_OPS_ACCOUNTS, GOODS_COMM_ALERT_WEBHOOK_URL, GOODS_COMM_ALERT_WEBHOOK_TOKEN, GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS, GOODS_COMM_WECHAT_APP_ID, GOODS_COMM_WECHAT_APP_SECRET, GOODS_COMM_ALIPAY_APP_ID, GOODS_COMM_ALIPAY_PRIVATE_KEY
### Passes

- GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS limits PostgreSQL snapshot rewrites to 20000 rows
- GOODS_COMM_POSTGRES_ADVISORY_LOCK_KEY enables PostgreSQL advisory transaction locks for snapshot rewrites
- GOODS_COMM_POSTGRES_AUTO_SCHEMA is disabled for PostgreSQL store
- GOODS_COMM_OPS_LOGIN_MAX_FAILURES is 5
- GOODS_COMM_OPS_LOGIN_WINDOW_MS is 900000
- GOODS_COMM_OPS_LOGIN_LOCK_MS is 900000
- GOODS_COMM_ALERT_PROVIDER is webhook
- GOODS_COMM_ALERT_TIMEOUT_MS is 3000
- GOODS_COMM_ACCESS_LOG_ENABLED is true
- GOODS_COMM_RATE_LIMIT_MAX_REQUESTS is 300
- GOODS_COMM_RATE_LIMIT_WINDOW_MS is 60000
- GOODS_COMM_ROUTE_RATE_LIMIT_MAX_REQUESTS is 120
- GOODS_COMM_ROUTE_RATE_LIMIT_WINDOW_MS is 60000
- GOODS_COMM_USER_RATE_LIMIT_MAX_REQUESTS is 80
- GOODS_COMM_USER_RATE_LIMIT_WINDOW_MS is 60000
- GOODS_COMM_MAP_REGION_DATASET contains 2 configured region mappings

### prod

Local override: not present

### Blockers

- VITE_API_BASE_URL must be replaced with a real production value
- GOODS_COMM_ALLOWED_ORIGINS must be replaced with a real production value
- GOODS_COMM_DATABASE_URL must be replaced with a real production value
- GOODS_COMM_COS_BUCKET must be replaced with a real production value
- GOODS_COMM_COS_SECRET_ID must be replaced with a real production value
- GOODS_COMM_COS_SECRET_KEY must be replaced with a real production value
- GOODS_COMM_COS_BASE_URL must be replaced with a real production value
- GOODS_COMM_CDN_BASE_URL must be replaced with a real production value
- GOODS_COMM_TENCENT_MAP_KEY must be replaced with a real production value
- GOODS_COMM_MODERATION_WEBHOOK_SECRET must be replaced with a real production value
- GOODS_COMM_SESSION_SECRET must be replaced with a real production value
- GOODS_COMM_OPS_SESSION_SECRET must be replaced with a real production value
- GOODS_COMM_OPS_ACCOUNTS must be replaced with a real production value
- GOODS_COMM_TRUSTED_PROXY_IPS must be replaced with a real production value
- GOODS_COMM_ALERT_WEBHOOK_URL must be replaced with a real production value
- GOODS_COMM_ALERT_WEBHOOK_TOKEN must be replaced with a real production value
- GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS must be replaced with a real production value
- GOODS_COMM_WECHAT_APP_ID must be replaced with a real production value
- GOODS_COMM_WECHAT_APP_SECRET must be replaced with a real production value
- GOODS_COMM_ALIPAY_APP_ID must be replaced with a real production value
- GOODS_COMM_ALIPAY_PRIVATE_KEY must be replaced with a real production value
- No deploy path is ready; missing real GOODS_COMM_CLOUDBASE_ENV_ID, cloudbase/tcb CLI, real Tencent fallback service/image config, docker+tccli
### Warnings

- Placeholder-like values remain: VITE_API_BASE_URL, GOODS_COMM_CLOUDBASE_ENV_ID, GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE, GOODS_COMM_ALLOWED_ORIGINS, GOODS_COMM_PUBLIC_ASSET_BASE_URL, GOODS_COMM_TRUSTED_PROXY_IPS, GOODS_COMM_DATABASE_URL, GOODS_COMM_COS_BUCKET, GOODS_COMM_COS_SECRET_ID, GOODS_COMM_COS_SECRET_KEY, GOODS_COMM_COS_BASE_URL, GOODS_COMM_CDN_BASE_URL, GOODS_COMM_TENCENT_MAP_KEY, GOODS_COMM_MODERATION_WEBHOOK_SECRET, GOODS_COMM_SESSION_SECRET, GOODS_COMM_OPS_SESSION_SECRET, GOODS_COMM_OPS_ACCOUNTS, GOODS_COMM_ALERT_WEBHOOK_URL, GOODS_COMM_ALERT_WEBHOOK_TOKEN, GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS, GOODS_COMM_WECHAT_APP_ID, GOODS_COMM_WECHAT_APP_SECRET, GOODS_COMM_ALIPAY_APP_ID, GOODS_COMM_ALIPAY_PRIVATE_KEY
### Passes

- GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS limits PostgreSQL snapshot rewrites to 20000 rows
- GOODS_COMM_POSTGRES_ADVISORY_LOCK_KEY enables PostgreSQL advisory transaction locks for snapshot rewrites
- GOODS_COMM_POSTGRES_AUTO_SCHEMA is disabled for PostgreSQL store
- GOODS_COMM_OPS_LOGIN_MAX_FAILURES is 5
- GOODS_COMM_OPS_LOGIN_WINDOW_MS is 900000
- GOODS_COMM_OPS_LOGIN_LOCK_MS is 900000
- GOODS_COMM_ALERT_PROVIDER is webhook
- GOODS_COMM_ALERT_TIMEOUT_MS is 3000
- GOODS_COMM_ACCESS_LOG_ENABLED is true
- GOODS_COMM_RATE_LIMIT_MAX_REQUESTS is 300
- GOODS_COMM_RATE_LIMIT_WINDOW_MS is 60000
- GOODS_COMM_ROUTE_RATE_LIMIT_MAX_REQUESTS is 120
- GOODS_COMM_ROUTE_RATE_LIMIT_WINDOW_MS is 60000
- GOODS_COMM_USER_RATE_LIMIT_MAX_REQUESTS is 80
- GOODS_COMM_USER_RATE_LIMIT_WINDOW_MS is 60000
- GOODS_COMM_MAP_REGION_DATASET contains 2 configured region mappings

## Cross-environment isolation

### Blockers

- None
### Warnings

- pre/prod database URLs are configured as different placeholders; isolation is not proven until both values are real
- pre/prod COS buckets are configured as different placeholders; isolation is not proven until both values are real
### Passes

- pre/prod topology variables match: GOODS_COMM_TENCENT_REGION, HOST, PORT, GOODS_COMM_MAX_IMAGE_BYTES, GOODS_COMM_MAX_REQUEST_BYTES, GOODS_COMM_RATE_LIMIT_MAX_REQUESTS, GOODS_COMM_RATE_LIMIT_WINDOW_MS, GOODS_COMM_ROUTE_RATE_LIMIT_MAX_REQUESTS, GOODS_COMM_ROUTE_RATE_LIMIT_WINDOW_MS, GOODS_COMM_USER_RATE_LIMIT_MAX_REQUESTS, GOODS_COMM_USER_RATE_LIMIT_WINDOW_MS, GOODS_COMM_DATABASE_SCHEMA, GOODS_COMM_STATE_STORE, GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS, GOODS_COMM_POSTGRES_ADVISORY_LOCK_KEY, GOODS_COMM_POSTGRES_AUTO_SCHEMA, GOODS_COMM_OBJECT_STORE, GOODS_COMM_COS_REGION, GOODS_COMM_MAP_PROVIDER, GOODS_COMM_MAP_REGION_DATASET, GOODS_COMM_TENCENT_MAP_GEOCODER_URL, GOODS_COMM_CONTENT_SECURITY_PROVIDER, GOODS_COMM_PLATFORM_AUTH_MODE, GOODS_COMM_PLATFORM_NOTIFY_PROVIDER, GOODS_COMM_ALERT_PROVIDER, GOODS_COMM_ALERT_TIMEOUT_MS, GOODS_COMM_ACCESS_LOG_ENABLED, GOODS_COMM_OPS_LOGIN_MAX_FAILURES, GOODS_COMM_OPS_LOGIN_WINDOW_MS, GOODS_COMM_OPS_LOGIN_LOCK_MS, GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_FIELDS, GOODS_COMM_WECHAT_SUBSCRIBE_SEND_URL, GOODS_COMM_ALIPAY_GATEWAY
- pre accepts controlled prod-to-pre sync
- prod export flag is enabled for controlled prod-to-pre sync

## Build artifacts

### Blockers

- None
### Warnings

- None
### Passes

- dist/backend/package.json exists
- dist/backend artifact includes server, BFF, PostgreSQL store, schema, Dockerfile, start script, package-lock, and npm ci production dependency install check
- dist/build/pre/mp-weixin exists
- dist/build/pre/mp-alipay exists
- dist/build/pre/h5 exists
- dist/build/prod/mp-weixin exists
- dist/build/prod/mp-alipay exists
- dist/build/prod/h5 exists
- pre h5 artifact includes core pages, tabBar, key components, rendered test anchors, selector attributes, runtime environment config, and mini-program import config where applicable
- pre mp-weixin artifact includes core pages, tabBar, key components, rendered test anchors, selector attributes, runtime environment config, and mini-program import config where applicable
- pre mp-alipay artifact includes core pages, tabBar, key components, rendered test anchors, selector attributes, runtime environment config, and mini-program import config where applicable
- prod h5 artifact includes core pages, tabBar, key components, rendered test anchors, selector attributes, runtime environment config, and mini-program import config where applicable
- prod mp-weixin artifact includes core pages, tabBar, key components, rendered test anchors, selector attributes, runtime environment config, and mini-program import config where applicable
- prod mp-alipay artifact includes core pages, tabBar, key components, rendered test anchors, selector attributes, runtime environment config, and mini-program import config where applicable

## Deployed smoke readiness

### Blockers

- [pre] deployed smoke cannot run until VITE_API_BASE_URL or GOODS_COMM_SMOKE_API_BASE_URL points to a real API
- [prod] deployed smoke cannot run until VITE_API_BASE_URL or GOODS_COMM_SMOKE_API_BASE_URL points to a real API
### Warnings

- [pre] main-flow deployed smoke still needs real inputs in shell or .env.smoke.pre.local: GOODS_COMM_SMOKE_SELLER_CODE, GOODS_COMM_SMOKE_BUYER_CODE, GOODS_COMM_SMOKE_LATITUDE, GOODS_COMM_SMOKE_LONGITUDE
- [prod] main-flow deployed smoke still needs real inputs in shell or .env.smoke.prod.local: GOODS_COMM_SMOKE_SELLER_CODE, GOODS_COMM_SMOKE_BUYER_CODE, GOODS_COMM_SMOKE_LATITUDE, GOODS_COMM_SMOKE_LONGITUDE
- [prod] production main-flow smoke is protected by GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=true
### Passes

- None

## Release gate commands

```bash
npm run env:check
npm run audit:production-readiness -- --check-only
npm run audit:production-readiness:strict-check
npm run db:migrate:plan -- --env pre
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre npm run db:migrate:pre
npm run deploy:frontend:pre:plan
GOODS_COMM_FRONTEND_DEPLOY_CONFIRM=deploy-frontend-pre npm run deploy:frontend:pre
npm run deploy:backend:pre:plan
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre GOODS_COMM_DEPLOY_CONFIRM=deploy-pre npm run deploy:backend:pre
npm run smoke:deployed:pre
npm run smoke:deployed:pre:main
npm run sync:prod-to-pre:plan
GOODS_COMM_SYNC_RUN_PRE_SMOKE=true GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true GOODS_COMM_SYNC_AUTO_ENABLED=true npm run sync:prod-to-pre:auto
```
