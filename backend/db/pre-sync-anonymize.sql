BEGIN;

UPDATE users
SET
  platform_id = 'pre_platform_' || substr(md5(id || ':platform'), 1, 16),
  union_id = '',
  nickname = 'pre_user_' || substr(md5(id), 1, 10),
  avatar_url = '',
  contact_code = 'pre_' || substr(md5(id || ':contact'), 1, 8);

UPDATE auth_sessions
SET
  token_hash = 'pre_revoked_' || id,
  revoked_at = COALESCE(revoked_at, created_at);

DELETE FROM idempotency_records;

UPDATE items
SET
  title = '预上线商品_' || substr(md5(id), 1, 8),
  description = '',
  review_reasons = '[]'::jsonb,
  location = location - 'latitude' - 'longitude' - 'accuracy' - 'capturedAt';

UPDATE trade_intents
SET
  item_title = '预上线交易商品',
  contact_code = '',
  contact_code_expires_at = NULL,
  location_audit = location_audit - 'latitude' - 'longitude' - 'accuracy' - 'capturedAt';

UPDATE location_audits
SET
  latitude = NULL,
  longitude = NULL,
  accuracy = NULL;

UPDATE trade_reviews
SET
  item_title = '预上线交易商品',
  content = '',
  tags = '[]'::jsonb;

UPDATE trade_disputes
SET
  item_title = '预上线争议商品',
  description = '',
  resolution_note = '';

UPDATE notifications
SET
  title = '预上线交易提醒',
  body = '',
  read_at = COALESCE(read_at, created_at);

UPDATE notification_deliveries
SET
  message = '',
  trace_id = '',
  status = CASE
    WHEN status IN ('sent', 'mock_sent') THEN 'sent'
    ELSE status
  END;

UPDATE reports
SET
  description = '',
  resolution_note = '';

UPDATE client_events
SET
  message = '',
  trace_id = '',
  context = '{}'::jsonb;

UPDATE ops_audit_events
SET
  trace_id = '',
  message = '',
  context = '{}'::jsonb;

UPDATE item_images
SET
  url = CASE
    WHEN storage_key <> '' THEN '/assets/' || storage_key
    ELSE '/assets/pre-image-placeholder.jpg'
  END,
  original_name = '';

UPDATE moderation_events
SET title = '';

UPDATE account_deletions
SET reason = '';

COMMIT;
