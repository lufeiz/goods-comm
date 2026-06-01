export const DEFAULT_POSTGRES_ADVISORY_LOCK_KEY = 'goods_comm_state_store_v1'
const DEFAULT_MAX_SNAPSHOT_ROWS = 20000
const PROTECTED_ENVIRONMENTS = new Set(['pre', 'prod'])

export const NORMALIZED_TABLES = [
  'schema_migrations',
  'users',
  'auth_sessions',
  'idempotency_records',
  'items',
  'item_images',
  'trade_intents',
  'trade_timeline',
  'trade_disputes',
  'trade_reviews',
  'location_audits',
  'reports',
  'location_risk_events',
  'moderation_events',
  'notifications',
  'notification_deliveries',
  'client_events',
  'ops_audit_events',
  'account_deletions'
]

export const REQUIRED_SCHEMA_MIGRATIONS = [
  {
    version: '20260531_normalized_schema',
    name: 'goods_comm_normalized_schema',
    checksum: 'baseline:backend/db/schema.sql',
    source: 'backend/db/schema.sql'
  },
  {
    version: '20260531_auth_session_last_seen',
    name: 'auth_session_last_seen',
    checksum: 'baseline:backend/db/schema.sql#auth_sessions.last_seen_at',
    source: 'backend/db/schema.sql'
  },
  {
    version: '20260531_location_risk_events',
    name: 'location_risk_events',
    checksum: 'baseline:backend/db/schema.sql#location_risk_events',
    source: 'backend/db/schema.sql'
  },
  {
    version: '20260531_location_risk_review',
    name: 'location_risk_review',
    checksum: 'baseline:backend/db/schema.sql#location_risk_events.review',
    source: 'backend/db/schema.sql'
  },
  {
    version: '20260531_account_deletion_tombstone',
    name: 'account_deletion_tombstone',
    checksum: 'baseline:backend/db/schema.sql#users.deleted_tombstone',
    source: 'backend/db/schema.sql'
  }
]

export const NORMALIZED_TABLE_COLUMN_REQUIREMENTS = {
  schema_migrations: [
    'version',
    'name',
    'checksum',
    'source',
    'applied_at'
  ],
  users: [
    'id',
    'provider',
    'platform_id',
    'union_id',
    'nickname',
    'avatar_url',
    'contact_code',
    'status',
    'agreement_version',
    'agreement_accepted_at',
    'agreement_source',
    'block_reason',
    'blocked_at',
    'blocked_by',
    'unblock_reason',
    'unblocked_at',
    'unblocked_by',
    'created_at',
    'deleted_at'
  ],
  auth_sessions: [
    'id',
    'user_id',
    'provider',
    'token_hash',
    'created_at',
    'expires_at',
    'last_seen_at',
    'revoked_at'
  ],
  idempotency_records: [
    'id',
    'scope',
    'idempotency_key',
    'method',
    'path',
    'request_hash',
    'status',
    'response',
    'created_at',
    'updated_at',
    'expires_at'
  ],
  items: [
    'id',
    'seller_id',
    'title',
    'price',
    'category',
    'condition',
    'description',
    'status',
    'review_status',
    'review_reasons',
    'cover_tone',
    'trade_scope',
    'location',
    'created_at',
    'updated_at'
  ],
  item_images: [
    'id',
    'item_id',
    'owner_id',
    'url',
    'status',
    'storage_key',
    'original_name',
    'mime_type',
    'size_bytes',
    'checksum',
    'moderation_trace_id',
    'sort_order',
    'created_at'
  ],
  trade_intents: [
    'id',
    'item_id',
    'seller_id',
    'buyer_id',
    'item_title',
    'price',
    'status',
    'contact_code',
    'contact_code_expires_at',
    'eligibility_code',
    'eligibility_message',
    'location_audit',
    'timeline',
    'created_at',
    'updated_at'
  ],
  trade_timeline: [
    'id',
    'trade_id',
    'status',
    'actor_id',
    'label',
    'created_at'
  ],
  trade_disputes: [
    'id',
    'trade_id',
    'item_id',
    'opener_id',
    'source',
    'reason',
    'description',
    'report_id',
    'status',
    'resolution',
    'resolution_note',
    'resolver_id',
    'item_title',
    'created_at',
    'updated_at',
    'resolved_at'
  ],
  trade_reviews: [
    'id',
    'trade_id',
    'item_id',
    'reviewer_id',
    'reviewee_id',
    'item_title',
    'rating',
    'content',
    'tags',
    'created_at'
  ],
  location_audits: [
    'id',
    'trade_id',
    'user_id',
    'source',
    'latitude',
    'longitude',
    'accuracy',
    'distance_meters',
    'radius_meters',
    'scope_type',
    'region_status',
    'created_at'
  ],
  reports: [
    'id',
    'reporter_id',
    'target_type',
    'target_id',
    'reason',
    'description',
    'status',
    'resolution',
    'resolution_note',
    'resolver_id',
    'created_at',
    'updated_at',
    'resolved_at'
  ],
  location_risk_events: [
    'id',
    'user_id',
    'action',
    'target_type',
    'target_id',
    'latitude',
    'longitude',
    'accuracy',
    'region_community_id',
    'region_street_id',
    'captured_at',
    'previous_event_id',
    'distance_meters',
    'elapsed_ms',
    'speed_mps',
    'risk_level',
    'risk_code',
    'review_status',
    'resolution',
    'resolution_note',
    'reviewer_id',
    'reviewed_at',
    'created_at',
    'updated_at'
  ],
  moderation_events: [
    'id',
    'actor_id',
    'target_type',
    'target_id',
    'report_id',
    'title',
    'status',
    'reasons',
    'created_at'
  ],
  notifications: [
    'id',
    'user_id',
    'type',
    'title',
    'body',
    'target_type',
    'target_id',
    'read_at',
    'created_at'
  ],
  notification_deliveries: [
    'id',
    'notification_id',
    'user_id',
    'type',
    'provider',
    'status',
    'message',
    'target_type',
    'target_id',
    'attempt_count',
    'trace_id',
    'last_attempt_at',
    'next_retry_at',
    'created_at',
    'updated_at'
  ],
  client_events: [
    'id',
    'type',
    'level',
    'code',
    'message',
    'route',
    'user_id',
    'platform',
    'app_env',
    'trace_id',
    'context',
    'created_at'
  ],
  ops_audit_events: [
    'id',
    'actor_id',
    'action',
    'target_type',
    'target_id',
    'result',
    'message',
    'trace_id',
    'source',
    'context',
    'created_at'
  ],
  account_deletions: [
    'user_id',
    'reason',
    'created_at'
  ]
}

export function countSerializedRows(rows = {}) {
  return Object.values(rows).reduce((count, value) => {
    if (Array.isArray(value)) {
      return count + value.length
    }

    if (Number.isFinite(Number(value))) {
      return count + Number(value)
    }

    return count
  }, 0)
}

export function assertSnapshotRowLimit(rows = {}, maxRows = DEFAULT_MAX_SNAPSHOT_ROWS) {
  const normalizedMaxRows = normalizeSnapshotRowLimit(maxRows)

  if (normalizedMaxRows <= 0) {
    return
  }

  const rowCount = countSerializedRows(rows)

  if (rowCount > normalizedMaxRows) {
    throw new Error(`PostgreSQL snapshot row count ${rowCount} exceeds GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS=${normalizedMaxRows}; migrate this deployment to incremental SQL writes before continuing`)
  }
}

export function normalizeSnapshotRowLimit(value = DEFAULT_MAX_SNAPSHOT_ROWS) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_MAX_SNAPSHOT_ROWS
  }

  const normalized = Number(value)

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS must be a non-negative number, got ${value}`)
  }

  return Math.floor(normalized)
}

export function normalizePostgresAdvisoryLockKey(value = DEFAULT_POSTGRES_ADVISORY_LOCK_KEY) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_POSTGRES_ADVISORY_LOCK_KEY
  }

  const normalized = String(value).trim()

  if (!normalized) {
    return DEFAULT_POSTGRES_ADVISORY_LOCK_KEY
  }

  if (normalized.length > 128) {
    throw new Error('GOODS_COMM_POSTGRES_ADVISORY_LOCK_KEY must be 128 characters or fewer')
  }

  return normalized
}

export async function acquireSnapshotRewriteLock(client, advisoryLockKey = DEFAULT_POSTGRES_ADVISORY_LOCK_KEY) {
  const normalizedLockKey = normalizePostgresAdvisoryLockKey(advisoryLockKey)

  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [normalizedLockKey]
  )
}

export function normalizePostgresAutoSchema(value = '', environment = 'dev', allowProtectedAutoSchema = false) {
  const normalizedEnvironment = normalizeStoreEnvironment(environment)
  const protectedEnvironment = PROTECTED_ENVIRONMENTS.has(normalizedEnvironment)
  const parsed = parseOptionalBoolean(value)
  const autoSchema = parsed ?? !protectedEnvironment
  const allowUnsafeProtectedAutoSchema = isTrue(allowProtectedAutoSchema) || process.env.GOODS_COMM_ALLOW_POSTGRES_AUTO_SCHEMA_IN_PROTECTED_ENV === 'true'

  if (protectedEnvironment && autoSchema && !allowUnsafeProtectedAutoSchema) {
    throw new Error('GOODS_COMM_POSTGRES_AUTO_SCHEMA must be false for pre/prod; run npm run db:migrate:pre or npm run db:migrate:prod before starting the backend')
  }

  return autoSchema
}

export function normalizeStoreEnvironment(value = 'dev') {
  return String(value || 'dev').trim().toLowerCase()
}

function parseOptionalBoolean(value = '') {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'boolean') {
    return value
  }

  const normalized = String(value).trim().toLowerCase()

  if (['true', '1', 'yes'].includes(normalized)) {
    return true
  }

  if (['false', '0', 'no'].includes(normalized)) {
    return false
  }

  throw new Error(`GOODS_COMM_POSTGRES_AUTO_SCHEMA must be true or false, got ${value}`)
}

function isTrue(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true'
}
