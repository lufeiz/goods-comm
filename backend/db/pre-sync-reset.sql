BEGIN;

TRUNCATE TABLE
  account_deletions,
  client_events,
  idempotency_records,
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
  users
RESTART IDENTITY CASCADE;

COMMIT;
