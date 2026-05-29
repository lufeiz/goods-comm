BEGIN;

UPDATE users
SET
  nickname = 'pre_user_' || substr(md5(id), 1, 10),
  avatar_url = '',
  contact_code = 'pre_' || substr(md5(id || ':contact'), 1, 8);

UPDATE auth_sessions
SET
  token_hash = 'pre_revoked_' || id,
  revoked_at = COALESCE(revoked_at, created_at);

DELETE FROM idempotency_records;

UPDATE trade_intents
SET
  contact_code = '',
  contact_code_expires_at = NULL;

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
SET url = CASE
  WHEN storage_key <> '' THEN '/assets/' || storage_key
  ELSE url
END;

COMMIT;
