import assert from 'node:assert/strict'
import { createBffState, handleBffRequest, TRADE_STATUS } from '../src/bff/handler.js'
import { USER_AGREEMENT_VERSION } from '../src/config/app.js'
import { DEMO_REGIONS } from '../src/data/regions.js'
import {
  assertNormalizedSchemaReady,
  assertSnapshotRowLimit,
  countSerializedRows,
  deserializeRowsToState,
  NORMALIZED_TABLE_COLUMN_REQUIREMENTS,
  normalizeSnapshotRowLimit,
  serializeStateToRows
} from '../backend/src/postgres-state-store.mjs'

const region = DEMO_REGIONS[0]
const state = createBffState([])

const sellerLogin = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    agreement: createAgreement('postgres-store:seller'),
    platformIdentity: {
      provider: 'wechat',
      platformId: 'seller-openid',
      unionId: 'seller-unionid'
    },
    userInfo: {
      nickname: '卖家',
      avatarUrl: 'https://cdn.example.com/seller.png'
    }
  }
}, state)

const upload = await handleBffRequest('/uploads/items', {
  method: 'UPLOAD',
  token: sellerLogin.token,
  data: {
    file: {
      id: 'upload-test-image',
      url: 'https://cdn.example.com/items/test.jpg',
      storageKey: 'items/test.jpg',
      size: 2048,
      mimeType: 'image/jpeg',
      originalName: 'test.jpg',
      checksum: 'checksum-test',
      status: 'uploaded',
      traceId: 'trace-postgres-store-image'
    }
  }
}, state)

const item = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerLogin.token,
  data: {
    title: 'PostgreSQL 存储烟测商品',
    price: 99,
    category: 'home',
    condition: 'good',
    description: '验证规范化表序列化',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: region.radiusMeters
    },
    location: {
      latitude: region.latitude,
      longitude: region.longitude,
      serverRegion: region,
      scopeType: 'community',
      radiusMeters: region.radiusMeters
    }
  }
}, state)

const buyerLogin = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    agreement: createAgreement('postgres-store:buyer'),
    platformIdentity: {
      provider: 'wechat',
      platformId: 'buyer-openid',
      unionId: 'buyer-unionid'
    },
    userInfo: {
      nickname: '买家',
      avatarUrl: 'https://cdn.example.com/buyer.png'
    }
  }
}, state)

const trade = await handleBffRequest('/trades', {
  method: 'POST',
  token: buyerLogin.token,
  data: {
    itemId: item.id,
    buyerLocation: {
      latitude: region.latitude,
      longitude: region.longitude,
      accuracy: 25,
      capturedAt: Date.now(),
      serverRegion: region
    }
  }
}, state)

assert.equal(trade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)

const reviewUpload = await handleBffRequest('/uploads/items', {
  method: 'UPLOAD',
  token: sellerLogin.token,
  data: {
    file: {
      id: 'upload-review-image',
      url: 'https://cdn.example.com/items/review.jpg',
      storageKey: 'items/review.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      originalName: 'review.jpg',
      checksum: 'checksum-review',
      status: 'uploaded',
      traceId: 'trace-postgres-store-review-image'
    }
  }
}, state)
const reviewItem = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerLogin.token,
  data: {
    title: 'PostgreSQL 评价烟测商品',
    price: 89,
    category: 'home',
    condition: 'good',
    description: '验证评价表序列化',
    images: [reviewUpload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: region.radiusMeters
    },
    location: {
      latitude: region.latitude,
      longitude: region.longitude,
      serverRegion: region,
      scopeType: 'community',
      radiusMeters: region.radiusMeters
    }
  }
}, state)
const reviewTrade = await handleBffRequest('/trades', {
  method: 'POST',
  token: buyerLogin.token,
  data: {
    itemId: reviewItem.id,
    buyerLocation: {
      latitude: region.latitude,
      longitude: region.longitude,
      accuracy: 25,
      capturedAt: Date.now(),
      serverRegion: region
    }
  }
}, state)
await handleBffRequest(`/trades/${reviewTrade.id}/status`, {
  method: 'PATCH',
  token: sellerLogin.token,
  data: {
    status: TRADE_STATUS.PENDING_MEETUP
  }
}, state)
await handleBffRequest(`/trades/${reviewTrade.id}/status`, {
  method: 'PATCH',
  token: buyerLogin.token,
  data: {
    status: TRADE_STATUS.COMPLETED
  }
}, state)
const review = await handleBffRequest(`/trades/${reviewTrade.id}/review`, {
  method: 'POST',
  token: buyerLogin.token,
  data: {
    rating: 5,
    content: 'PostgreSQL round trip review',
    tags: ['准时']
  }
}, state)
assert.equal(review.tradeId, reviewTrade.id)

const moderation = await handleBffRequest(`/moderation/items/${item.id}/review`, {
  method: 'POST',
  data: {
    status: 'rejected',
    actorId: 'moderation-smoke',
    reasons: ['store smoke rejection']
  }
}, state)

assert.equal(moderation.status, 'removed')
assert.equal(state.trades.find((candidate) => candidate.id === trade.id).status, TRADE_STATUS.DISPUTED)

const deliveryNotification = state.notifications.find((notification) => notification.type === 'trade_created')
state.notificationDeliveries.push({
  id: 'notification_delivery_store_smoke',
  notificationId: deliveryNotification.id,
  userId: deliveryNotification.userId,
  type: deliveryNotification.type,
  provider: 'wechat',
  status: 'failed',
  message: 'store smoke delivery failure',
  targetType: deliveryNotification.targetType,
  targetId: deliveryNotification.targetId,
  attemptCount: 2,
  traceId: 'trace_delivery_store_smoke',
  lastAttemptAt: Date.now(),
  nextRetryAt: Date.now() + 60000,
  createdAt: Date.now(),
  updatedAt: Date.now()
})
state.idempotencyRecords.push({
  id: 'idempotency_store_smoke',
  scope: `user:${buyerLogin.user.id}`,
  key: 'store_trade_create_key_001',
  method: 'POST',
  path: '/trades',
  requestHash: 'request-hash-store-smoke',
  status: 'completed',
  response: trade,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  expiresAt: Date.now() + 24 * 60 * 60 * 1000
})
state.reports.push({
  id: 'report_store_smoke',
  reporter: {
    id: buyerLogin.user.id,
    nickname: buyerLogin.user.nickname
  },
  targetType: 'item',
  targetId: reviewItem.id,
  reason: 'fraud',
  description: 'store smoke report',
  status: 'resolved',
  resolution: 'uphold_report',
  resolutionNote: 'store smoke resolved report',
  resolverId: sellerLogin.user.id,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  resolvedAt: Date.now()
})
state.clientEvents.push({
  id: 'client_event_store_smoke',
  type: 'location_profile_failed',
  level: 'warn',
  code: 'LOCATION_TIMEOUT',
  message: 'store smoke client event',
  route: 'pages/publish/publish',
  userId: buyerLogin.user.id,
  platform: '微信小程序',
  appEnv: 'test',
  traceId: 'trace_client_event_store_smoke',
  context: {
    source: 'gps'
  },
  createdAt: Date.now()
})
state.opsAuditEvents.push({
  id: 'ops_audit_store_smoke',
  actorId: 'support-store-smoke',
  action: 'ops.report.resolve',
  targetType: 'report',
  targetId: 'report_store_smoke',
  result: 'success',
  message: 'store smoke audit',
  traceId: 'trace_ops_audit_store_smoke',
  source: 'session',
  context: {
    resolution: 'uphold_report'
  },
  createdAt: Date.now()
})
const blockedUser = state.users.find((user) => user.id === buyerLogin.user.id)
blockedUser.status = 'blocked'
blockedUser.blockReason = 'store smoke risk block'
blockedUser.blockedAt = Date.now()
blockedUser.blockedBy = 'risk-store-smoke'

const rows = serializeStateToRows(state, [])

assert.equal(countSerializedRows(rows), 32)
assert.equal(normalizeSnapshotRowLimit('32'), 32)
assert.doesNotThrow(() => assertSnapshotRowLimit(rows, 32))
assert.doesNotThrow(() => assertSnapshotRowLimit(rows, 0))
assert.throws(
  () => assertSnapshotRowLimit(rows, 31),
  /PostgreSQL snapshot row count 32 exceeds GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS=31/
)
assert.throws(
  () => normalizeSnapshotRowLimit('not-a-number'),
  /GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS must be a non-negative number/
)

await assert.doesNotReject(() => assertNormalizedSchemaReady(schemaReadyClient(), 'pre'))
await assert.rejects(
  () => assertNormalizedSchemaReady(schemaReadyClient({
    missingTables: new Set(['users'])
  }), 'prod'),
  /PostgreSQL schema is not migrated for prod: missing tables users; run npm run db:migrate:prod/
)
await assert.rejects(
  () => assertNormalizedSchemaReady(schemaReadyClient({
    missingColumns: new Set(['users.status', 'idempotency_records.idempotency_key'])
  }), 'prod'),
  /PostgreSQL schema is outdated for prod: missing columns users.status, idempotency_records.idempotency_key; run npm run db:migrate:prod/
)

assert.equal(rows.users.length, 2)
assert.equal(rows.sessions.length, 2)
assert.equal(rows.idempotencyRecords.length, 1)
assert.equal(rows.items.length, 2)
assert.equal(rows.itemImages.length, 2)
assert.equal(rows.trades.length, 2)
assert.equal(rows.tradeTimeline.length, 5)
assert.equal(rows.locationAudits.length, 2)
assert.equal(rows.disputeCases.length, 1)
assert.equal(rows.reviews.length, 1)
assert.equal(rows.reports.length, 1)
assert.equal(rows.notifications.length, 7)
assert.equal(rows.notificationDeliveries.length, 1)
assert.equal(rows.moderationEvents.length, 1)
assert.equal(rows.clientEvents.length, 1)
assert.equal(rows.opsAuditEvents.length, 1)
assert.equal(rows.users.find((user) => user.id === sellerLogin.user.id).unionId, 'seller-unionid')
assert.equal(rows.users.find((user) => user.id === buyerLogin.user.id).status, 'blocked')
assert.equal(rows.users.find((user) => user.id === buyerLogin.user.id).blockReason, 'store smoke risk block')
assert.equal(rows.items.find((candidate) => candidate.id === item.id).sellerId, sellerLogin.user.id)
assert.equal(rows.itemImages.some((image) => image.moderationTraceId === 'trace-postgres-store-image'), true)
assert.equal(rows.trades.find((candidate) => candidate.id === trade.id).buyerId, buyerLogin.user.id)
assert.equal(rows.trades.find((candidate) => candidate.id === trade.id).status, TRADE_STATUS.DISPUTED)
assert.equal(rows.disputeCases[0].tradeId, trade.id)
assert.equal(rows.disputeCases[0].source, 'moderation')
assert.equal(rows.disputeCases[0].status, 'open')
assert.equal(rows.reviews[0].reviewerId, buyerLogin.user.id)
assert.equal(rows.reviews[0].revieweeId, sellerLogin.user.id)
assert.equal(rows.reviews[0].rating, 5)
assert.equal(rows.notifications.some((notification) => notification.type === 'trade_created'), true)
assert.equal(rows.notifications.some((notification) => notification.type === 'trade_reviewed'), true)
assert.equal(rows.notifications.filter((notification) => notification.type === 'trade_disputed').length, 2)
assert.equal(rows.notificationDeliveries[0].notificationId, deliveryNotification.id)
assert.equal(rows.notificationDeliveries[0].status, 'failed')
assert.equal(rows.notificationDeliveries[0].attemptCount, 2)
assert.equal(rows.idempotencyRecords[0].key, 'store_trade_create_key_001')
assert.equal(rows.idempotencyRecords[0].response.id, trade.id)
assert.equal(rows.reports[0].resolution, 'uphold_report')
assert.equal(rows.reports[0].resolverId, sellerLogin.user.id)
assert.equal(rows.moderationEvents[0].actorId, null)
assert.equal(rows.clientEvents[0].userId, buyerLogin.user.id)
assert.equal(rows.clientEvents[0].context.source, 'gps')
assert.equal(rows.opsAuditEvents[0].actorId, 'support-store-smoke')
assert.equal(rows.opsAuditEvents[0].context.resolution, 'uphold_report')
assert.equal(rows.tradeTimeline.find((event) => event.status === TRADE_STATUS.DISPUTED).actorId, null)
assert.equal(rows.users.find((user) => user.id === sellerLogin.user.id).agreementVersion, USER_AGREEMENT_VERSION)
assert.equal(rows.users.find((user) => user.id === sellerLogin.user.id).agreementSource, 'postgres-store:seller')

const restored = deserializeRowsToState(rows, [])
const restoredItem = restored.items.find((candidate) => candidate.id === item.id)
const restoredReviewItem = restored.items.find((candidate) => candidate.id === reviewItem.id)
const restoredTrade = restored.trades.find((candidate) => candidate.id === trade.id)
const restoredReviewTrade = restored.trades.find((candidate) => candidate.id === reviewTrade.id)

assert.equal(restored.users.length, 2)
assert.equal(restored.users.find((user) => user.id === sellerLogin.user.id).agreementVersion, USER_AGREEMENT_VERSION)
assert.equal(restored.users.find((user) => user.id === buyerLogin.user.id).agreementSource, 'postgres-store:buyer')
assert.equal(restored.users.find((user) => user.id === buyerLogin.user.id).status, 'blocked')
assert.equal(restored.users.find((user) => user.id === buyerLogin.user.id).blockedBy, 'risk-store-smoke')
assert.equal(restored.idempotencyRecords.length, 1)
assert.equal(restored.idempotencyRecords[0].response.id, trade.id)
assert.equal(restoredItem.title, item.title)
assert.equal(restoredItem.seller.id, sellerLogin.user.id)
assert.equal(restoredItem.images.length, 1)
assert.equal(restoredItem.images[0].traceId, 'trace-postgres-store-image')
assert.equal(restoredItem.status, 'removed')
assert.equal(restoredItem.reviewStatus, 'rejected')
assert.equal(restoredReviewItem.status, 'sold')
assert.equal(restored.uploads.length, 0)
assert.equal(restoredTrade.buyer.id, buyerLogin.user.id)
assert.equal(restoredTrade.status, TRADE_STATUS.DISPUTED)
assert.equal(restoredTrade.timeline.length, 2)
assert.equal(restoredReviewTrade.status, TRADE_STATUS.COMPLETED)
assert.equal(restored.disputeCases.length, 1)
assert.equal(restored.disputeCases[0].tradeId, trade.id)
assert.equal(restored.disputeCases[0].status, 'open')
assert.equal(restored.reviews.length, 1)
assert.equal(restored.reviews[0].tradeId, reviewTrade.id)
assert.equal(restored.reviews[0].reviewee.id, sellerLogin.user.id)
assert.equal(restored.reports.length, 1)
assert.equal(restored.reports[0].resolution, 'uphold_report')
assert.equal(restored.reports[0].resolverId, sellerLogin.user.id)
assert.equal(restored.notifications.length, 7)
assert.equal(restored.notifications.some((notification) => notification.targetId === trade.id), true)
assert.equal(restored.notificationDeliveries.length, 1)
assert.equal(restored.notificationDeliveries[0].notificationId, deliveryNotification.id)
assert.equal(restored.notificationDeliveries[0].traceId, 'trace_delivery_store_smoke')
assert.equal(restored.moderationEvents[0].actorId, '')
assert.equal(restored.clientEvents.length, 1)
assert.equal(restored.clientEvents[0].type, 'location_profile_failed')
assert.equal(restored.clientEvents[0].context.source, 'gps')
assert.equal(restored.opsAuditEvents.length, 1)
assert.equal(restored.opsAuditEvents[0].action, 'ops.report.resolve')
assert.equal(restored.opsAuditEvents[0].context.resolution, 'uphold_report')
assert.equal(restoredTrade.locationAudit.regionStatus, 'match')

const roundTripRows = serializeStateToRows(restored, [])

assert.equal(roundTripRows.users.length, rows.users.length)
assert.equal(roundTripRows.idempotencyRecords.length, rows.idempotencyRecords.length)
assert.equal(roundTripRows.idempotencyRecords[0].key, 'store_trade_create_key_001')
assert.equal(roundTripRows.items.length, rows.items.length)
assert.equal(roundTripRows.itemImages.some((image) => image.moderationTraceId === 'trace-postgres-store-image'), true)
assert.equal(roundTripRows.trades.length, rows.trades.length)
assert.equal(roundTripRows.disputeCases.length, rows.disputeCases.length)
assert.equal(roundTripRows.disputeCases[0].status, 'open')
assert.equal(roundTripRows.reviews.length, rows.reviews.length)
assert.equal(roundTripRows.reviews[0].rating, 5)
assert.equal(roundTripRows.reports.length, rows.reports.length)
assert.equal(roundTripRows.reports[0].resolution, 'uphold_report')
assert.equal(roundTripRows.notifications.length, rows.notifications.length)
assert.equal(roundTripRows.notificationDeliveries.length, rows.notificationDeliveries.length)
assert.equal(roundTripRows.notificationDeliveries[0].attemptCount, 2)
assert.equal(roundTripRows.tradeTimeline.length, rows.tradeTimeline.length)
assert.equal(roundTripRows.locationAudits.length, rows.locationAudits.length)
assert.equal(roundTripRows.moderationEvents.length, rows.moderationEvents.length)
assert.equal(roundTripRows.moderationEvents[0].actorId, null)
assert.equal(roundTripRows.clientEvents.length, rows.clientEvents.length)
assert.equal(roundTripRows.clientEvents[0].code, 'LOCATION_TIMEOUT')
assert.equal(roundTripRows.opsAuditEvents.length, rows.opsAuditEvents.length)
assert.equal(roundTripRows.opsAuditEvents[0].actorId, 'support-store-smoke')
assert.equal(roundTripRows.tradeTimeline.find((event) => event.status === TRADE_STATUS.DISPUTED).actorId, null)

console.log('PostgreSQL normalized store smoke checks passed')

function createAgreement(source) {
  return {
    version: USER_AGREEMENT_VERSION,
    acceptedAt: Date.now(),
    source
  }
}

function schemaReadyClient(options = {}) {
  const missingTables = options.missingTables || new Set()
  const missingColumns = options.missingColumns || new Set()

  return {
    query: async (sql, args) => {
      const table = args[0]

      if (String(sql).includes('to_regclass')) {
        return {
          rows: [{
            table_name: missingTables.has(table) ? null : table
          }]
        }
      }

      if (String(sql).includes('information_schema.columns')) {
        return {
          rows: (NORMALIZED_TABLE_COLUMN_REQUIREMENTS[table] || [])
            .filter((column) => !missingColumns.has(`${table}.${column}`))
            .map((column_name) => ({
              column_name
            }))
        }
      }

      throw new Error(`Unexpected schema readiness query: ${sql}`)
    }
  }
}
