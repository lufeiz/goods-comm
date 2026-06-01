# goods-comm database provisioning runbook

Updated: 2026-06-01

This runbook covers the database part of production delivery for `dev`, `test`, `pre`, and `prod`. It is separate from runtime docs because database provisioning needs elevated credentials that must not be available to the running backend.

## 1. Required boundary

`pre` and `prod` must use the same schema and cloud topology, but they must not share a database, object bucket, API service, smoke account, or runtime secret.

| Environment | Database | Purpose |
| --- | --- | --- |
| `dev` | `goods_comm_dev` | Local development; file store is still allowed for fast iteration. |
| `test` | `goods_comm_test` | Automated test environment; isolated from dev/pre/prod. |
| `pre` | `goods_comm_pre` | Pre-release validation using production-like topology. |
| `prod` | `goods_comm_prod` | Real production traffic. |

Use two connection strings for protected environments:

| Variable | Used by | Scope |
| --- | --- | --- |
| `GOODS_COMM_DATABASE_URL` | backend runtime, migration, smoke, prod-to-pre sync | Least-privilege application role for one environment. |
| `GOODS_COMM_DATABASE_ADMIN_URL` | `npm run db:provision:*` only | Elevated PostgreSQL/TencentDB admin role used to create the app role and target database. Never pass this to the backend runtime. |

## 2. Provision pre first

Fill `.env.pre.local` from `.env.pre.local.example`; do not commit it.

Minimum database variables:

```bash
GOODS_COMM_DATABASE_URL=postgres://goods_comm_pre_app:<app-password>@pre-pg.internal.example:5432/goods_comm_pre
GOODS_COMM_DATABASE_ADMIN_URL=postgres://postgres:<admin-password>@pre-pg.internal.example:5432/postgres
GOODS_COMM_STATE_STORE=postgres
GOODS_COMM_POSTGRES_AUTO_SCHEMA=false
```

Then run:

```bash
npm run db:provision:pre:plan
GOODS_COMM_DB_PROVISION_CONFIRM=provision-pre npm run db:provision:pre
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre npm run db:migrate:pre
npm run smoke:deployed:pre
npm run smoke:deployed:pre:main
```

The backend deploy command also runs migration by default before deploying:

```bash
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre \
GOODS_COMM_DEPLOY_CONFIRM=deploy-pre \
npm run deploy:backend:pre -- --run-main-smoke
```

Only use `--skip-db-migrate` after confirming the exact same commit already migrated the target database.

## 3. Provision prod after pre passes

Fill `.env.prod.local` from `.env.prod.local.example`; do not commit it.

Minimum database variables:

```bash
GOODS_COMM_DATABASE_URL=postgres://goods_comm_prod_app:<app-password>@prod-pg.internal.example:5432/goods_comm_prod
GOODS_COMM_DATABASE_ADMIN_URL=postgres://postgres:<admin-password>@prod-pg.internal.example:5432/postgres
GOODS_COMM_STATE_STORE=postgres
GOODS_COMM_POSTGRES_AUTO_SCHEMA=false
```

Production commands require explicit opt-in:

```bash
npm run db:provision:prod:plan
GOODS_COMM_DB_PROVISION_CONFIRM=provision-prod \
GOODS_COMM_DB_PROVISION_ALLOW_PROD=true \
npm run db:provision:prod

GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-prod \
GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true \
npm run db:migrate:prod
```

Production backend deploy requires both deploy and migration opt-ins:

```bash
GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-prod \
GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true \
GOODS_COMM_DEPLOY_CONFIRM=deploy-prod \
GOODS_COMM_DEPLOY_ALLOW_PROD=true \
npm run deploy:backend:prod
```

Only run production main-flow smoke when a dedicated production test account and cleanup policy exist:

```bash
GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=true npm run smoke:deployed:prod:main
```

## 4. Prod to pre sync

Prod-to-pre sync is for realistic pre-release validation, not ad hoc local debugging.

Manual plan:

```bash
npm run sync:prod-to-pre:plan
```

Manual execution:

```bash
GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre npm run sync:prod-to-pre
```

Automated execution:

```bash
GOODS_COMM_SYNC_AUTO_ENABLED=true npm run sync:prod-to-pre:auto
```

Optional smoke after sync:

```bash
GOODS_COMM_SYNC_RUN_PRE_SMOKE=true \
GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true \
GOODS_COMM_SYNC_AUTO_ENABLED=true \
npm run sync:prod-to-pre:auto
```

The sync script uses Node `pg`, writes an audit JSONL log, anonymizes pre data after copying, and does not upload production dumps.

## 5. Acceptance gates

Database delivery is not complete until all of these are true:

1. `npm run release:inputs -- --check-only` passes for the target release.
2. `npm run db:provision:pre:plan` and `npm run db:migrate:pre:plan` show the expected target database.
3. `npm run db:provision:pre` and `npm run db:migrate:pre` succeed with real pre credentials.
4. `npm run smoke:deployed:pre` and `npm run smoke:deployed:pre:main` pass against the real pre API.
5. `npm run audit:production-readiness:strict-check` has no database or deployed smoke blockers.
6. For prod, the same checks pass with the explicit production opt-in variables.
7. `npm run sync:prod-to-pre:plan` points to distinct prod and pre databases, and manual or automated sync can complete with an audit log.

## 6. Common failure modes

| Failure | Expected protection |
| --- | --- |
| Admin URL is missing | `db:provision:*` refuses to execute with `GOODS_COMM_DATABASE_ADMIN_URL is required`. |
| Admin URL equals app URL | `db:provision:*` refuses to execute. |
| Target DB is `postgres`, `template0`, or `template1` | `db:provision:*` refuses to provision protected database names. |
| `pre` or `prod` uses file store | Provision, migration, and backend runtime reject the configuration. |
| App URL still contains placeholders | Provision, migration, deploy, release inputs, and readiness audit keep the release blocked. |
| Runtime tries to auto-create protected schema | `GOODS_COMM_POSTGRES_AUTO_SCHEMA=false` keeps schema changes in explicit migration. |

## 7. Secrets handling

- Store `.env.pre.local`, `.env.prod.local`, `.env.smoke.pre.local`, and `.env.smoke.prod.local` locally only; they are ignored by Git.
- In GitHub Actions, use `GOODS_COMM_PRE_ENV_LOCAL`, `GOODS_COMM_PROD_ENV_LOCAL`, `GOODS_COMM_PRE_SMOKE_ENV_LOCAL`, and `GOODS_COMM_PROD_SMOKE_ENV_LOCAL` as multi-line secrets.
- Keep `GOODS_COMM_DATABASE_ADMIN_URL` out of backend runtime variables after provisioning.
- Rotate app role passwords separately from admin credentials.
- Restrict database network ingress to CloudBase / Tencent service egress, CI runners used for release, and trusted operator networks.
