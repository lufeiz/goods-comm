# goods-comm backend

This backend mounts the same BFF contract used by the mini-program services:

- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/delete-account`
- `POST /lbs/resolve-region`
- `POST /uploads/items`
- `GET /items`
- `POST /items`
- `GET /items/mine`
- `GET /items/:id`
- `PATCH /items/:id/status`
- `GET /trades`
- `POST /trades`
- `PATCH /trades/:id/status`
- `POST /trades/:id/review`
- `GET /reviews?itemId=<item_id>`
- `GET /disputes`
- `GET /notifications`
- `PATCH /notifications/:id/read`
- `POST /telemetry/client-events`
- `POST /reports`
- `GET /ops/moderation-queue`
- `GET /ops/client-events`
- `GET /ops/audit-events`
- `GET /ops/reports`
- `POST|PATCH /ops/reports/:id/resolve`
- `GET /ops/users`
- `POST|PATCH /ops/users/:id/status`
- `GET /ops/notification-deliveries`
- `POST|PATCH /ops/notification-deliveries/retry`
- `POST|PATCH /moderation/disputes/:id/resolve`
- `POST|PATCH /moderation/items/:id/review`
- `POST|PATCH /moderation/media/:traceId/review`

Operational endpoints:

- `GET /health`: liveness check.
- `GET /health/ready`: readiness check; verifies the configured state store can be reached.

Both endpoints expose the active `accessLog` settings so deployed smoke can confirm production access logging was not disabled.

Local smoke tests use a file-backed state store so the HTTP boundary is real and repeatable without external credentials. `pre/prod` use the PostgreSQL state store by default; it reads and writes the normalized tables in `backend/db/schema.sql` inside a transaction. In `pre/prod`, schema auto-creation is disabled by default, so the database migration must run before backend startup.

Mutating business requests support `Idempotency-Key` / `X-Idempotency-Key`. The BFF stores the first successful response in `idempotency_records` for 24 hours, replays it for exact duplicate requests in the same scope, and rejects key reuse for different requests with `409 CONFLICT`. Replayed trade-confirm responses are sanitized through the same one-time contact-code expiry rules so an old idempotency record cannot leak an expired code. The mini-program service layer already sends stable keys for publish, trade, review, report and status update paths.

## Local Run

```bash
npm run backend:dev
```

Default URL: `http://127.0.0.1:8787`

Useful environment variables:

- `GOODS_COMM_ENV`: runtime environment, one of `dev`, `test`, `pre`, `prod`.
- `GOODS_COMM_CLOUDBASE_ENV_ID`: WeChat CloudBase / cloud run environment ID for the preferred deployment path.
- `GOODS_COMM_TENCENT_REGION`, `GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE`, `GOODS_COMM_TENCENT_CONTAINER_IMAGE`: Tencent Cloud fallback deployment target and container image.
- `PORT`: HTTP port.
- `HOST`: bind host.
- `GOODS_COMM_STATE_PATH`: file store path.
- `GOODS_COMM_DATABASE_URL`: target PostgreSQL / TencentDB connection string for the current environment.
- `GOODS_COMM_STATE_STORE`: `file` or `postgres`. Defaults to `file` in `dev/test` and `postgres` in `pre/prod`.
- `GOODS_COMM_POSTGRES_AUTO_SCHEMA`: `true` allows local dev/test PostgreSQL self-bootstrapping; `pre/prod` must keep it `false` and use explicit migration.
- `GOODS_COMM_PLATFORM_AUTH_MODE`: `demo` or `platform`. Defaults to `demo` in `dev/test` and `platform` in `pre/prod`.
- `GOODS_COMM_WECHAT_APP_ID`, `GOODS_COMM_WECHAT_APP_SECRET`: WeChat mini-program credentials for server-side `jscode2session`.
- `GOODS_COMM_ALIPAY_APP_ID`, `GOODS_COMM_ALIPAY_PRIVATE_KEY`, `GOODS_COMM_ALIPAY_GATEWAY`: Alipay mini-program credentials for `alipay.system.oauth.token`.
- `GOODS_COMM_OBJECT_DIR`: local object-store directory for uploaded item images.
- `GOODS_COMM_PUBLIC_ASSET_BASE_URL`: public URL prefix for uploaded assets. Defaults to `/assets`.
- `GOODS_COMM_MAX_IMAGE_BYTES`: max item image upload size. Defaults to 5MB.
- `GOODS_COMM_MAX_REQUEST_BYTES`: max HTTP request body size before JSON or multipart parsing. Defaults to 6MB and should stay above `GOODS_COMM_MAX_IMAGE_BYTES`.
- `GOODS_COMM_RATE_LIMIT_MAX_REQUESTS`, `GOODS_COMM_RATE_LIMIT_WINDOW_MS`: per-client in-process HTTP rate limit. Defaults to 300 requests per 60 seconds; keep pre/prod aligned and still use cloud gateway / WAF limits for public traffic.
- `GOODS_COMM_TRUSTED_PROXY_IPS`: `none` or a comma-separated list of trusted proxy IPs / IPv4 CIDRs. The backend only trusts `x-forwarded-for` when the direct peer matches this allowlist; otherwise rate limiting uses the socket remote address.
- `GOODS_COMM_OBJECT_STORE`: `local` or `cos`. Defaults to `local` in `dev/test` and `cos` in `pre/prod`.
- `GOODS_COMM_COS_BUCKET`, `GOODS_COMM_COS_REGION`, `GOODS_COMM_COS_SECRET_ID`, `GOODS_COMM_COS_SECRET_KEY`, `GOODS_COMM_COS_BASE_URL`, `GOODS_COMM_CDN_BASE_URL`: Tencent COS / CDN settings for production image storage.
- `GOODS_COMM_CONTENT_SECURITY_PROVIDER`: `mock` or `wechat`. Defaults to `mock` in `dev/test` and `wechat` in `pre/prod`.
- `GOODS_COMM_MODERATION_WEBHOOK_SECRET`: shared secret for content-safety callbacks, internal moderation jobs, and the lightweight ops console that call `/ops/*` or `/moderation/*`.
- `GOODS_COMM_SESSION_SECRET`: server-side secret used to HMAC session tokens before persisting `tokenHash`; required in `pre/prod`.
- `GOODS_COMM_OPS_LOGIN_MAX_FAILURES`, `GOODS_COMM_OPS_LOGIN_WINDOW_MS`, `GOODS_COMM_OPS_LOGIN_LOCK_MS`: per-account ops-console failed-login lockout settings.
- `GOODS_COMM_PLATFORM_NOTIFY_PROVIDER`: `mock` or `wechat`. Defaults to `mock` in `dev/test` and `wechat` in `pre/prod`.
- `GOODS_COMM_ALERT_PROVIDER`: `none` or `webhook`. `pre/prod` should use `webhook` so notification delivery failures reach the on-call/monitoring system.
- `GOODS_COMM_ALERT_WEBHOOK_URL`, `GOODS_COMM_ALERT_WEBHOOK_TOKEN`, `GOODS_COMM_ALERT_TIMEOUT_MS`: alert webhook endpoint, bearer token, and timeout. `pre/prod` require a real HTTPS URL and token.
- `GOODS_COMM_ACCESS_LOG_ENABLED`: enables structured JSON access logs. Defaults to `false` in `dev/test` and `true` in `pre/prod`; production health smoke asserts it remains enabled.
- `GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS`: comma-separated WeChat subscribe-message templates, for example `trade_created:tmpl1,trade_confirmed:tmpl2`.
- `GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_FIELDS`: template field mapping, default-compatible format `title:thing1,body:thing2,time:time3`.
- `GOODS_COMM_WECHAT_SUBSCRIBE_SEND_URL`: WeChat subscribe-message send endpoint.
- `GOODS_COMM_MAP_PROVIDER`: `mock` or `tencent`. Defaults to `mock` in `dev/test` and `tencent` in `pre/prod`.
- `GOODS_COMM_MAP_REGION_DATASET`: JSON region-grid dataset used to map Tencent administrative/street results to internal community and street IDs; `pre/prod` deploy preflight requires a non-empty JSON array.
- `GOODS_COMM_TENCENT_MAP_KEY`, `GOODS_COMM_TENCENT_MAP_GEOCODER_URL`: Tencent Maps WebService key and reverse-geocoder endpoint.
- `GOODS_COMM_ALLOWED_ORIGINS`: comma-separated browser origins allowed by CORS, for example `https://mini.example.com,https://h5.example.com`. Unset means `*` for local development, but `pre/prod` reject empty or wildcard origins unless the unsafe emergency override is explicitly enabled.

The backend adds baseline HTTP hardening headers to JSON, preflight, error, and asset responses: `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, and `permissions-policy: geolocation=(), camera=(), microphone=()`. `pre/prod` responses also include HSTS. Keep cloud gateway, CDN, or WAF configuration from stripping these headers. When the service is behind CloudBase, CDN, WAF, or a load balancer, set `GOODS_COMM_TRUSTED_PROXY_IPS` to that trusted hop only; never trust arbitrary `x-forwarded-for` from the public internet.

When access logging is enabled, each completed HTTP request writes one JSON line to stdout with trace id, method, normalized route path, status, duration, CORS result and rate-limit summary. Query strings, headers and request bodies are not logged, and dynamic route IDs are collapsed to route shapes such as `/items/:id` or `/trades/:id/status`.

## Production Target

The preferred production target is WeChat CloudBase / cloud run when mini-program domain and AppID are available. If that is not available, deploy this Node service to Tencent Cloud Cloud Run / CVM and use TencentDB for PostgreSQL with the schema in `backend/db/schema.sql`.

The mini-program should set `VITE_API_BASE_URL` to the deployed HTTPS gateway.

Set `GOODS_COMM_ALLOWED_ORIGINS` to the deployed legal request domains when exposing the service to browser or H5 clients. `pre/prod` startup rejects empty or `*` CORS origins by default; requests without an `Origin` header, such as mini-program native requests or server-to-server checks, are still accepted.

All deployments must use one of the four environment files as the source of required values:

- `.env.dev`
- `.env.test`
- `.env.pre`
- `.env.prod`

Run `npm run env:check` before packaging or deploying. `pre` and `prod` must use different database URLs and object storage buckets while keeping the same schema and resource topology. The backend rejects file state storage, demo auth, local object storage, mock content safety, mock region data and mock platform notification delivery in `pre/prod` unless an explicit unsafe override is provided for emergency debugging.

Deployment and database operations are executable plans:

- `npm run db:migrate:plan -- --env pre` prints the PostgreSQL schema migration plan.
- `GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre npm run db:migrate:pre` applies `backend/db/schema.sql` after real credentials and `psql` are available.
- `npm run deploy:backend:pre:plan` prints the WeChat-first / Tencent-fallback backend deployment plan and missing prerequisites, including the artifact smoke that runs after `build:backend`.
- `GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre GOODS_COMM_DEPLOY_CONFIRM=deploy-pre npm run deploy:backend:pre` builds and verifies the backend artifact, applies the database schema, and then deploys after real cloud values, CLI tools and credentials are available. Use `--skip-db-migrate` only when the same backend version has already migrated the target database.

`backend/src/postgres-state-store.mjs` provides a PostgreSQL-backed transactional state store over normalized tables: `users`, `auth_sessions`, `idempotency_records`, `items`, `item_images`, `trade_intents`, `trade_disputes`, `trade_reviews`, `notifications`, `notification_deliveries`, `reports`, `moderation_events`, `client_events`, `ops_audit_events` and `account_deletions`. The BFF handler still receives one state object per request, but the persistence boundary is no longer a JSON snapshot table. Until this store is refactored into incremental SQL writes per aggregate, it uses a guarded snapshot-rewrite mode: `GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS` defaults to `20000`, and a transaction fails before rewriting if the serialized row count exceeds that limit. Runtime schema creation is only for dev/test bootstrapping; `pre/prod` must set `GOODS_COMM_POSTGRES_AUTO_SCHEMA=false` and rely on the explicit migration step. The protected-environment readiness check validates both normalized table existence and required columns, so a partially migrated database fails before serving traffic.

Run `npm run smoke:postgres-store` to verify the state-to-table mapping without requiring a live database. A live deployment must still validate the same path against a real TencentDB / PostgreSQL instance.

Use `/health/ready` as the cloud run readiness probe. It returns `503 SERVICE_UNAVAILABLE` when the configured state store is not reachable, the PostgreSQL runtime dependency is missing, the normalized schema was not migrated before startup, a required normalized column is missing, or a configured production alert webhook is invalid. For PostgreSQL it also reports `mode: normalized_snapshot_rewrite`, `autoSchema`, `currentRowCount`, `snapshotRowLimit`, and table-level `rowCounts` so operators can see when the bridge implementation is approaching its configured safety ceiling. The same readiness response includes `accessLog` so pre/prod deployments can prove structured request logs are enabled.

`backend/src/platform-auth.mjs` performs server-side platform identity exchange before `/auth/login` reaches the BFF handler. In `pre/prod`, demo login is rejected unless explicitly overridden for emergency debugging; login must exchange the client code for a platform `openid` / `user_id` first.

`backend/src/platform-notifier.mjs` dispatches newly created trade notifications after the state transaction commits. `dev/test` use a deterministic mock provider; `pre/prod` must use the WeChat subscribe-message adapter and real template IDs. Each notification creates a durable `notification_deliveries` outbox record before delivery starts. Delivery failure does not roll back the trade transaction; operators can inspect failures with `GET /ops/notification-deliveries?status=failed` and retry with `POST /ops/notification-deliveries/retry` using an ops session or `x-moderation-secret`. `backend/src/ops-alerts.mjs` can also send a sanitized webhook alert for notification delivery and retry failures; `/health` exposes `opsAlert` and `/health/ready` validates the configured webhook.

Platform auth references:

- WeChat mini-program code2Session: https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
- Alipay mini-program user authorization: https://opendocs.alipay.com/mini/api/openapi-authorize
- WeChat text content safety: https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/sec-center/sec-check/msgSecCheck.html
- WeChat media content safety: https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/sec-center/sec-check/mediaCheckAsync.html
- Tencent COS request signature: https://cloud.tencent.com/document/product/436/7778

The local backend persists uploaded image bytes under `GOODS_COMM_OBJECT_DIR` and serves them from `/assets/...`. `pre/prod` reject local object storage by default and must use the COS adapter in `backend/src/cos-object-store.mjs`, keeping the same upload response shape: `url`, `storageKey`, `size`, `mimeType`, `checksum`.

`backend/src/content-safety.mjs` performs text and image moderation before item publishing enters the BFF handler. `dev/test` use deterministic mock checks; `pre/prod` reject mock content safety and must use WeChat content safety. The HTTP server resolves the authenticated BFF session before upload image review or item text review, and passes the session-bound WeChat `openid` as moderation context instead of trusting client-supplied identity fields. WeChat asynchronous image review returns a media `trace_id`; callbacks should call `/moderation/media/:traceId/review` with `x-moderation-secret`, while internal moderation workers can still review by item ID through `/moderation/items/:id/review`.

`src/pages/ops/ops.vue` is a lightweight internal ops console. Operators log in with `POST /ops/login`; the backend validates `GOODS_COMM_OPS_ACCOUNTS`, signs a short-lived token with `GOODS_COMM_OPS_SESSION_SECRET`, enforces role checks, injects the operator id into moderation actions, and writes login / moderation / report / dispute / notification retry actions to `ops_audit_events`. `x-moderation-secret` is still accepted for trusted callbacks and internal jobs, but production operators should use named accounts from a controlled H5/internal domain.

`src/services/telemetry.js` reports client-side failures such as login, location, publish, trade, report, and account deletion errors to `POST /telemetry/client-events`. The backend strips sensitive context fields before persisting `client_events`; operators can inspect recent events with `GET /ops/client-events` using an ops session or `x-moderation-secret`.

`backend/src/region-resolver.mjs` performs server-side region resolution before `/lbs/resolve-region`, `/items` and `/trades` enter the BFF handler. `dev/test` can use deterministic sample regions; `pre/prod` reject sample regions and must use Tencent Maps plus a configured community/street grid dataset. `/health` and `/health/ready` expose the active `mapProvider` so deployments can confirm the backend did not start with a mock resolver.

## Build Artifact

```bash
npm run build:backend
npm run smoke:backend:artifact
```

The deployment artifact is generated at `dist/backend`. The artifact smoke verifies the deploy package contains the Node server, BFF, PostgreSQL store, database schema, deployment files, startup script, artifact lockfile, and the Dockerfile step that installs locked production dependencies with `npm ci`. See `backend/deploy/tencent-cloud-run.md` for CloudBase / Tencent Cloud deployment notes.
