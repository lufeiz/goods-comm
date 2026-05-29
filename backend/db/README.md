# goods-comm database operations

`schema.sql` is the canonical PostgreSQL / TencentDB schema for all four environments.

`backend/src/postgres-state-store.mjs` uses the normalized tables in this schema for `pre/prod` state persistence. The legacy `bff_state_snapshots` table remains in `schema.sql` only as a migration bridge for older test deployments and should stay empty in new deployments.

Environment rules:

- `dev` uses `goods_comm_dev`.
- `test` uses `goods_comm_test`.
- `pre` uses `goods_comm_pre`.
- `prod` uses `goods_comm_prod`.
- `pre` and `prod` must never share the same database or object storage bucket.
- `pre` and `prod` must run the same schema version before a release candidate is validated.
- `pre` and `prod` must keep `GOODS_COMM_POSTGRES_AUTO_SCHEMA=false`; backend readiness validates this schema instead of creating tables at runtime.

Prod to pre data sync:

```bash
npm run sync:prod-to-pre:plan
GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre npm run sync:prod-to-pre
```

The execute path dumps prod, resets pre, restores data into pre, then runs `pre-sync-anonymize.sql` to revoke sessions, clear one-time trade contact codes, delete production idempotency replay records, anonymize trade review text/tags, clear dispute descriptions/resolution notes, clear report descriptions/resolution notes, mark restored notifications read, clear notification delivery messages/trace IDs, clear client telemetry messages/context/trace IDs, and remove direct contact data.
