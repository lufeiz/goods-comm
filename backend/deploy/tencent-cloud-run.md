# Backend Deployment Notes

Recommended order:

1. WeChat CloudBase / cloud run, if the mini-program AppID and CloudBase environment are available.
2. Tencent Cloud Cloud Run or CVM with HTTPS gateway.
3. TencentDB for PostgreSQL using `backend/db/schema.sql`.

Build the artifact:

```bash
npm run build:backend
npm run smoke:backend:artifact
```

Database migration plan:

```bash
npm run db:migrate:plan -- --env pre
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre npm run db:migrate:pre
```

Backend deployment plan:

```bash
npm run deploy:backend:pre:plan
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre GOODS_COMM_DEPLOY_CONFIRM=deploy-pre npm run deploy:backend:pre
npm run smoke:deployed:pre
GOODS_COMM_SMOKE_SELLER_CODE=... GOODS_COMM_SMOKE_BUYER_CODE=... GOODS_COMM_SMOKE_LATITUDE=... GOODS_COMM_SMOKE_LONGITUDE=... npm run smoke:deployed:pre:main
```

The deployment script chooses WeChat CloudBase first when `GOODS_COMM_CLOUDBASE_ENV_ID` is real. If that is still a placeholder, it plans the Tencent Cloud fallback and requires Docker, `tccli`, a target service id and a container image URL. Execute mode builds `dist/backend`, runs `npm run smoke:backend:artifact`, then applies `backend/db/schema.sql` before deploying the backend so `pre/prod` do not rely on runtime schema creation; use `--skip-db-migrate` only when the same version already migrated the target database. The deployed main-flow smoke needs short-lived seller/buyer mini-program login codes and coordinates covered by the configured community grid. If WeChat image review returns async pending, provide `GOODS_COMM_SMOKE_APPROVED_IMAGE_URL` for a pre-approved HTTPS test image.

CI deployment credentials:

- Set `TENCENTCLOUD_SECRET_ID` and `TENCENTCLOUD_SECRET_KEY` in GitHub Actions or the internal runner before executing `npm run deploy:backend:*`.
- If the credential is temporary, also set `TENCENTCLOUD_SESSION_TOKEN`.
- The credential must cover the selected deploy path: CloudBase / WeChat cloud run, TencentDB PostgreSQL migration access, COS object storage, CDN domain configuration, and Tencent Cloud Run / TEM fallback deployment.
- For local manual CloudBase deploys, an existing CLI login can be used only with `GOODS_COMM_DEPLOY_ALLOW_EXISTING_CLOUDBASE_LOGIN=true`; CI should use API credentials instead.

The generated artifact is `dist/backend`. It contains:

- `package.json`: production-only backend runtime dependencies and `npm start`.
- `package-lock.json`: backend-only lockfile generated from the root lockfile for reproducible container installs.
- `backend/src/server.mjs`: Node HTTP entry.
- `backend/db/schema.sql`: production database schema.
- `backend/deploy/Dockerfile`: container image recipe.
- `src/bff`, `src/domain`, `src/data`, `src/config`, `src/utils`: shared business logic needed by the backend.

The Dockerfile installs the artifact production dependencies with `npm ci --omit=dev` during image build. Keep `npm run smoke:backend:artifact` in the release gate so the deploy package cannot silently lose `pg`, the artifact lockfile, the start script, schema files, or the dependency install step.

Local container build from artifact:

```bash
cd dist/backend
docker build -f backend/deploy/Dockerfile -t goods-comm-backend:local .
```

Runtime variables:

- `GOODS_COMM_ENV=pre` or `GOODS_COMM_ENV=prod`
- `GOODS_COMM_CLOUDBASE_ENV_ID=...`
- `GOODS_COMM_TENCENT_REGION=ap-shanghai`
- `GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE=...`
- `GOODS_COMM_TENCENT_CONTAINER_IMAGE=ccr.ccs.tencentyun.com/<namespace>/goods-comm-backend:<tag>`
- `HOST=0.0.0.0`
- `PORT=8787`
- `GOODS_COMM_STATE_PATH=/data/goods-comm-state.json`
- `GOODS_COMM_DATABASE_URL=postgres://...`
- `GOODS_COMM_STATE_STORE=postgres`
- `GOODS_COMM_POSTGRES_AUTO_SCHEMA=false`
- `GOODS_COMM_PLATFORM_AUTH_MODE=platform`
- `GOODS_COMM_WECHAT_APP_ID=...`
- `GOODS_COMM_WECHAT_APP_SECRET=...`
- `GOODS_COMM_ALIPAY_APP_ID=...`
- `GOODS_COMM_ALIPAY_PRIVATE_KEY=...`
- `GOODS_COMM_ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do`
- `GOODS_COMM_OBJECT_DIR=/data/object-store`
- `GOODS_COMM_OBJECT_STORE=cos`
- `GOODS_COMM_COS_BUCKET=...`
- `GOODS_COMM_COS_REGION=ap-shanghai`
- `GOODS_COMM_COS_SECRET_ID=...`
- `GOODS_COMM_COS_SECRET_KEY=...`
- `GOODS_COMM_COS_BASE_URL=https://<bucket>.cos.<region>.myqcloud.com`
- `GOODS_COMM_CDN_BASE_URL=https://cdn.example.com/assets`
- `GOODS_COMM_PUBLIC_ASSET_BASE_URL=/assets`
- `GOODS_COMM_CONTENT_SECURITY_PROVIDER=wechat`
- `GOODS_COMM_MODERATION_WEBHOOK_SECRET=...`
- `GOODS_COMM_SESSION_SECRET=...`
- `GOODS_COMM_PLATFORM_NOTIFY_PROVIDER=wechat`
- `GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS=trade_created:...,trade_confirmed:...,trade_completed:...,trade_cancelled:...,trade_disputed:...,trade_dispute_resolved:...,trade_reviewed:...`
- `GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_FIELDS=title:thing1,body:thing2,time:time3`
- `GOODS_COMM_WECHAT_SUBSCRIBE_SEND_URL=https://api.weixin.qq.com/cgi-bin/message/subscribe/send`
- `GOODS_COMM_MAP_PROVIDER=tencent`
- `GOODS_COMM_MAP_REGION_DATASET=[...]` with a non-empty JSON array of internal community/street mappings.
- `GOODS_COMM_TENCENT_MAP_KEY=...`
- `GOODS_COMM_TENCENT_MAP_GEOCODER_URL=https://apis.map.qq.com/ws/geocoder/v1/`
- `GOODS_COMM_ALLOWED_ORIGINS=https://your-mini-or-h5-domain.example.com`

Production database requirement:

The local file store is only for dev/test smoke validation. `pre/prod` use `backend/src/postgres-state-store.mjs`, which persists the BFF state into normalized PostgreSQL tables inside a transaction. The following operations are covered by the same transaction boundary:

- item creation with duplicate active-title check
- idempotency record creation and response replay for mutating business requests
- trade creation with item reservation
- trade completion/cancel/dispute with item status update
- dispute case creation and support resolution with trade/item/notification updates
- report queue review and report resolution with item/trade/moderation-event updates
- notification outbox creation, delivery status persistence and ops retry after successful notification creation
- high-risk report with item removal and active trade dispute
- user risk block/unblock with session revocation, item removal and active trade dispute
- account deletion with session revocation, item removal and active trade cancellation

Before public launch, validate this path against the real TencentDB / PostgreSQL instance with production credentials; local smoke only verifies the table mapping and handler contract.

Environment requirement:

- Use `.env.dev`, `.env.test`, `.env.pre`, `.env.prod` as the deployment variable checklist.
- `pre` and `prod` must use two different TencentDB databases.
- `pre` and `prod` must use the same schema version before release validation.
- `pre` and `prod` must run with `GOODS_COMM_STATE_STORE=postgres`; file store is blocked by the backend at startup.
- `pre` and `prod` must run with `GOODS_COMM_PLATFORM_AUTH_MODE=platform`; demo login is blocked by the backend at startup.
- `pre` and `prod` must run with `GOODS_COMM_OBJECT_STORE=cos`; local object storage is blocked by the backend at startup.
- `pre` and `prod` must run with `GOODS_COMM_CONTENT_SECURITY_PROVIDER=wechat`; mock moderation is blocked by the backend at startup.
- `pre` and `prod` must set `GOODS_COMM_MODERATION_WEBHOOK_SECRET`; WeChat asynchronous image review callbacks finalize pending media through `/moderation/media/:traceId/review`, and internal moderation jobs can still finalize items through `/moderation/items/:id/review`.
- `pre` and `prod` must set `GOODS_COMM_SESSION_SECRET`; session tokens are persisted only as HMAC-SHA256 hashes derived from this secret.
- `pre` and `prod` must run with `GOODS_COMM_PLATFORM_NOTIFY_PROVIDER=wechat`; mock platform notification delivery is blocked by the backend at startup.
- `pre` and `prod` must configure WeChat subscribe-message template IDs for each trade notification type before enabling real template-message delivery.

Prod-to-pre data refresh:

- Manual refresh: `GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre npm run sync:prod-to-pre`.
- Scheduled refresh: `GOODS_COMM_SYNC_AUTO_ENABLED=true npm run sync:prod-to-pre:auto` from a trusted CloudBase / Tencent Cloud scheduled job or internal runner.
- The sync task writes a lock file and an audit jsonl record with per-stage timing and failure details. Set `GOODS_COMM_SYNC_LOCK_PATH`, `GOODS_COMM_SYNC_AUDIT_PATH` and `GOODS_COMM_SYNC_DUMP_PATH` to persistent task-local paths in the scheduler environment.
- Set `GOODS_COMM_SYNC_RUN_PRE_SMOKE=true` if the scheduler should run `node scripts/deployed-health-smoke.mjs --env pre` after restoring and anonymizing data.
- Set `GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true` if the scheduler should also run `node scripts/deployed-main-flow-smoke.mjs --env pre` after the sync. This requires the same short-lived smoke login codes and covered coordinates used by the deployed pre main-flow smoke.
- `pre` and `prod` must run with `GOODS_COMM_MAP_PROVIDER=tencent`; sample region data is blocked by the backend at startup.
- Use `npm run sync:prod-to-pre:plan` for a dry-run plan, and `GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre npm run sync:prod-to-pre` for controlled prod-to-pre data sync after real credentials are available.
- Configure `/health/ready` as the readiness probe so the service does not receive traffic before PostgreSQL is reachable.

The local object store is only for dev/test smoke validation. `pre/prod` use Tencent COS / CDN through the COS adapter, while preserving upload metadata:

- `url`
- `storageKey`
- `size`
- `mimeType`
- `checksum`

Domain and mini-program configuration:

Set `VITE_API_BASE_URL` to the deployed HTTPS backend domain, configure that domain as a legal request/upload domain in the mini-program platform console, and keep `GOODS_COMM_ALLOWED_ORIGINS` aligned with any browser/H5 origins that call this backend.

Map and region configuration:

Configure `GOODS_COMM_TENCENT_MAP_KEY` as a server-side key only. `GOODS_COMM_MAP_REGION_DATASET` must contain the internal community/street grid mapping used by the business as a non-empty JSON array, so Tencent administrative data can be converted into stable internal `communityId` and `streetId` values.
