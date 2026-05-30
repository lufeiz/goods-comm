import { createBffState } from '../../src/bff/handler.js'
import { normalizeState } from './file-state-store.mjs'

export const DEFAULT_POSTGRES_ADVISORY_LOCK_KEY = 'goods_comm_state_store_v1'
const DEFAULT_MAX_SNAPSHOT_ROWS = 20000
const PROTECTED_ENVIRONMENTS = new Set(['pre', 'prod'])
const NORMALIZED_TABLES = [
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
  'moderation_events',
  'notifications',
  'notification_deliveries',
  'client_events',
  'ops_audit_events',
  'account_deletions'
]
export const NORMALIZED_TABLE_COLUMN_REQUIREMENTS = {
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

export class PostgresStateStore {
  constructor(databaseUrl, options = {}) {
    if (!databaseUrl) {
      throw new Error('GOODS_COMM_DATABASE_URL is required when GOODS_COMM_STATE_STORE=postgres')
    }

    this.databaseUrl = databaseUrl
    this.seedItems = options.seedItems
    this.environment = normalizeStoreEnvironment(options.environment || process.env.GOODS_COMM_ENV || 'dev')
    this.maxSnapshotRows = normalizeSnapshotRowLimit(options.maxSnapshotRows ?? process.env.GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS)
    this.advisoryLockKey = normalizePostgresAdvisoryLockKey(options.advisoryLockKey ?? process.env.GOODS_COMM_POSTGRES_ADVISORY_LOCK_KEY)
    this.autoSchema = normalizePostgresAutoSchema(options.autoSchema ?? process.env.GOODS_COMM_POSTGRES_AUTO_SCHEMA, this.environment, options.allowUnsafeAutoSchema)
    this.pool = null
    this.productionSafe = true
  }

  async transact(callback) {
    const pool = await this.getPool()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await prepareNormalizedSchema(client, this)
      await acquireSnapshotRewriteLock(client, this.advisoryLockKey)

      const state = await loadNormalizedState(client, this.seedItems)
      let result
      let capturedError

      try {
        result = await callback(state)
      } catch (error) {
        if (!shouldCommitStateOnError(error)) {
          throw error
        }

        capturedError = error
      }

      const rows = serializeStateToRows(state, this.seedItems)

      assertSnapshotRowLimit(rows, this.maxSnapshotRows)
      await saveNormalizedRows(client, rows)
      await client.query('COMMIT')

      if (capturedError) {
        throw capturedError
      }

      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async check() {
    const pool = await this.getPool()
    const client = await pool.connect()

    try {
      await prepareNormalizedSchema(client, this)
      await client.query('SELECT 1')
      const rowCounts = await countNormalizedRows(client)

      return {
        ok: true,
        type: 'postgres',
        mode: 'normalized_snapshot_rewrite',
        autoSchema: this.autoSchema,
        currentRowCount: countSerializedRows(rowCounts),
        snapshotRowLimit: this.maxSnapshotRows,
        snapshotWriteLock: 'pg_advisory_xact_lock',
        rowCounts
      }
    } finally {
      client.release()
    }
  }

  async getPool() {
    if (this.pool) {
      return this.pool
    }

    let pg

    try {
      pg = await import('pg')
    } catch (error) {
      throw new Error('PostgreSQL runtime dependency missing: install package "pg" in the backend artifact before using GOODS_COMM_STATE_STORE=postgres')
    }

    const Pool = pg.Pool || pg.default?.Pool

    if (!Pool) {
      throw new Error('PostgreSQL runtime dependency "pg" did not expose Pool')
    }

    this.pool = new Pool({
      connectionString: this.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    })

    return this.pool
  }
}

function shouldCommitStateOnError(error = {}) {
  return error?.commitStateOnError === true
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

function normalizeStoreEnvironment(value = 'dev') {
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

export function serializeStateToRows(state = {}, seedItems) {
  const normalized = normalizeState(state, seedItems)
  const usersById = new Map()

  for (const user of normalized.users) {
    ensureRowUser(usersById, user, user.id)
  }

  const itemRows = normalized.items
    .map((item) => {
      const seller = ensureRowUser(usersById, item.seller, item.seller?.id || `seed_seller_${item.id}`, {
        provider: item.seller?.id ? 'unknown' : 'seed',
        platformId: item.seller?.id || `seed:${item.id}`
      })

      if (!seller) {
        return null
      }

      return {
        id: item.id,
        sellerId: seller.id,
        title: item.title || '',
        price: toNumber(item.price, 0),
        category: item.category || '',
        condition: item.condition || '',
        description: item.description || '',
        status: item.status || 'online',
        reviewStatus: item.reviewStatus || 'seed',
        reviewReasons: toArray(item.reviewReasons),
        coverTone: item.coverTone || 'sage',
        tradeScope: item.tradeScope || {},
        location: item.location || {},
        createdAt: toInteger(item.createdAt, Date.now()),
        updatedAt: toInteger(item.updatedAt || item.createdAt, Date.now())
      }
    })
    .filter(Boolean)

  const itemImageRows = []
  const attachedImageIds = new Set()
  for (const item of normalized.items) {
    for (const [index, image] of toArray(item.images).entries()) {
      const owner = ensureRowUser(usersById, image.owner || item.seller, image.ownerId || item.seller?.id || `seed_seller_${item.id}`)

      if (!owner) {
        continue
      }

      itemImageRows.push(imageToRow(image, {
        id: image.id || `${item.id}_image_${index + 1}`,
        itemId: item.id,
        ownerId: owner.id,
        sortOrder: index
      }))
      attachedImageIds.add(image.id || `${item.id}_image_${index + 1}`)
    }
  }

  for (const upload of normalized.uploads) {
    if (attachedImageIds.has(upload.id)) {
      continue
    }

    const owner = ensureRowUser(usersById, upload.owner, upload.ownerId)

    if (!owner) {
      continue
    }

    itemImageRows.push(imageToRow(upload, {
      id: upload.id,
      itemId: null,
      ownerId: owner.id,
      sortOrder: 0
    }))
  }

  const tradeRows = normalized.trades
    .map((trade) => {
      const seller = ensureRowUser(usersById, trade.seller, trade.seller?.id)
      const buyer = ensureRowUser(usersById, trade.buyer, trade.buyer?.id)

      if (!seller || !buyer) {
        return null
      }

      return {
        id: trade.id,
        itemId: trade.itemId,
        sellerId: seller.id,
        buyerId: buyer.id,
        itemTitle: trade.itemTitle || '',
        price: toNumber(trade.price, 0),
        status: trade.status || 'pending_seller_confirm',
        contactCode: trade.contactCode || '',
        contactCodeExpiresAt: nullableInteger(trade.contactCodeExpiresAt),
        eligibilityCode: trade.eligibilityCode || '',
        eligibilityMessage: trade.eligibilityMessage || '',
        locationAudit: trade.locationAudit || {},
        timeline: toArray(trade.timeline),
        createdAt: toInteger(trade.createdAt, Date.now()),
        updatedAt: toInteger(trade.updatedAt || trade.createdAt, Date.now())
      }
    })
    .filter(Boolean)
  const tradeRowsById = new Map(tradeRows.map((trade) => [trade.id, trade]))
  const tradeTimelineRows = []
  const locationAuditRows = []

  for (const trade of normalized.trades) {
    const row = tradeRowsById.get(trade.id)

    if (!row) {
      continue
    }

    for (const [index, event] of toArray(trade.timeline).entries()) {
      tradeTimelineRows.push({
        id: event.id || `${trade.id}_timeline_${index + 1}`,
        tradeId: trade.id,
        status: event.status || trade.status || '',
        actorId: knownUserId(usersById, event.actorId),
        label: event.label || '',
        createdAt: toInteger(event.at ?? event.createdAt, row.createdAt)
      })
    }

    locationAuditRows.push({
      id: trade.locationAudit?.id || `${trade.id}_location_audit`,
      tradeId: trade.id,
      userId: row.buyerId,
      source: trade.locationAudit?.source || 'server',
      latitude: nullableNumber(trade.locationAudit?.latitude),
      longitude: nullableNumber(trade.locationAudit?.longitude),
      accuracy: nullableNumber(trade.locationAudit?.accuracy),
      distanceMeters: nullableNumber(trade.locationAudit?.distanceMeters),
      radiusMeters: nullableInteger(trade.locationAudit?.radiusMeters),
      scopeType: trade.locationAudit?.scopeType || '',
      regionStatus: trade.locationAudit?.regionStatus || '',
      createdAt: toInteger(trade.locationAudit?.capturedAt ?? trade.createdAt, row.createdAt)
    })
  }

  const disputeRows = normalized.disputeCases
    .map((disputeCase) => ({
      id: disputeCase.id,
      tradeId: disputeCase.tradeId || '',
      itemId: disputeCase.itemId || '',
      itemTitle: disputeCase.itemTitle || '',
      openerId: knownUserId(usersById, disputeCase.opener?.id),
      source: disputeCase.source || 'user',
      reason: disputeCase.reason || '',
      description: disputeCase.description || '',
      reportId: disputeCase.reportId || null,
      status: disputeCase.status || 'open',
      resolution: disputeCase.resolution || '',
      resolutionNote: disputeCase.resolutionNote || '',
      resolverId: knownUserId(usersById, disputeCase.resolverId),
      createdAt: toInteger(disputeCase.createdAt, Date.now()),
      updatedAt: toInteger(disputeCase.updatedAt || disputeCase.createdAt, Date.now()),
      resolvedAt: nullableInteger(disputeCase.resolvedAt)
    }))
    .filter((disputeCase) => disputeCase?.id && disputeCase.tradeId && disputeCase.itemId)

  const reviewRows = normalized.reviews
    .map((review) => {
      const reviewer = ensureRowUser(usersById, review.reviewer, review.reviewer?.id)
      const reviewee = ensureRowUser(usersById, review.reviewee, review.reviewee?.id)

      if (!reviewer || !reviewee) {
        return null
      }

      return {
        id: review.id,
        tradeId: review.tradeId || '',
        itemId: review.itemId || '',
        reviewerId: reviewer.id,
        revieweeId: reviewee.id,
        itemTitle: review.itemTitle || '',
        rating: toInteger(review.rating, 0),
        content: review.content || '',
        tags: toArray(review.tags),
        createdAt: toInteger(review.createdAt, Date.now())
      }
    })
    .filter((review) => review?.id && review.tradeId && review.itemId && review.rating >= 1 && review.rating <= 5)

  const reportRows = normalized.reports
    .map((report) => {
      const reporter = ensureRowUser(usersById, report.reporter, report.reporter?.id)

      if (!reporter) {
        return null
      }

      return {
        id: report.id,
        reporterId: reporter.id,
        targetType: report.targetType || '',
        targetId: report.targetId || '',
        reason: report.reason || '',
        description: report.description || '',
        status: report.status || 'pending_review',
        resolution: report.resolution || '',
        resolutionNote: report.resolutionNote || '',
        resolverId: knownUserId(usersById, report.resolverId),
        createdAt: toInteger(report.createdAt, Date.now()),
        updatedAt: toInteger(report.updatedAt || report.createdAt, Date.now()),
        resolvedAt: nullableInteger(report.resolvedAt)
      }
    })
    .filter(Boolean)

  const notificationRows = normalized.notifications
    .map((notification) => {
      const userId = knownUserId(usersById, notification.userId)

      if (!userId) {
        return null
      }

      return {
        id: notification.id,
        userId,
        type: notification.type || 'trade',
        title: notification.title || '',
        body: notification.body || '',
        targetType: notification.targetType || '',
        targetId: notification.targetId || '',
        readAt: nullableInteger(notification.readAt),
        createdAt: toInteger(notification.createdAt, Date.now())
      }
    })
    .filter(Boolean)
  const notificationIds = new Set(notificationRows.map((notification) => notification.id))

  const notificationDeliveryRows = normalized.notificationDeliveries
    .map((delivery) => {
      const userId = knownUserId(usersById, delivery.userId)

      if (!userId || !notificationIds.has(delivery.notificationId)) {
        return null
      }

      return {
        id: delivery.id,
        notificationId: delivery.notificationId || '',
        userId,
        type: delivery.type || '',
        provider: delivery.provider || '',
        status: delivery.status || 'pending',
        message: delivery.message || '',
        targetType: delivery.targetType || '',
        targetId: delivery.targetId || '',
        attemptCount: toInteger(delivery.attemptCount, 0),
        traceId: delivery.traceId || '',
        lastAttemptAt: nullableInteger(delivery.lastAttemptAt),
        nextRetryAt: nullableInteger(delivery.nextRetryAt),
        createdAt: toInteger(delivery.createdAt, Date.now()),
        updatedAt: toInteger(delivery.updatedAt, Date.now())
      }
    })
    .filter((delivery) => delivery?.id && delivery.notificationId)

  const moderationEventRows = normalized.moderationEvents.map((event) => ({
    id: event.id,
    actorId: knownUserId(usersById, event.actorId),
    targetType: event.targetType || '',
    targetId: event.targetId || null,
    reportId: event.reportId || null,
    title: event.title || null,
    status: event.status || '',
    reasons: toArray(event.reasons),
    createdAt: toInteger(event.createdAt, Date.now())
  }))

  const clientEventRows = toArray(normalized.clientEvents)
    .map((event) => ({
      id: event.id,
      type: event.type || '',
      level: event.level || 'info',
      code: event.code || '',
      message: event.message || '',
      route: event.route || '',
      userId: knownUserId(usersById, event.userId),
      platform: event.platform || '',
      appEnv: event.appEnv || '',
      traceId: event.traceId || '',
      context: event.context || {},
      createdAt: toInteger(event.createdAt, Date.now())
    }))
    .filter((event) => event?.id && event.type)

  const opsAuditEventRows = toArray(normalized.opsAuditEvents)
    .map((event) => ({
      id: event.id,
      actorId: event.actorId || '',
      action: event.action || '',
      targetType: event.targetType || '',
      targetId: event.targetId || '',
      result: event.result || 'success',
      message: event.message || '',
      traceId: event.traceId || '',
      source: event.source || '',
      context: event.context || {},
      createdAt: toInteger(event.createdAt, Date.now())
    }))
    .filter((event) => event?.id && event.action)

  const accountDeletionRows = normalized.accountDeletions
    .map((deletion) => {
      const user = ensureRowUser(usersById, null, deletion.userId)

      if (!user) {
        return null
      }

      return {
        userId: user.id,
        reason: deletion.reason || '',
        createdAt: toInteger(deletion.createdAt, Date.now())
      }
    })
    .filter(Boolean)

  const sessionRows = normalized.sessions
    .map((session) => {
      const user = usersById.get(session.userId)

      if (!user) {
        return null
      }

      return {
        id: session.id,
        userId: user.id,
        provider: session.provider || user.provider || '',
        tokenHash: session.tokenHash || '',
        createdAt: toInteger(session.createdAt, Date.now()),
        expiresAt: toInteger(session.expiresAt, Date.now()),
        revokedAt: nullableInteger(session.revokedAt)
      }
    })
    .filter((session) => session?.id && session.tokenHash)
  const idempotencyRows = normalized.idempotencyRecords
    .map((record) => ({
      id: record.id,
      scope: record.scope || '',
      key: record.key || '',
      method: record.method || '',
      path: record.path || '',
      requestHash: record.requestHash || '',
      status: record.status || 'completed',
      response: record.response || {},
      createdAt: toInteger(record.createdAt, Date.now()),
      updatedAt: toInteger(record.updatedAt || record.createdAt, Date.now()),
      expiresAt: nullableInteger(record.expiresAt)
    }))
    .filter((record) => record?.id && record.scope && record.key && record.method && record.path && record.requestHash)

  return {
    users: [...usersById.values()],
    sessions: sessionRows,
    idempotencyRecords: idempotencyRows,
    items: itemRows,
    itemImages: itemImageRows,
    trades: tradeRows,
    tradeTimeline: tradeTimelineRows,
    locationAudits: locationAuditRows,
    disputeCases: disputeRows,
    reviews: reviewRows,
    reports: reportRows,
    notifications: notificationRows,
    notificationDeliveries: notificationDeliveryRows,
    moderationEvents: moderationEventRows,
    clientEvents: clientEventRows,
    opsAuditEvents: opsAuditEventRows,
    accountDeletions: accountDeletionRows
  }
}

export function deserializeRowsToState(rows = {}, seedItems) {
  const users = toArray(rows.users).map(rowToUser)
  const usersById = new Map(users.map((user) => [user.id, user]))
  const imageRows = toArray(rows.itemImages)
  const imagesByItemId = new Map()

  for (const row of imageRows) {
    if (!row.item_id && !row.itemId) {
      continue
    }

    const itemId = row.item_id || row.itemId
    const images = imagesByItemId.get(itemId) || []
    images.push(rowToImage(row))
    imagesByItemId.set(itemId, images)
  }

  const items = toArray(rows.items).map((row) => {
    const itemId = row.id
    const seller = usersById.get(row.seller_id || row.sellerId) || {}

    return {
      id: itemId,
      title: row.title || '',
      price: toNumber(row.price, 0),
      category: row.category || '',
      condition: row.condition || '',
      description: row.description || '',
      seller: userForItem(seller),
      images: imagesByItemId.get(itemId) || [],
      coverTone: row.cover_tone || row.coverTone || 'sage',
      tradeScope: parseJsonValue(row.trade_scope ?? row.tradeScope, {}),
      location: parseJsonValue(row.location, {}),
      status: row.status || 'online',
      reviewStatus: row.review_status || row.reviewStatus || 'seed',
      reviewReasons: parseJsonValue(row.review_reasons ?? row.reviewReasons, []),
      createdAt: toInteger(row.created_at ?? row.createdAt, Date.now()),
      updatedAt: toInteger(row.updated_at ?? row.updatedAt, Date.now())
    }
  })

  const uploads = imageRows
    .filter((row) => !(row.item_id || row.itemId))
    .map((row) => ({
      ...rowToImage(row),
      ownerId: row.owner_id || row.ownerId || ''
    }))

  const timelineByTradeId = groupRowsByKey(rows.tradeTimeline, (row) => row.trade_id || row.tradeId)
  const auditsByTradeId = groupRowsByKey(rows.locationAudits, (row) => row.trade_id || row.tradeId)
  const trades = toArray(rows.trades).map((row) => ({
    id: row.id,
    itemId: row.item_id || row.itemId || '',
    itemTitle: row.item_title || row.itemTitle || '',
    price: toNumber(row.price, 0),
    seller: userForTrade(usersById.get(row.seller_id || row.sellerId) || {}),
    buyer: userForTrade(usersById.get(row.buyer_id || row.buyerId) || {}),
    contactCode: row.contact_code || row.contactCode || '',
    contactCodeExpiresAt: nullableInteger(row.contact_code_expires_at ?? row.contactCodeExpiresAt),
    status: row.status || 'pending_seller_confirm',
    eligibilityCode: row.eligibility_code || row.eligibilityCode || '',
    eligibilityMessage: row.eligibility_message || row.eligibilityMessage || '',
    locationAudit: auditRowsToLocationAudit(auditsByTradeId.get(row.id), row),
    timeline: timelineRowsToEvents(timelineByTradeId.get(row.id), row),
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now()),
    updatedAt: toInteger(row.updated_at ?? row.updatedAt, Date.now())
  }))

  const reports = toArray(rows.reports).map((row) => ({
    id: row.id,
    reporter: userForTrade(usersById.get(row.reporter_id || row.reporterId) || {}),
    targetType: row.target_type || row.targetType || '',
    targetId: row.target_id || row.targetId || '',
    reason: row.reason || '',
    description: row.description || '',
    status: row.status || 'pending_review',
    resolution: row.resolution || '',
    resolutionNote: row.resolution_note || row.resolutionNote || '',
    resolverId: row.resolver_id || row.resolverId || '',
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now()),
    updatedAt: toInteger(row.updated_at ?? row.updatedAt, Date.now()),
    resolvedAt: nullableInteger(row.resolved_at ?? row.resolvedAt)
  }))

  const disputeCases = toArray(rows.disputeCases).map((row) => ({
    id: row.id || '',
    tradeId: row.trade_id || row.tradeId || '',
    itemId: row.item_id || row.itemId || '',
    itemTitle: row.item_title || row.itemTitle || '',
    opener: userForTrade(usersById.get(row.opener_id || row.openerId) || {}),
    source: row.source || 'user',
    reason: row.reason || '',
    description: row.description || '',
    reportId: row.report_id || row.reportId || '',
    status: row.status || 'open',
    resolution: row.resolution || '',
    resolutionNote: row.resolution_note || row.resolutionNote || '',
    resolverId: row.resolver_id || row.resolverId || '',
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now()),
    updatedAt: toInteger(row.updated_at ?? row.updatedAt, Date.now()),
    resolvedAt: nullableInteger(row.resolved_at ?? row.resolvedAt)
  }))

  const reviews = toArray(rows.reviews).map((row) => ({
    id: row.id || '',
    tradeId: row.trade_id || row.tradeId || '',
    itemId: row.item_id || row.itemId || '',
    itemTitle: row.item_title || row.itemTitle || '',
    reviewer: userForTrade(usersById.get(row.reviewer_id || row.reviewerId) || {}),
    reviewee: userForTrade(usersById.get(row.reviewee_id || row.revieweeId) || {}),
    rating: toInteger(row.rating, 0),
    content: row.content || '',
    tags: parseJsonValue(row.tags, []),
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now())
  }))

  const notifications = toArray(rows.notifications).map((row) => ({
    id: row.id,
    userId: row.user_id || row.userId || '',
    type: row.type || 'trade',
    title: row.title || '',
    body: row.body || '',
    targetType: row.target_type || row.targetType || '',
    targetId: row.target_id || row.targetId || '',
    readAt: nullableInteger(row.read_at ?? row.readAt),
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now())
  }))

  const notificationDeliveries = toArray(rows.notificationDeliveries).map((row) => ({
    id: row.id || '',
    notificationId: row.notification_id || row.notificationId || '',
    userId: row.user_id || row.userId || '',
    type: row.type || '',
    provider: row.provider || '',
    status: row.status || 'pending',
    message: row.message || '',
    targetType: row.target_type || row.targetType || '',
    targetId: row.target_id || row.targetId || '',
    attemptCount: toInteger(row.attempt_count ?? row.attemptCount, 0),
    traceId: row.trace_id || row.traceId || '',
    lastAttemptAt: nullableInteger(row.last_attempt_at ?? row.lastAttemptAt),
    nextRetryAt: nullableInteger(row.next_retry_at ?? row.nextRetryAt),
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now()),
    updatedAt: toInteger(row.updated_at ?? row.updatedAt, Date.now())
  }))

  const sessions = toArray(rows.sessions).map((row) => ({
    id: row.id,
    tokenHash: row.token_hash || row.tokenHash || '',
    userId: row.user_id || row.userId || '',
    provider: row.provider || '',
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now()),
    expiresAt: toInteger(row.expires_at ?? row.expiresAt, Date.now()),
    revokedAt: nullableInteger(row.revoked_at ?? row.revokedAt)
  }))

  const idempotencyRecords = toArray(rows.idempotencyRecords).map((row) => ({
    id: row.id || '',
    scope: row.scope || '',
    key: row.idempotency_key || row.key || '',
    method: row.method || '',
    path: row.path || '',
    requestHash: row.request_hash || row.requestHash || '',
    status: row.status || 'completed',
    response: parseJsonValue(row.response, {}),
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now()),
    updatedAt: toInteger(row.updated_at ?? row.updatedAt, Date.now()),
    expiresAt: nullableInteger(row.expires_at ?? row.expiresAt)
  }))

  const moderationEvents = toArray(rows.moderationEvents).map((row) => ({
    id: row.id,
    actorId: row.actor_id || row.actorId || '',
    targetType: row.target_type || row.targetType || '',
    targetId: row.target_id || row.targetId || '',
    reportId: row.report_id || row.reportId || '',
    title: row.title || '',
    status: row.status || '',
    reasons: parseJsonValue(row.reasons, []),
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now())
  }))

  const clientEvents = toArray(rows.clientEvents).map((row) => ({
    id: row.id || '',
    type: row.type || '',
    level: row.level || 'info',
    code: row.code || '',
    message: row.message || '',
    route: row.route || '',
    userId: row.user_id || row.userId || '',
    platform: row.platform || '',
    appEnv: row.app_env || row.appEnv || '',
    traceId: row.trace_id || row.traceId || '',
    context: parseJsonValue(row.context, {}),
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now())
  }))

  const opsAuditEvents = toArray(rows.opsAuditEvents).map((row) => ({
    id: row.id || '',
    actorId: row.actor_id || row.actorId || '',
    action: row.action || '',
    targetType: row.target_type || row.targetType || '',
    targetId: row.target_id || row.targetId || '',
    result: row.result || 'success',
    message: row.message || '',
    traceId: row.trace_id || row.traceId || '',
    source: row.source || '',
    context: parseJsonValue(row.context, {}),
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now())
  }))

  const accountDeletions = toArray(rows.accountDeletions).map((row) => ({
    userId: row.user_id || row.userId || '',
    reason: row.reason || '',
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now())
  }))

  const loadedState = normalizeState({
    users,
    sessions,
    idempotencyRecords,
    items,
    trades,
    disputeCases,
    reviews,
    uploads,
    reports,
    notifications,
    notificationDeliveries,
    moderationEvents,
    clientEvents,
    opsAuditEvents,
    accountDeletions
  }, [])

  const hasRows = users.length ||
    sessions.length ||
    idempotencyRecords.length ||
    items.length ||
    trades.length ||
    toArray(rows.tradeTimeline).length ||
    toArray(rows.locationAudits).length ||
    uploads.length ||
    reports.length ||
    disputeCases.length ||
    reviews.length ||
    notifications.length ||
    notificationDeliveries.length ||
    moderationEvents.length ||
    clientEvents.length ||
    opsAuditEvents.length ||
    accountDeletions.length

  return hasRows ? loadedState : createBffState(seedItems)
}

async function loadNormalizedState(client, seedItems) {
  const users = await client.query('SELECT * FROM users ORDER BY created_at ASC')
  const sessions = await client.query('SELECT * FROM auth_sessions ORDER BY created_at DESC')
  const idempotencyRecords = await client.query('SELECT * FROM idempotency_records ORDER BY updated_at DESC')
  const items = await client.query('SELECT * FROM items ORDER BY created_at DESC')
  const itemImages = await client.query('SELECT * FROM item_images ORDER BY item_id NULLS FIRST, sort_order ASC, created_at ASC')
  const trades = await client.query('SELECT * FROM trade_intents ORDER BY created_at DESC')
  const tradeTimeline = await client.query('SELECT * FROM trade_timeline ORDER BY trade_id, created_at ASC')
  const locationAudits = await client.query('SELECT * FROM location_audits ORDER BY trade_id, created_at DESC')
  const reports = await client.query('SELECT * FROM reports ORDER BY created_at DESC')
  const disputeCases = await client.query('SELECT * FROM trade_disputes ORDER BY created_at DESC')
  const reviews = await client.query('SELECT * FROM trade_reviews ORDER BY created_at DESC')
  const notifications = await client.query('SELECT * FROM notifications ORDER BY created_at DESC')
  const notificationDeliveries = await client.query('SELECT * FROM notification_deliveries ORDER BY updated_at DESC, created_at DESC')
  const moderationEvents = await client.query('SELECT * FROM moderation_events ORDER BY created_at DESC')
  const clientEvents = await client.query('SELECT * FROM client_events ORDER BY created_at DESC LIMIT 1000')
  const opsAuditEvents = await client.query('SELECT * FROM ops_audit_events ORDER BY created_at DESC LIMIT 2000')
  const accountDeletions = await client.query('SELECT * FROM account_deletions ORDER BY created_at DESC')

  return deserializeRowsToState({
    users: users.rows,
    sessions: sessions.rows,
    idempotencyRecords: idempotencyRecords.rows,
    items: items.rows,
    itemImages: itemImages.rows,
    trades: trades.rows,
    tradeTimeline: tradeTimeline.rows,
    locationAudits: locationAudits.rows,
    reports: reports.rows,
    disputeCases: disputeCases.rows,
    reviews: reviews.rows,
    notifications: notifications.rows,
    notificationDeliveries: notificationDeliveries.rows,
    moderationEvents: moderationEvents.rows,
    clientEvents: clientEvents.rows,
    opsAuditEvents: opsAuditEvents.rows,
    accountDeletions: accountDeletions.rows
  }, seedItems)
}

async function countNormalizedRows(client) {
  const tableNames = [
    ['users', 'users'],
    ['sessions', 'auth_sessions'],
    ['idempotencyRecords', 'idempotency_records'],
    ['items', 'items'],
    ['itemImages', 'item_images'],
    ['trades', 'trade_intents'],
    ['tradeTimeline', 'trade_timeline'],
    ['locationAudits', 'location_audits'],
    ['reports', 'reports'],
    ['disputeCases', 'trade_disputes'],
    ['reviews', 'trade_reviews'],
    ['notifications', 'notifications'],
    ['notificationDeliveries', 'notification_deliveries'],
    ['moderationEvents', 'moderation_events'],
    ['clientEvents', 'client_events'],
    ['opsAuditEvents', 'ops_audit_events'],
    ['accountDeletions', 'account_deletions']
  ]
  const counts = {}

  for (const [key, tableName] of tableNames) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`)
    counts[key] = Number(result.rows?.[0]?.count || 0)
  }

  return counts
}

async function saveNormalizedState(client, state, seedItems) {
  const rows = serializeStateToRows(state, seedItems)

  await saveNormalizedRows(client, rows)
}

async function saveNormalizedRows(client, rows) {
  await deleteBusinessRows(client)

  for (const user of rows.users) {
    await client.query(
      `INSERT INTO users (
        id, provider, platform_id, union_id, nickname, avatar_url, contact_code, status,
        agreement_version, agreement_accepted_at, agreement_source,
        block_reason, blocked_at, blocked_by, unblock_reason, unblocked_at, unblocked_by,
        created_at, deleted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        user.id,
        user.provider,
        user.platformId,
        user.unionId,
        user.nickname,
        user.avatarUrl,
        user.contactCode,
        user.status,
        user.agreementVersion,
        user.agreementAcceptedAt,
        user.agreementSource,
        user.blockReason,
        user.blockedAt,
        user.blockedBy,
        user.unblockReason,
        user.unblockedAt,
        user.unblockedBy,
        user.createdAt,
        user.deletedAt
      ]
    )
  }

  for (const session of rows.sessions) {
    await client.query(
      `INSERT INTO auth_sessions (
        id, user_id, provider, token_hash, created_at, expires_at, revoked_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        session.id,
        session.userId,
        session.provider,
        session.tokenHash,
        session.createdAt,
        session.expiresAt,
        session.revokedAt
      ]
    )
  }

  for (const record of rows.idempotencyRecords) {
    await client.query(
      `INSERT INTO idempotency_records (
        id, scope, idempotency_key, method, path, request_hash, status, response,
        created_at, updated_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
      [
        record.id,
        record.scope,
        record.key,
        record.method,
        record.path,
        record.requestHash,
        record.status,
        JSON.stringify(record.response),
        record.createdAt,
        record.updatedAt,
        record.expiresAt
      ]
    )
  }

  for (const item of rows.items) {
    await client.query(
      `INSERT INTO items (
        id, seller_id, title, price, category, condition, description, status, review_status,
        review_reasons, cover_tone, trade_scope, location, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb, $14, $15)`,
      [
        item.id,
        item.sellerId,
        item.title,
        item.price,
        item.category,
        item.condition,
        item.description,
        item.status,
        item.reviewStatus,
        JSON.stringify(item.reviewReasons),
        item.coverTone,
        JSON.stringify(item.tradeScope),
        JSON.stringify(item.location),
        item.createdAt,
        item.updatedAt
      ]
    )
  }

  for (const image of rows.itemImages) {
    await client.query(
      `INSERT INTO item_images (
        id, item_id, owner_id, url, status, storage_key, original_name, mime_type, size_bytes,
        checksum, moderation_trace_id, sort_order, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        image.id,
        image.itemId,
        image.ownerId,
        image.url,
        image.status,
        image.storageKey,
        image.originalName,
        image.mimeType,
        image.sizeBytes,
        image.checksum,
        image.moderationTraceId,
        image.sortOrder,
        image.createdAt
      ]
    )
  }

  for (const trade of rows.trades) {
    await client.query(
      `INSERT INTO trade_intents (
        id, item_id, seller_id, buyer_id, item_title, price, status, contact_code,
        contact_code_expires_at, eligibility_code, eligibility_message, location_audit, timeline, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15)`,
      [
        trade.id,
        trade.itemId,
        trade.sellerId,
        trade.buyerId,
        trade.itemTitle,
        trade.price,
        trade.status,
        trade.contactCode,
        trade.contactCodeExpiresAt,
        trade.eligibilityCode,
        trade.eligibilityMessage,
        JSON.stringify(trade.locationAudit),
        JSON.stringify(trade.timeline),
        trade.createdAt,
        trade.updatedAt
      ]
    )
  }

  for (const event of rows.tradeTimeline) {
    await client.query(
      `INSERT INTO trade_timeline (
        id, trade_id, status, actor_id, label, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.id,
        event.tradeId,
        event.status,
        event.actorId,
        event.label,
        event.createdAt
      ]
    )
  }

  for (const audit of rows.locationAudits) {
    await client.query(
      `INSERT INTO location_audits (
        id, trade_id, user_id, source, latitude, longitude, accuracy, distance_meters,
        radius_meters, scope_type, region_status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        audit.id,
        audit.tradeId,
        audit.userId,
        audit.source,
        audit.latitude,
        audit.longitude,
        audit.accuracy,
        audit.distanceMeters,
        audit.radiusMeters,
        audit.scopeType,
        audit.regionStatus,
        audit.createdAt
      ]
    )
  }

  for (const disputeCase of rows.disputeCases) {
    await client.query(
      `INSERT INTO trade_disputes (
        id, trade_id, item_id, opener_id, source, reason, description, report_id, status,
        resolution, resolution_note, resolver_id, item_title, created_at, updated_at, resolved_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        disputeCase.id,
        disputeCase.tradeId,
        disputeCase.itemId,
        disputeCase.openerId,
        disputeCase.source,
        disputeCase.reason,
        disputeCase.description,
        disputeCase.reportId,
        disputeCase.status,
        disputeCase.resolution,
        disputeCase.resolutionNote,
        disputeCase.resolverId,
        disputeCase.itemTitle,
        disputeCase.createdAt,
        disputeCase.updatedAt,
        disputeCase.resolvedAt
      ]
    )
  }

  for (const review of rows.reviews) {
    await client.query(
      `INSERT INTO trade_reviews (
        id, trade_id, item_id, reviewer_id, reviewee_id, item_title, rating, content, tags, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        review.id,
        review.tradeId,
        review.itemId,
        review.reviewerId,
        review.revieweeId,
        review.itemTitle,
        review.rating,
        review.content,
        JSON.stringify(review.tags),
        review.createdAt
      ]
    )
  }

  for (const report of rows.reports) {
    await client.query(
      `INSERT INTO reports (
        id, reporter_id, target_type, target_id, reason, description, status,
        resolution, resolution_note, resolver_id, created_at, updated_at, resolved_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        report.id,
        report.reporterId,
        report.targetType,
        report.targetId,
        report.reason,
        report.description,
        report.status,
        report.resolution,
        report.resolutionNote,
        report.resolverId,
        report.createdAt,
        report.updatedAt,
        report.resolvedAt
      ]
    )
  }

  for (const notification of rows.notifications) {
    await client.query(
      `INSERT INTO notifications (
        id, user_id, type, title, body, target_type, target_id, read_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        notification.id,
        notification.userId,
        notification.type,
        notification.title,
        notification.body,
        notification.targetType,
        notification.targetId,
        notification.readAt,
        notification.createdAt
      ]
    )
  }

  for (const delivery of rows.notificationDeliveries) {
    await client.query(
      `INSERT INTO notification_deliveries (
        id, notification_id, user_id, type, provider, status, message, target_type, target_id,
        attempt_count, trace_id, last_attempt_at, next_retry_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        delivery.id,
        delivery.notificationId,
        delivery.userId,
        delivery.type,
        delivery.provider,
        delivery.status,
        delivery.message,
        delivery.targetType,
        delivery.targetId,
        delivery.attemptCount,
        delivery.traceId,
        delivery.lastAttemptAt,
        delivery.nextRetryAt,
        delivery.createdAt,
        delivery.updatedAt
      ]
    )
  }

  for (const event of rows.moderationEvents) {
    await client.query(
      `INSERT INTO moderation_events (
        id, actor_id, target_type, target_id, report_id, title, status, reasons, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        event.id,
        event.actorId,
        event.targetType,
        event.targetId,
        event.reportId,
        event.title,
        event.status,
        JSON.stringify(event.reasons),
        event.createdAt
      ]
    )
  }

  for (const event of rows.clientEvents) {
    await client.query(
      `INSERT INTO client_events (
        id, type, level, code, message, route, user_id, platform, app_env, trace_id, context, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
      [
        event.id,
        event.type,
        event.level,
        event.code,
        event.message,
        event.route,
        event.userId,
        event.platform,
        event.appEnv,
        event.traceId,
        JSON.stringify(event.context),
        event.createdAt
      ]
    )
  }

  for (const event of rows.opsAuditEvents) {
    await client.query(
      `INSERT INTO ops_audit_events (
        id, actor_id, action, target_type, target_id, result, message, trace_id, source, context, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [
        event.id,
        event.actorId,
        event.action,
        event.targetType,
        event.targetId,
        event.result,
        event.message,
        event.traceId,
        event.source,
        JSON.stringify(event.context),
        event.createdAt
      ]
    )
  }

  for (const deletion of rows.accountDeletions) {
    await client.query(
      'INSERT INTO account_deletions (user_id, reason, created_at) VALUES ($1, $2, $3)',
      [deletion.userId, deletion.reason, deletion.createdAt]
    )
  }
}

async function deleteBusinessRows(client) {
  await client.query('DELETE FROM idempotency_records')
  await client.query('DELETE FROM account_deletions')
  await client.query('DELETE FROM ops_audit_events')
  await client.query('DELETE FROM client_events')
  await client.query('DELETE FROM moderation_events')
  await client.query('DELETE FROM notification_deliveries')
  await client.query('DELETE FROM notifications')
  await client.query('DELETE FROM reports')
  await client.query('DELETE FROM location_audits')
  await client.query('DELETE FROM trade_timeline')
  await client.query('DELETE FROM trade_reviews')
  await client.query('DELETE FROM trade_disputes')
  await client.query('DELETE FROM trade_intents')
  await client.query('DELETE FROM item_images')
  await client.query('DELETE FROM items')
  await client.query('DELETE FROM auth_sessions')
  await client.query('DELETE FROM users')
}

async function prepareNormalizedSchema(client, store) {
  if (store.autoSchema) {
    await ensureNormalizedSchema(client)
    return
  }

  await assertNormalizedSchemaReady(client, store.environment)
}

export async function assertNormalizedSchemaReady(client, environment = 'prod') {
  const missingTables = []
  const missingColumns = []

  for (const table of NORMALIZED_TABLES) {
    const result = await client.query('SELECT to_regclass($1) AS table_name', [table])
    if (!result.rows?.[0]?.table_name) {
      missingTables.push(table)
      continue
    }

    const columnResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
    `, [table])
    const existingColumns = new Set((columnResult.rows || []).map((row) => row.column_name))

    for (const column of NORMALIZED_TABLE_COLUMN_REQUIREMENTS[table] || []) {
      if (!existingColumns.has(column)) {
        missingColumns.push(`${table}.${column}`)
      }
    }
  }

  if (missingTables.length) {
    throw new Error(`PostgreSQL schema is not migrated for ${environment}: missing tables ${missingTables.join(', ')}; run npm run db:migrate:${environment}`)
  }

  if (missingColumns.length) {
    throw new Error(`PostgreSQL schema is outdated for ${environment}: missing columns ${missingColumns.join(', ')}; run npm run db:migrate:${environment}`)
  }
}

async function ensureNormalizedSchema(client) {
  await client.query(`
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
    )
  `)
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS union_id TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_version TEXT NOT NULL DEFAULT ''")
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_accepted_at BIGINT')
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS agreement_source TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS block_reason TEXT NOT NULL DEFAULT ''")
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at BIGINT')
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_by TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS unblock_reason TEXT NOT NULL DEFAULT ''")
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS unblocked_at BIGINT')
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS unblocked_by TEXT NOT NULL DEFAULT ''")
  await client.query('CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)')
  await client.query("CREATE INDEX IF NOT EXISTS idx_users_agreement_version ON users(agreement_version) WHERE agreement_version <> ''")

  await client.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      revoked_at BIGINT
    )
  `)
  await client.query('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash)')

  await client.query(`
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
    )
  `)
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_records_scope_key ON idempotency_records(scope, idempotency_key)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_idempotency_records_expires_at ON idempotency_records(expires_at)')

  await client.query(`
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
    )
  `)
  await client.query('CREATE INDEX IF NOT EXISTS idx_items_seller_id ON items(seller_id)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_items_status_created_at ON items(status, created_at DESC)')
  await client.query("CREATE INDEX IF NOT EXISTS idx_items_location_community ON items((location->>'communityId'))")
  await client.query("CREATE INDEX IF NOT EXISTS idx_items_location_street ON items((location->>'streetId'))")
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_items_seller_active_title
    ON items (seller_id, lower(trim(title)))
    WHERE status IN ('pending_review', 'online', 'reserved')
  `)

  await client.query(`
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
    )
  `)
  await client.query("ALTER TABLE item_images ADD COLUMN IF NOT EXISTS moderation_trace_id TEXT NOT NULL DEFAULT ''")
  await client.query('ALTER TABLE item_images ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0')
  await client.query('CREATE INDEX IF NOT EXISTS idx_item_images_item_sort ON item_images(item_id, sort_order)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_item_images_owner_id ON item_images(owner_id, created_at)')
  await client.query("CREATE INDEX IF NOT EXISTS idx_item_images_moderation_trace ON item_images(moderation_trace_id) WHERE moderation_trace_id <> ''")

  await client.query(`
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
    )
  `)
  await client.query('ALTER TABLE trade_intents ADD COLUMN IF NOT EXISTS contact_code_expires_at BIGINT')
  await client.query('CREATE INDEX IF NOT EXISTS idx_trade_intents_item_id ON trade_intents(item_id)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_trade_intents_buyer_id ON trade_intents(buyer_id)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_trade_intents_seller_id ON trade_intents(seller_id)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_trade_intents_status ON trade_intents(status)')
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_intents_active_buyer_item
    ON trade_intents (buyer_id, item_id)
    WHERE status IN ('pending_seller_confirm', 'pending_meetup')
  `)

  await client.query(`
    CREATE TABLE IF NOT EXISTS trade_timeline (
      id TEXT PRIMARY KEY,
      trade_id TEXT NOT NULL REFERENCES trade_intents(id),
      status TEXT NOT NULL,
      actor_id TEXT REFERENCES users(id),
      label TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    )
  `)
  await client.query('CREATE INDEX IF NOT EXISTS idx_trade_timeline_trade_id ON trade_timeline(trade_id, created_at)')

  await client.query(`
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
    )
  `)
  await client.query('CREATE INDEX IF NOT EXISTS idx_trade_disputes_trade_id ON trade_disputes(trade_id)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_trade_disputes_status_created_at ON trade_disputes(status, created_at DESC)')
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_disputes_open_trade ON trade_disputes(trade_id) WHERE status = 'open'")

  await client.query(`
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
    )
  `)
  await client.query('CREATE INDEX IF NOT EXISTS idx_trade_reviews_item_created_at ON trade_reviews(item_id, created_at DESC)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_trade_reviews_reviewee_created_at ON trade_reviews(reviewee_id, created_at DESC)')

  await client.query(`
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
    )
  `)
  await client.query('CREATE INDEX IF NOT EXISTS idx_location_audits_trade_id ON location_audits(trade_id)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_location_audits_user_id_created_at ON location_audits(user_id, created_at)')

  await client.query(`
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
    )
  `)
  await client.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_note TEXT NOT NULL DEFAULT ''")
  await client.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolver_id TEXT REFERENCES users(id)')
  await client.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0')
  await client.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at BIGINT')
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_pending_same_reason
    ON reports (reporter_id, target_type, target_id, reason)
    WHERE status = 'pending_review'
  `)

  await client.query(`
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
    )
  `)

  await client.query(`
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
    )
  `)
  await client.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications(user_id, created_at DESC)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL')

  await client.query(`
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
    )
  `)
  await client.query('CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status_next_retry ON notification_deliveries(status, next_retry_at, updated_at DESC)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification_id ON notification_deliveries(notification_id)')

  await client.query(`
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
    )
  `)
  await client.query('CREATE INDEX IF NOT EXISTS idx_client_events_created_at ON client_events(created_at DESC)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_client_events_type_level ON client_events(type, level, created_at DESC)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_client_events_user_created_at ON client_events(user_id, created_at DESC)')

  await client.query(`
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
    )
  `)
  await client.query('CREATE INDEX IF NOT EXISTS idx_ops_audit_events_created_at ON ops_audit_events(created_at DESC)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_ops_audit_events_actor_created_at ON ops_audit_events(actor_id, created_at DESC)')
  await client.query('CREATE INDEX IF NOT EXISTS idx_ops_audit_events_action_created_at ON ops_audit_events(action, created_at DESC)')

  await client.query(`
    CREATE TABLE IF NOT EXISTS account_deletions (
      user_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    )
  `)
}

function ensureRowUser(usersById, user = {}, fallbackId = '', defaults = {}) {
  const id = String(user?.id || fallbackId || '').trim()

  if (!id) {
    return null
  }

  const existing = usersById.get(id)
  const next = {
    id,
    provider: user.provider || defaults.provider || 'unknown',
    platformId: user.platformId || defaults.platformId || id,
    unionId: user.unionId || '',
    nickname: user.nickname || '社区用户',
    avatarUrl: user.avatarUrl || '',
    contactCode: user.contactCode || user.contact || '',
    status: user.status || 'active',
    agreementVersion: user.agreementVersion || '',
    agreementAcceptedAt: nullableInteger(user.agreementAcceptedAt),
    agreementSource: user.agreementSource || '',
    blockReason: user.blockReason || '',
    blockedAt: nullableInteger(user.blockedAt),
    blockedBy: user.blockedBy || '',
    unblockReason: user.unblockReason || '',
    unblockedAt: nullableInteger(user.unblockedAt),
    unblockedBy: user.unblockedBy || '',
    createdAt: toInteger(user.createdAt, Date.now()),
    deletedAt: nullableInteger(user.deletedAt)
  }

  if (existing) {
    usersById.set(id, {
      ...next,
      ...existing,
      contactCode: existing.contactCode || next.contactCode,
      nickname: existing.nickname || next.nickname,
      avatarUrl: existing.avatarUrl || next.avatarUrl,
      agreementVersion: next.agreementVersion || existing.agreementVersion,
      agreementAcceptedAt: next.agreementAcceptedAt || existing.agreementAcceptedAt,
      agreementSource: next.agreementSource || existing.agreementSource,
      blockReason: next.blockReason || existing.blockReason,
      blockedAt: next.blockedAt || existing.blockedAt,
      blockedBy: next.blockedBy || existing.blockedBy,
      unblockReason: next.unblockReason || existing.unblockReason,
      unblockedAt: next.unblockedAt || existing.unblockedAt,
      unblockedBy: next.unblockedBy || existing.unblockedBy
    })
  } else {
    usersById.set(id, next)
  }

  return usersById.get(id)
}

function knownUserId(usersById, value) {
  const id = String(value || '').trim()
  return id && usersById.has(id) ? id : null
}

function imageToRow(image = {}, options = {}) {
  return {
    id: options.id || image.id,
    itemId: options.itemId ?? null,
    ownerId: options.ownerId,
    url: image.url || '',
    status: image.status || 'uploaded',
    storageKey: image.storageKey || '',
    originalName: image.originalName || image.filename || image.name || '',
    mimeType: image.mimeType || image.type || '',
    sizeBytes: toInteger(image.size ?? image.sizeBytes, 0),
    checksum: image.checksum || '',
    moderationTraceId: image.moderationTraceId || image.traceId || '',
    sortOrder: toInteger(options.sortOrder ?? image.sortOrder, 0),
    createdAt: toInteger(image.createdAt, Date.now())
  }
}

function rowToUser(row = {}) {
  return {
    id: row.id || '',
    provider: row.provider || '',
    platformId: row.platform_id || row.platformId || '',
    unionId: row.union_id || row.unionId || '',
    nickname: row.nickname || '社区用户',
    avatarUrl: row.avatar_url || row.avatarUrl || '',
    contactCode: row.contact_code || row.contactCode || '',
    status: row.status || 'active',
    agreementVersion: row.agreement_version || row.agreementVersion || '',
    agreementAcceptedAt: nullableInteger(row.agreement_accepted_at ?? row.agreementAcceptedAt),
    agreementSource: row.agreement_source || row.agreementSource || '',
    blockReason: row.block_reason || row.blockReason || '',
    blockedAt: nullableInteger(row.blocked_at ?? row.blockedAt),
    blockedBy: row.blocked_by || row.blockedBy || '',
    unblockReason: row.unblock_reason || row.unblockReason || '',
    unblockedAt: nullableInteger(row.unblocked_at ?? row.unblockedAt),
    unblockedBy: row.unblocked_by || row.unblockedBy || '',
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now()),
    deletedAt: nullableInteger(row.deleted_at ?? row.deletedAt)
  }
}

function rowToImage(row = {}) {
  return {
    id: row.id || '',
    url: row.url || '',
    storageKey: row.storage_key || row.storageKey || '',
    size: nullableInteger(row.size_bytes ?? row.sizeBytes),
    mimeType: row.mime_type || row.mimeType || '',
    originalName: row.original_name || row.originalName || '',
    checksum: row.checksum || '',
    status: row.status || 'uploaded',
    traceId: row.moderation_trace_id || row.moderationTraceId || row.trace_id || row.traceId || '',
    moderationTraceId: row.moderation_trace_id || row.moderationTraceId || row.trace_id || row.traceId || '',
    createdAt: toInteger(row.created_at ?? row.createdAt, Date.now())
  }
}

function userForItem(user = {}) {
  return {
    id: user.id || '',
    nickname: user.nickname || '社区用户',
    avatarUrl: user.avatarUrl || '',
    contactCode: user.contactCode || user.contact || ''
  }
}

function userForTrade(user = {}) {
  return {
    id: user.id || '',
    nickname: user.nickname || '社区用户',
    avatarUrl: user.avatarUrl || ''
  }
}

function groupRowsByKey(rows, getKey) {
  const grouped = new Map()

  for (const row of toArray(rows)) {
    const key = getKey(row)

    if (!key) {
      continue
    }

    const group = grouped.get(key) || []
    group.push(row)
    grouped.set(key, group)
  }

  return grouped
}

function timelineRowsToEvents(rows, tradeRow = {}) {
  const timeline = toArray(rows)

  if (!timeline.length) {
    return parseJsonValue(tradeRow.timeline, [])
  }

  return timeline.map((row) => ({
    id: row.id || '',
    status: row.status || '',
    actorId: row.actor_id || row.actorId || '',
    label: row.label || '',
    at: toInteger(row.created_at ?? row.createdAt, Date.now())
  }))
}

function auditRowsToLocationAudit(rows, tradeRow = {}) {
  const audit = toArray(rows)[0]

  if (!audit) {
    return parseJsonValue(tradeRow.location_audit ?? tradeRow.locationAudit, {})
  }

  return {
    id: audit.id || '',
    source: audit.source || 'server',
    latitude: nullableNumber(audit.latitude),
    longitude: nullableNumber(audit.longitude),
    capturedAt: toInteger(audit.created_at ?? audit.createdAt, Date.now()),
    accuracy: nullableNumber(audit.accuracy),
    distanceMeters: nullableNumber(audit.distance_meters ?? audit.distanceMeters),
    radiusMeters: nullableInteger(audit.radius_meters ?? audit.radiusMeters),
    scopeType: audit.scope_type || audit.scopeType || '',
    regionStatus: audit.region_status || audit.regionStatus || ''
  }
}

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined) {
    return fallback
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch (error) {
      return fallback
    }
  }

  return value
}

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function toNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : fallback
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : null
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
