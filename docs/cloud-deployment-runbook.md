# goods-comm cloud deployment runbook

Updated: 2026-06-01

This runbook covers the cloud deployment path after code, build artifacts, database provisioning, and release inputs are ready. The preferred production path is WeChat CloudBase / WeChat cloud hosting. Tencent Cloud container deployment remains the fallback when CloudBase cannot host the backend.

## 1. Release entry points

Use these entry points in order:

```bash
npm run release:inputs -- --check-only
npm run verify:release:strict
npm run deploy:backend:pre:plan
npm run deploy:frontend:pre:plan
npm run smoke:deployed:pre
npm run smoke:deployed:pre:main
```

For normal protected releases, prefer the manual GitHub workflow:

```text
.github/workflows/release-strict.yml
```

The workflow must pass `release:inputs`, then `verify:release:strict`, then optional backend deploy, deployed smoke, and frontend deploy. Direct local deploy commands are useful for operator recovery, but GitHub Actions is the auditable release path.

## 2. Required GitHub Secrets

Use multi-line Secrets for environment files:

| Secret | Writes | Purpose |
| --- | --- | --- |
| `GOODS_COMM_PRE_ENV_LOCAL` | `.env.pre.local` | Real pre runtime, cloud, database, COS, map, auth, notification, alert, and origin config. |
| `GOODS_COMM_PROD_ENV_LOCAL` | `.env.prod.local` | Real prod runtime config, separate from pre. |
| `GOODS_COMM_PRE_SMOKE_ENV_LOCAL` | `.env.smoke.pre.local` | One-time pre deployed smoke input bundle. |
| `GOODS_COMM_PROD_SMOKE_ENV_LOCAL` | `.env.smoke.prod.local` | One-time prod deployed smoke input bundle. |

Use single Secrets for non-interactive cloud credentials and optional CLI paths:

| Secret | Required for |
| --- | --- |
| `TENCENTCLOUD_SECRET_ID` | CloudBase login and Tencent Cloud fallback deploy. |
| `TENCENTCLOUD_SECRET_KEY` | CloudBase login and Tencent Cloud fallback deploy. |
| `TENCENTCLOUD_SESSION_TOKEN` | Temporary Tencent credential sessions. |
| `GOODS_COMM_WECHAT_DEVTOOLS_CLI` | WeChat Mini Program upload when `frontend_targets` includes `mp-weixin`. |
| `GOODS_COMM_ALIPAY_MINI_CLI` | Alipay Mini Program upload when `frontend_targets` includes `mp-alipay`. |

The workflow also accepts individual `GOODS_COMM_SMOKE_*` Secrets as fallback overrides, but the multi-line smoke env Secrets should be the primary path because they keep pre and prod smoke inputs separate.

## 3. Toolchain boundary

The release workflow installs:

- CloudBase CLI with `npm install -g @cloudbase/cli`.
- Tencent `tccli` with Python `pip`.
- Project dependencies with `npm ci`.

CloudBase deployment requires `cloudbase` or `tcb` plus Tencent API credentials. Tencent fallback deployment requires `docker + tccli`, a real `GOODS_COMM_TENCENT_CONTAINER_IMAGE`, and a real `GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE`. GitHub-hosted Linux runners normally provide Docker, but local operators must verify it with:

```bash
cloudbase --version || tcb --version
docker --version
tccli --version
```

Only set `GOODS_COMM_DEPLOY_ALLOW_EXISTING_CLOUDBASE_LOGIN=true` for a manually controlled runner that is already logged in. CI should use `TENCENTCLOUD_SECRET_ID` and `TENCENTCLOUD_SECRET_KEY` instead.

## 4. Pre deployment sequence

First prove the release inputs and strict gate:

```bash
npm run release:inputs -- --check-only
npm run verify:release:strict
```

Then inspect plans:

```bash
npm run db:provision:pre:plan
npm run db:migrate:pre:plan
npm run deploy:backend:pre:plan
npm run deploy:frontend:pre:plan
```

Backend deploy applies migration by default before exposing the new backend:

```bash
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre GOODS_COMM_DEPLOY_CONFIRM=deploy-pre npm run deploy:backend:pre
```

To bind deployed main-flow verification to the backend deploy command:

```bash
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre \
GOODS_COMM_DEPLOY_CONFIRM=deploy-pre \
GOODS_COMM_DEPLOY_RUN_MAIN_SMOKE=true \
npm run deploy:backend:pre
```

Frontend deploy should happen only after the backend and deployed smoke pass:

```bash
GOODS_COMM_FRONTEND_DEPLOY_CONFIRM=deploy-frontend-pre npm run deploy:frontend:pre
```

If cloud startup is slow, tune the health window without skipping smoke:

```bash
GOODS_COMM_DEPLOY_CONFIRM=deploy-pre \
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre \
npm run deploy:backend:pre -- --health-attempts 24 --health-interval-ms 10000
```

## 5. Production deployment sequence

Production follows the same topology as pre but uses a separate database, bucket, API service, smoke account set, and runtime secrets.

Production backend deployment requires both deploy and migration opt-ins:

```bash
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-prod \
GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true \
GOODS_COMM_DEPLOY_CONFIRM=deploy-prod \
GOODS_COMM_DEPLOY_ALLOW_PROD=true \
npm run deploy:backend:prod
```

Production frontend deployment requires the production deploy opt-in:

```bash
GOODS_COMM_FRONTEND_DEPLOY_CONFIRM=deploy-frontend-prod \
GOODS_COMM_DEPLOY_ALLOW_PROD=true \
npm run deploy:frontend:prod
```

Production main-flow smoke writes real test data. Run it only with a dedicated production test account and cleanup policy:

```bash
GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=true npm run smoke:deployed:prod:main
```

## 6. GitHub workflow inputs

Use these workflow settings for a pre backend release:

| Input | Value |
| --- | --- |
| `target_environment` | `pre` |
| `run_backend_deploy` | `true` |
| `run_deployed_smoke` | `true` |
| `run_frontend_deploy` | `false` until backend smoke passes |
| `backend_provider` | `auto`, or `cloudbase` / `tencent` when intentionally forcing a path |
| `skip_db_migrate` | `false` |
| `allow_prod_deploy` | `false` |
| `allow_prod_mutation` | `false` |

Use these workflow settings for a production release:

| Input | Value |
| --- | --- |
| `target_environment` | `prod` or `both` |
| `run_backend_deploy` | `true` |
| `run_deployed_smoke` | `true` |
| `run_frontend_deploy` | `true` only after backend smoke is green |
| `allow_prod_deploy` | `true` |
| `allow_prod_mutation` | `true` only for a dedicated production smoke window |

The workflow refuses backend deployment when `run_deployed_smoke=false`. It also refuses production deploy without `allow_prod_deploy=true`, and refuses production main-flow smoke without `allow_prod_mutation=true`.

## 7. Acceptance gates

Cloud deployment is not complete until all of these are true:

1. `npm run release:inputs -- --check-only` passes with real pre/prod env and smoke bundles.
2. `npm run verify:release:strict` passes.
3. Backend deploy succeeds for pre and immediately passes `npm run smoke:deployed:pre`.
4. Pre main flow passes `npm run smoke:deployed:pre:main`.
5. Frontend H5 / WeChat / Alipay artifacts are uploaded only after the matching backend is verified.
6. Production uses the same sequence with explicit production opt-ins.
7. `npm run audit:production-readiness:strict-check` has no cloud deployment, environment, database, or deployed smoke blockers.

## 8. Failure handling

| Failure | Action |
| --- | --- |
| `release:inputs` fails | Do not deploy. Fill missing GitHub Secrets or `.env.*.local` values first. |
| `verify:release:strict` fails | Do not deploy. Use the strict audit artifacts to fix the failed gate. |
| CloudBase CLI auth fails | Confirm `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`, or use a manually controlled runner with `GOODS_COMM_DEPLOY_ALLOW_EXISTING_CLOUDBASE_LOGIN=true`. |
| Tencent fallback image push fails | Confirm Docker daemon, image registry permissions, and `GOODS_COMM_TENCENT_CONTAINER_IMAGE`. |
| `/health/ready` fails after deploy | Do not deploy frontend. Check database migration, COS, map, alert, platform auth, and runtime env values. |
| Deployed main-flow smoke fails | Treat the release as failed. Keep frontend on the previously verified backend until root cause is fixed. |
