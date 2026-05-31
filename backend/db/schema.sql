-- goods-comm production schema for PostgreSQL / TencentDB for PostgreSQL.
-- The local Node backend uses a file store for smoke testing; production should
-- persist these same entities with transactions around item/trade state changes.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  applied_at BIGINT NOT NULL
);

INSERT INTO schema_migrations (version, name, checksum, source, applied_at)
VALUES (
  '20260531_normalized_schema',
  'goods_comm_normalized_schema',
  'baseline:backend/db/schema.sql',
  'backend/db/schema.sql',
  CAST(EXTRACT(EPOCH FROM now()) * 1000 AS BIGINT)
),
(
  '20260531_auth_session_last_seen',
  'auth_session_last_seen',
  'baseline:backend/db/schema.sql#auth_sessions.last_seen_at',
  'backend/db/schema.sql',
  CAST(EXTRACT(EPOCH FROM now()) * 1000 AS BIGINT)
),
(
  '20260531_location_risk_events',
  'location_risk_events',
  'baseline:backend/db/schema.sql#location_risk_events',
  'backend/db/schema.sql',
  CAST(EXTRACT(EPOCH FROM now()) * 1000 AS BIGINT)
)
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name,
    checksum = EXCLUDED.checksum,
    source = EXCLUDED.source;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  platform_id TEXT NOT NULL,
  union_id TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '社区用户',
  avatar_url TEXT NOT NULL DEFAULT '',
  contact_code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  agreement_version TEXT NOT NULL DEFAULT '',
  agreement_accepted_at BIGINT,
  agreement_source TEXT NOT NULL DEFAULT '',
  block_reason TEXT NOT NULL DEFAULT '',
  blocked_at BIGINT,
  blocked_by TEXT NOT NULL DEFAULT '',
  unblock_reason TEXT NOT NULL DEFAULT '',
  unblocked_at BIGINT,
  unblocked_by TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  deleted_at BIGINT,
  UNIQUE (provider, platform_id)
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE INDEX IF NOT EXISTS idx_users_agreement_version
ON users(agreement_version)
WHERE agreement_version <> '';

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_seen_at BIGINT,
  revoked_at BIGINT
);

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_seen_at BIGINT;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expires_at ON auth_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at ON auth_sessions(revoked_at);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  response JSONB NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  expires_at BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_records_scope_key
ON idempotency_records(scope, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_idempotency_records_expires_at
ON idempotency_records(expires_at);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL,
  category TEXT NOT NULL,
  condition TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  review_status TEXT NOT NULL,
  review_reasons JSONB NOT NULL DEFAULT '[]',
  cover_tone TEXT NOT NULL DEFAULT 'sage',
  trade_scope JSONB NOT NULL,
  location JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_seller_id ON items(seller_id);
CREATE INDEX IF NOT EXISTS idx_items_status_created_at ON items(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_location_community ON items((location->>'communityId'));
CREATE INDEX IF NOT EXISTS idx_items_location_street ON items((location->>'streetId'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_items_seller_active_title
ON items (seller_id, lower(trim(title)))
WHERE status IN ('pending_review', 'online', 'reserved');

CREATE TABLE IF NOT EXISTS item_images (
  id TEXT PRIMARY KEY,
  item_id TEXT REFERENCES items(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  storage_key TEXT NOT NULL DEFAULT '',
  original_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL DEFAULT '',
  moderation_trace_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_images_item_sort ON item_images(item_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_item_images_owner_id ON item_images(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_item_images_moderation_trace
ON item_images(moderation_trace_id)
WHERE moderation_trace_id <> '';

CREATE TABLE IF NOT EXISTS trade_intents (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  seller_id TEXT NOT NULL REFERENCES users(id),
  buyer_id TEXT NOT NULL REFERENCES users(id),
  item_title TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL,
  contact_code TEXT NOT NULL DEFAULT '',
  contact_code_expires_at BIGINT,
  eligibility_code TEXT NOT NULL,
  eligibility_message TEXT NOT NULL,
  location_audit JSONB NOT NULL,
  timeline JSONB NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trade_intents_item_id ON trade_intents(item_id);
CREATE INDEX IF NOT EXISTS idx_trade_intents_buyer_id ON trade_intents(buyer_id);
CREATE INDEX IF NOT EXISTS idx_trade_intents_seller_id ON trade_intents(seller_id);
CREATE INDEX IF NOT EXISTS idx_trade_intents_status ON trade_intents(status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_intents_active_buyer_item
ON trade_intents (buyer_id, item_id)
WHERE status IN ('pending_seller_confirm', 'pending_meetup');

CREATE TABLE IF NOT EXISTS trade_timeline (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL REFERENCES trade_intents(id),
  status TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  label TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trade_timeline_trade_id ON trade_timeline(trade_id, created_at);

CREATE TABLE IF NOT EXISTS trade_disputes (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL REFERENCES trade_intents(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  opener_id TEXT REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'user',
  reason TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  report_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',
  resolver_id TEXT REFERENCES users(id),
  item_title TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  resolved_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_trade_disputes_trade_id ON trade_disputes(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_disputes_status_created_at
ON trade_disputes(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_disputes_open_trade
ON trade_disputes(trade_id)
WHERE status = 'open';

CREATE TABLE IF NOT EXISTS trade_reviews (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL REFERENCES trade_intents(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  reviewee_id TEXT NOT NULL REFERENCES users(id),
  item_title TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  UNIQUE (trade_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_reviews_item_created_at
ON trade_reviews(item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_reviews_reviewee_created_at
ON trade_reviews(reviewee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS location_audits (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL REFERENCES trade_intents(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'server',
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  accuracy NUMERIC(10, 2),
  distance_meters NUMERIC(12, 2),
  radius_meters INTEGER,
  scope_type TEXT NOT NULL DEFAULT '',
  region_status TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_location_audits_trade_id ON location_audits(trade_id);
CREATE INDEX IF NOT EXISTS idx_location_audits_user_id_created_at ON location_audits(user_id, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',
  resolver_id TEXT REFERENCES users(id),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  resolved_at BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_pending_same_reason
ON reports (reporter_id, target_type, target_id, reason)
WHERE status = 'pending_review';

CREATE TABLE IF NOT EXISTS location_risk_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  accuracy NUMERIC(10, 2),
  region_community_id TEXT NOT NULL DEFAULT '',
  region_street_id TEXT NOT NULL DEFAULT '',
  captured_at BIGINT NOT NULL,
  previous_event_id TEXT,
  distance_meters NUMERIC(12, 2),
  elapsed_ms BIGINT,
  speed_mps NUMERIC(12, 2),
  risk_level TEXT NOT NULL DEFAULT 'normal',
  risk_code TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_location_risk_events_user_created_at
ON location_risk_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_location_risk_events_level_created_at
ON location_risk_events(risk_level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_location_risk_events_code_created_at
ON location_risk_events(risk_code, created_at DESC)
WHERE risk_code <> '';

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  read_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
ON notifications(user_id, read_at)
WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  trace_id TEXT NOT NULL DEFAULT '',
  last_attempt_at BIGINT,
  next_retry_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status_next_retry
ON notification_deliveries(status, next_retry_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification_id
ON notification_deliveries(notification_id);

CREATE TABLE IF NOT EXISTS moderation_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id TEXT,
  report_id TEXT REFERENCES reports(id),
  title TEXT,
  status TEXT NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  code TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL DEFAULT '',
  user_id TEXT REFERENCES users(id),
  platform TEXT NOT NULL DEFAULT '',
  app_env TEXT NOT NULL DEFAULT '',
  trace_id TEXT NOT NULL DEFAULT '',
  context JSONB NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_events_created_at
ON client_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_events_type_level
ON client_events(type, level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_events_user_created_at
ON client_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ops_audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'success',
  message TEXT NOT NULL DEFAULT '',
  trace_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  context JSONB NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_audit_events_created_at
ON ops_audit_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_audit_events_actor_created_at
ON ops_audit_events(actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_audit_events_action_created_at
ON ops_audit_events(action, created_at DESC);

CREATE TABLE IF NOT EXISTS account_deletions (
  user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

-- Legacy migration bridge kept for older deployments that briefly used the
-- JSON snapshot store before backend/src/postgres-state-store.mjs wrote the
-- normalized tables directly. New deployments should leave this table empty.
CREATE TABLE IF NOT EXISTS bff_state_snapshots (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);
