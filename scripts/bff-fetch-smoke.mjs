import assert from 'node:assert/strict'
import { createBffFetchHandler } from '../src/bff/fetch-adapter.js'
import { createBffState, TRADE_STATUS } from '../src/bff/handler.js'

const state = createBffState([])
const handler = createBffFetchHandler(state, {
  moderationSecret: 'fetch-moderation-secret'
})
const baseUrl = 'https://bff.local.test'

const platformIdentitySession = await post('/auth/login', {
  provider: 'weixin',
  code: 'client-code-should-not-be-user-id',
  platformIdentity: {
    provider: 'weixin',
    platformId: 'server-openid-fetch-1',
    unionId: 'server-union-fetch-1'
  },
  userInfo: {
    nickname: '平台身份用户',
    avatarUrl: ''
  }
})
assert.equal(platformIdentitySession.user.platformId, 'server-openid-fetch-1')
assert.equal(platformIdentitySession.user.unionId, 'server-union-fetch-1')

const sellerSession = await post('/auth/login', {
  provider: 'weixin',
  code: 'fetch-seller-code',
  userInfo: {
    nickname: 'Fetch 卖家',
    avatarUrl: ''
  }
})
const buyerSession = await post('/auth/login', {
  provider: 'weixin',
  code: 'fetch-buyer-code',
  userInfo: {
    nickname: 'Fetch 买家',
    avatarUrl: ''
  }
})

assert.ok(sellerSession.token)
assert.ok(buyerSession.token)
assert.equal(state.sessions.length, 3)
assert.equal(state.sessions.every((session) => session.token === undefined), true)
assert.equal(state.sessions.every((session) => session.tokenHash), true)
assert.equal(state.sessions.every((session) => /^[a-f0-9]{64}$/.test(session.tokenHash)), true)
assert.equal(sellerSession.token.startsWith('session_'), true)
assert.equal(sellerSession.token.length > 40, true)

const region = await post('/lbs/resolve-region', {
  latitude: 31.22945,
  longitude: 121.45494,
  coordType: 'gcj02'
})

assert.equal(region.communityId, 'sh-jingan-shimen')

const upload = await uploadItemImage(sellerSession.token)
assert.equal(upload.status, 'uploaded')

const item = await post('/items', {
  title: 'Fetch 适配商品',
  price: 118,
  category: 'home',
  condition: 'good',
  description: '验证 Fetch BFF 适配器',
  images: [upload],
  tradeScope: {
    type: 'community',
    label: '同社区',
    radiusMeters: 1200
  },
  location: {
    latitude: 31.22945,
    longitude: 121.45494,
    accuracy: 60,
    capturedAt: Date.now(),
    communityId: 'client-spoofed-community',
    streetId: 'client-spoofed-street'
  }
}, sellerSession.token)

assert.equal(item.seller.id, sellerSession.user.id)
assert.equal(item.location.communityId, region.communityId)
assert.equal(item.seller.contactCode, undefined)
assertNoPublicCoordinates(item)

const duplicateItem = await raw('/items', {
  method: 'POST',
  token: sellerSession.token,
  data: {
    title: 'Fetch 适配商品',
    price: 119,
    category: 'home',
    condition: 'good',
    description: '同一卖家不能重复发布同名活跃商品',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      latitude: 31.22945,
      longitude: 121.45494,
      accuracy: 60,
      capturedAt: Date.now(),
      communityId: region.communityId,
      streetId: region.streetId
    }
  }
})
const duplicateItemError = await readError(duplicateItem)
assert.equal(duplicateItem.status, 409)
assert.equal(duplicateItemError.code, 'CONFLICT')
assert.match(duplicateItemError.message, /已存在同名在售或审核中的商品/)

const idempotentItemPayload = {
  title: 'Fetch 幂等发布商品',
  price: 108,
  category: 'electronics',
  condition: 'good',
  description: '验证 Fetch Runtime 传递幂等键',
  images: [upload],
  tradeScope: {
    type: 'community',
    label: '同社区',
    radiusMeters: 1200
  },
  location: {
    latitude: 31.22945,
    longitude: 121.45494,
    accuracy: 60,
    capturedAt: Date.now(),
    communityId: region.communityId,
    streetId: region.streetId
  }
}
const idempotentItem = await readData(await raw('/items', {
  method: 'POST',
  token: sellerSession.token,
  data: idempotentItemPayload,
  header: {
    'Idempotency-Key': 'fetch_item_create_key_001'
  }
}))
const replayedItem = await readData(await raw('/items', {
  method: 'POST',
  token: sellerSession.token,
  data: idempotentItemPayload,
  header: {
    'Idempotency-Key': 'fetch_item_create_key_001'
  }
}))
assert.equal(replayedItem.id, idempotentItem.id)
assert.equal(state.items.filter((candidate) => candidate.title === idempotentItemPayload.title).length, 1)

const listed = await get('/items?category=home&latitude=31.2301&longitude=121.4556')
assert.equal(listed.items.length, 1)
assertNoPublicCoordinates(listed.items[0])
assert.equal(Number.isFinite(Number(listed.items[0].distanceMeters)), true)

const ownReport = await raw('/reports', {
  method: 'POST',
  token: sellerSession.token,
  data: {
    targetType: 'item',
    targetId: item.id,
    reason: 'other',
    description: '不能举报自己发布的物品'
  }
})
const ownReportError = await readError(ownReport)
assert.equal(ownReport.status, 403)
assert.equal(ownReportError.code, 'FORBIDDEN')
assert.match(ownReportError.message, /不能举报自己发布的物品/)

const invalidReport = await raw('/reports', {
  method: 'POST',
  token: buyerSession.token,
  data: {
    targetType: 'item',
    targetId: item.id,
    reason: 'bogus',
    description: '无效举报原因'
  }
})
const invalidReportError = await readError(invalidReport)
assert.equal(invalidReport.status, 422)
assert.equal(invalidReportError.code, 'VALIDATION_ERROR')
assert.match(invalidReportError.message, /举报原因无效/)

const report = await post('/reports', {
  targetType: 'item',
  targetId: item.id,
  reason: 'other',
  description: 'Fetch 举报幂等验证'
}, buyerSession.token)
assert.equal(report.status, 'pending_review')
const duplicateReport = await post('/reports', {
  targetType: 'item',
  targetId: item.id,
  reason: 'other',
  description: 'Fetch 重复举报应返回原记录'
}, buyerSession.token)
assert.equal(duplicateReport.id, report.id)
assert.equal(
  state.reports.filter((candidate) =>
    candidate.reporter.id === buyerSession.user.id &&
    candidate.targetId === item.id &&
    candidate.reason === 'other'
  ).length,
  1
)

const lowAccuracyTrade = await raw('/trades', {
  method: 'POST',
  token: buyerSession.token,
  data: {
    itemId: item.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 320,
      capturedAt: Date.now()
    }
  }
})
const lowAccuracyTradeError = await readError(lowAccuracyTrade)
assert.equal(lowAccuracyTrade.status, 422)
assert.equal(lowAccuracyTradeError.code, 'VALIDATION_ERROR')
assert.match(lowAccuracyTradeError.message, /定位精度约 320m/)

const trade = await post('/trades', {
  itemId: item.id,
  buyerLocation: {
    latitude: 31.2301,
    longitude: 121.4556,
    accuracy: 60,
    capturedAt: Date.now()
  }
}, buyerSession.token)

assert.equal(trade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)
assert.equal(trade.contactCode, '')
const sellerNotifications = await get('/notifications', sellerSession.token)
assert.equal(sellerNotifications.notifications[0].type, 'trade_created')
assert.equal(sellerNotifications.notifications[0].targetId, trade.id)
const readNotification = await patch(`/notifications/${sellerNotifications.notifications[0].id}/read`, {}, sellerSession.token)
assert.equal(Boolean(readNotification.readAt), true)

const confirmed = await patch(`/trades/${trade.id}/status`, {
  status: TRADE_STATUS.PENDING_MEETUP
}, sellerSession.token, {
  header: {
    'Idempotency-Key': 'fetch_trade_confirm_key_001'
  }
})
const replayedConfirmed = await patch(`/trades/${trade.id}/status`, {
  status: TRADE_STATUS.PENDING_MEETUP
}, sellerSession.token, {
  header: {
    'Idempotency-Key': 'fetch_trade_confirm_key_001'
  }
})

assert.equal(confirmed.status, TRADE_STATUS.PENDING_MEETUP)
assert.equal(replayedConfirmed.contactCode, confirmed.contactCode)
assert.match(confirmed.contactCode, /^GC-[A-F0-9]{6}-[A-Z0-9]{4}$/)
assert.notEqual(confirmed.contactCode, sellerSession.user.contactCode)
assert.equal(confirmed.contactCodeExpiresAt > Date.now(), true)
const storedConfirmedTrade = state.trades.find((candidate) => candidate.id === trade.id)
storedConfirmedTrade.contactCodeExpiresAt = Date.now() - 1
const duplicateTradeAfterContactExpiry = await post('/trades', {
  itemId: item.id,
  buyerLocation: {
    latitude: 31.2301,
    longitude: 121.4556,
    accuracy: 60,
    capturedAt: Date.now()
  }
}, buyerSession.token)
assert.equal(duplicateTradeAfterContactExpiry.id, trade.id)
assert.equal(duplicateTradeAfterContactExpiry.contactCode, '')
assert.equal(duplicateTradeAfterContactExpiry.contactCodeExpiresAt, null)
assert.equal(state.trades.find((candidate) => candidate.id === trade.id).contactCode, '')
assert.equal(state.trades.find((candidate) => candidate.id === trade.id).contactCodeExpiresAt, null)
const replayedConfirmedAfterContactExpiry = await patch(`/trades/${trade.id}/status`, {
  status: TRADE_STATUS.PENDING_MEETUP
}, sellerSession.token, {
  header: {
    'Idempotency-Key': 'fetch_trade_confirm_key_001'
  }
})
assert.equal(replayedConfirmedAfterContactExpiry.contactCode, '')
assert.equal(replayedConfirmedAfterContactExpiry.contactCodeExpiresAt, null)
const buyerTradesAfterContactExpiry = await get('/trades', buyerSession.token)
const expiredContactTrade = buyerTradesAfterContactExpiry.trades.find((candidate) => candidate.id === trade.id)
assert.equal(expiredContactTrade.contactCode, '')
assert.equal(expiredContactTrade.contactCodeExpiresAt, null)
assert.equal(state.trades.find((candidate) => candidate.id === trade.id).contactCode, '')
assert.equal(state.trades.find((candidate) => candidate.id === trade.id).contactCodeExpiresAt, null)
const buyerNotifications = await get('/notifications', buyerSession.token)
assert.equal(buyerNotifications.notifications[0].type, 'trade_confirmed')
assert.equal(buyerNotifications.notifications[0].targetId, trade.id)
const prematureReview = await raw(`/trades/${trade.id}/review`, {
  method: 'POST',
  token: buyerSession.token,
  data: {
    rating: 5,
    content: '未完成前不能评价'
  }
})
const prematureReviewError = await readError(prematureReview)
assert.equal(prematureReview.status, 409)
assert.equal(prematureReviewError.code, 'CONFLICT')
assert.match(prematureReviewError.message, /交易完成后才能评价/)

const completed = await patch(`/trades/${trade.id}/status`, {
  status: TRADE_STATUS.COMPLETED
}, buyerSession.token)
assert.equal(completed.status, TRADE_STATUS.COMPLETED)
assert.equal(completed.contactCode, '')
const review = await post(`/trades/${trade.id}/review`, {
  rating: 5,
  content: 'Fetch 交易顺利',
  tags: ['准时', '物品一致']
}, buyerSession.token)
assert.equal(review.tradeId, trade.id)
assert.equal(review.itemId, item.id)
assert.equal(review.reviewee.id, sellerSession.user.id)
const itemReviews = await get(`/reviews?itemId=${encodeURIComponent(item.id)}`)
assert.equal(itemReviews.reviews[0].id, review.id)
const duplicateReview = await raw(`/trades/${trade.id}/review`, {
  method: 'POST',
  token: buyerSession.token,
  data: {
    rating: 4,
    content: 'Fetch 重复评价'
  }
})
const duplicateReviewError = await readError(duplicateReview)
assert.equal(duplicateReview.status, 409)
assert.equal(duplicateReviewError.code, 'CONFLICT')
assert.match(duplicateReviewError.message, /不能重复评价/)
const buyerTradesAfterReview = await get('/trades', buyerSession.token)
assert.equal(buyerTradesAfterReview.trades.find((candidate) => candidate.id === trade.id).reviewedByMe, true)
const sellerNotificationsAfterReview = await get('/notifications', sellerSession.token)
assert.equal(sellerNotificationsAfterReview.notifications.some((notification) => notification.type === 'trade_reviewed'), true)

const disputeItem = await post('/items', {
  title: 'Fetch 争议商品',
  price: 88,
  category: 'home',
  condition: 'good',
  description: '验证 Fetch 争议处理',
  images: [upload],
  tradeScope: {
    type: 'community',
    label: '同社区',
    radiusMeters: 1200
  },
  location: {
    latitude: 31.22945,
    longitude: 121.45494,
    accuracy: 60,
    capturedAt: Date.now(),
    communityId: region.communityId,
    streetId: region.streetId
  }
}, sellerSession.token)
const disputeTrade = await post('/trades', {
  itemId: disputeItem.id,
  buyerLocation: {
    latitude: 31.2301,
    longitude: 121.4556,
    accuracy: 60,
    capturedAt: Date.now()
  }
}, buyerSession.token)
await patch(`/trades/${disputeTrade.id}/status`, {
  status: TRADE_STATUS.PENDING_MEETUP
}, sellerSession.token)
const disputedTrade = await patch(`/trades/${disputeTrade.id}/status`, {
  status: TRADE_STATUS.DISPUTED
}, buyerSession.token)
assert.equal(disputedTrade.status, TRADE_STATUS.DISPUTED)
assert.equal(disputedTrade.disputeCase.status, 'open')
const fetchDisputes = await get('/disputes', sellerSession.token)
const fetchDispute = fetchDisputes.disputes.find((candidate) => candidate.tradeId === disputeTrade.id)
assert.equal(fetchDispute.status, 'open')
const missingModerationSecret = await raw(`/moderation/disputes/${fetchDispute.id}/resolve`, {
  method: 'PATCH',
  data: {
    resolution: 'release_item',
    actorId: 'fetch-support-smoke',
    note: 'Fetch smoke 缺少密钥应拒绝'
  }
})
const missingModerationSecretError = await readError(missingModerationSecret)
assert.equal(missingModerationSecret.status, 401)
assert.equal(missingModerationSecretError.code, 'UNAUTHENTICATED')
assert.match(missingModerationSecretError.message, /审核回调密钥无效/)
const resolvedFetchDispute = await patch(`/moderation/disputes/${fetchDispute.id}/resolve`, {
  resolution: 'release_item',
  actorId: 'fetch-support-smoke',
  note: 'Fetch smoke 释放商品'
}, '', {
  header: {
    'x-moderation-secret': 'fetch-moderation-secret'
  }
})
assert.equal(resolvedFetchDispute.status, 'resolved')
assert.equal(resolvedFetchDispute.resolution, 'release_item')
const fetchTradesAfterDispute = await get('/trades', buyerSession.token)
const releasedFetchTrade = fetchTradesAfterDispute.trades.find((candidate) => candidate.id === disputeTrade.id)
assert.equal(releasedFetchTrade.status, TRADE_STATUS.CANCELLED)
assert.equal(releasedFetchTrade.disputeCase.status, 'resolved')
const sellerNotificationsAfterDispute = await get('/notifications', sellerSession.token)
assert.equal(sellerNotificationsAfterDispute.notifications.some((notification) => notification.type === 'trade_dispute_resolved'), true)

const telemetryResult = await post('/telemetry/client-events', {
  type: 'location_profile_failed',
  level: 'warn',
  code: 'LOCATION_TIMEOUT',
  message: 'Fetch smoke client event',
  context: {
    source: 'gps',
    latitude: 31.2
  }
}, buyerSession.token)
assert.equal(telemetryResult.accepted, 1)
const missingOpsTelemetrySecret = await raw('/ops/client-events?level=warn')
const missingOpsTelemetrySecretError = await readError(missingOpsTelemetrySecret)
assert.equal(missingOpsTelemetrySecret.status, 401)
assert.equal(missingOpsTelemetrySecretError.code, 'UNAUTHENTICATED')
const opsClientEvents = await get('/ops/client-events?level=warn', '', {
  header: {
    'x-moderation-secret': 'fetch-moderation-secret'
  }
})
assert.equal(opsClientEvents.events.some((event) =>
  event.type === 'location_profile_failed' &&
  event.userId === buyerSession.user.id &&
  event.context.source === 'gps' &&
  event.context.latitude === undefined
), true)

const missingAuth = await raw('/items/mine')
const missingAuthError = await readError(missingAuth)
assert.equal(missingAuth.status, 401)
assert.equal(missingAuthError.code, 'UNAUTHENTICATED')
assert.match(missingAuthError.message, /登录态无效/)

const expiringSession = await post('/auth/login', {
  provider: 'weixin',
  code: 'fetch-expired-code',
  userInfo: {
    nickname: 'Fetch 过期用户',
    avatarUrl: ''
  }
})
findSessionForUser(state, expiringSession.user.id).expiresAt = Date.now() - 1
const expiredAuth = await raw('/items/mine', {
  token: expiringSession.token
})
const expiredAuthError = await readError(expiredAuth)
assert.equal(expiredAuth.status, 401)
assert.equal(expiredAuthError.code, 'UNAUTHENTICATED')
assert.match(expiredAuthError.message, /登录态无效/)

const logoutSession = await post('/auth/login', {
  provider: 'weixin',
  code: 'fetch-logout-code',
  userInfo: {
    nickname: 'Fetch 退出用户',
    avatarUrl: ''
  }
})
const logoutResult = await post('/auth/logout', {}, logoutSession.token)
assert.equal(logoutResult.ok, true)
assert.equal(Boolean(findSessionForUser(state, logoutSession.user.id).revokedAt), true)
const revokedAuth = await raw('/items/mine', {
  token: logoutSession.token
})
const revokedAuthError = await readError(revokedAuth)
assert.equal(revokedAuth.status, 401)
assert.equal(revokedAuthError.code, 'UNAUTHENTICATED')
assert.match(revokedAuthError.message, /登录态无效/)

const options = await handler(new Request(`${baseUrl}/items`, {
  method: 'OPTIONS'
}))
assert.equal(options.status, 204)
assert.equal(options.headers.get('access-control-allow-origin'), '*')
assert.match(options.headers.get('access-control-allow-headers'), /x-moderation-secret/)

const lockedCorsHandler = createBffFetchHandler(createBffState([]), {
  allowedOrigins: ['https://allowed.example.com']
})
const allowedCors = await lockedCorsHandler(new Request(`${baseUrl}/items`, {
  method: 'OPTIONS',
  headers: {
    origin: 'https://allowed.example.com'
  }
}))
assert.equal(allowedCors.status, 204)
assert.equal(allowedCors.headers.get('access-control-allow-origin'), 'https://allowed.example.com')
assert.equal(allowedCors.headers.get('vary'), 'Origin')
const blockedCors = await lockedCorsHandler(new Request(`${baseUrl}/items`, {
  method: 'GET',
  headers: {
    origin: 'https://blocked.example.com'
  }
}))
const blockedCorsError = await readError(blockedCors)
assert.equal(blockedCors.status, 403)
assert.equal(blockedCors.headers.get('access-control-allow-origin'), null)
assert.equal(blockedCorsError.code, 'FORBIDDEN')

const protectedRuntimeHandler = createBffFetchHandler(createBffState([]), {
  environment: 'prod',
  moderationSecret: 'fetch-moderation-secret'
})
const protectedRuntimeResponse = await protectedRuntimeHandler(new Request(`${baseUrl}/items`, {
  method: 'GET'
}))
const protectedRuntimeError = await readError(protectedRuntimeResponse)
assert.equal(protectedRuntimeResponse.status, 503)
assert.equal(protectedRuntimeError.code, 'SERVICE_UNAVAILABLE')
assert.match(protectedRuntimeError.message, /不能使用轻量 Fetch adapter/)
assert.match(protectedRuntimeError.message, /backend\/src\/server\.mjs/)

console.log('BFF fetch smoke checks passed')

function assertNoPublicCoordinates(item) {
  assert.equal(item.location.latitude, undefined)
  assert.equal(item.location.longitude, undefined)
  assert.equal(item.location.name, undefined)
  assert.equal(item.location.address, undefined)
}

function findSessionForUser(state, userId) {
  return state.sessions.find((session) => session.userId === userId)
}

async function get(path, token = '', options = {}) {
  return readData(await raw(path, {
    method: 'GET',
    token,
    ...options
  }))
}

async function post(path, data, token = '') {
  return readData(await raw(path, {
    method: 'POST',
    data,
    token
  }))
}

async function patch(path, data, token = '', options = {}) {
  return readData(await raw(path, {
    method: 'PATCH',
    data,
    token,
    ...options
  }))
}

async function uploadItemImage(token) {
  const form = new FormData()
  form.set('usage', 'item_image')
  form.set('file', new Blob(['image-bytes'], {
    type: 'image/jpeg'
  }), 'item.jpg')

  return readData(await handler(new Request(`${baseUrl}/uploads/items`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  })))
}

async function raw(path, options = {}) {
  return handler(new Request(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.data ? { 'content-type': 'application/json' } : {}),
      ...options.header
    },
    body: options.data ? JSON.stringify(options.data) : undefined
  }))
}

async function readData(response) {
  const payload = await response.json()

  assert.equal(response.status, 200, payload.message)

  return payload.data
}

async function readError(response) {
  const payload = await response.json()

  assert.notEqual(response.status, 200)
  assert.equal(Boolean(payload.code), true)
  assert.equal(Boolean(payload.message), true)

  return payload
}
