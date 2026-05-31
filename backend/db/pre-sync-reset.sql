BEGIN;

TRUNCATE TABLE
  account_deletions,
  client_events,
  idempotency_records,
  location_risk_events,
  moderation_events,
  ops_audit_events,
  notification_deliveries,
  notifications,
  reports,
  trade_reviews,
  trade_disputes,
  trade_intents,
  item_images,
  items,
  auth_sessions,
  users,
  bff_state_snapshots
RESTART IDENTITY CASCADE;

COMMIT;
