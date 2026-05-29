import assert from 'node:assert/strict'
import { createBffState, DISPUTE_RESOLUTION, handleBffRequest, ITEM_STATUS, TRADE_STATUS } from '../src/bff/handler.js'
import { USER_AGREEMENT_VERSION } from '../src/config/app.js'

const originalGoodsCommEnv = process.env.GOODS_COMM_ENV
const originalSessionSecret = process.env.GOODS_COMM_SESSION_SECRET

process.env.GOODS_COMM_ENV = 'prod'
process.env.GOODS_COMM_SESSION_SECRET = 'prod-session-secret-for-smoke-only'
await assert.rejects(
  () => handleBffRequest('/auth/login', {
    method: 'POST',
    data: {
      provider: 'weixin',
      code: 'prod-missing-agreement',
      userInfo: {
        nickname: '缺协议用户',
        avatarUrl: ''
      }
    }
  }, createBffState([])),
  /用户协议和隐私政策/
)

delete process.env.GOODS_COMM_SESSION_SECRET
await assert.rejects(
  () => handleBffRequest('/auth/login', {
    method: 'POST',
    data: withAgreement({
      provider: 'weixin',
      code: 'prod-missing-session-secret',
      userInfo: {
        nickname: '缺密钥用户',
        avatarUrl: ''
      }
    })
  }, createBffState([])),
  /会话密钥配置未完成/
)
process.env.GOODS_COMM_SESSION_SECRET = 'prod-session-secret-for-smoke-only'
const protectedSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: withAgreement({
    provider: 'weixin',
    code: 'prod-session-secret-ok',
    userInfo: {
      nickname: '密钥用户',
      avatarUrl: ''
    }
  })
}, createBffState([]))
assert.equal(protectedSession.token.startsWith('session_'), true)
assert.equal(protectedSession.user.agreementVersion, USER_AGREEMENT_VERSION)
restoreSessionEnvironment()

const state = createBffState([])
const platformIdentitySession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'client-code-should-not-be-user-id',
    platformIdentity: {
      provider: 'weixin',
      platformId: 'server-openid-1',
      unionId: 'server-union-1'
    },
    userInfo: {
      nickname: '平台身份用户',
      avatarUrl: ''
    }
  }
}, state)
assert.equal(platformIdentitySession.user.platformId, 'server-openid-1')
assert.equal(platformIdentitySession.user.unionId, 'server-union-1')

const sellerSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: withAgreement({
    provider: 'weixin',
    code: 'seller-login-code',
    userInfo: {
      nickname: '卖家',
      avatarUrl: 'https://avatar.example/seller.png'
    }
  })
}, state)
const buyerSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'buyer-login-code',
    userInfo: {
      nickname: '买家',
      avatarUrl: 'https://avatar.example/buyer.png'
    }
  }
}, state)

assert.ok(sellerSession.token)
assert.ok(buyerSession.token)
assert.notEqual(sellerSession.user.id, buyerSession.user.id)
assert.equal(sellerSession.user.agreementVersion, USER_AGREEMENT_VERSION)
assert.equal(state.sessions.length, 3)
assert.equal(state.sessions.every((session) => session.token === undefined), true)
assert.equal(state.sessions.every((session) => session.tokenHash), true)
assert.equal(state.sessions.every((session) => /^[a-f0-9]{64}$/.test(session.tokenHash)), true)
assert.equal(sellerSession.token.startsWith('session_'), true)
assert.equal(sellerSession.token.length > 40, true)

const expiringSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'expired-login-code',
    userInfo: {
      nickname: '过期用户',
      avatarUrl: ''
    }
  }
}, state)
findSessionForUser(state, expiringSession.user.id).expiresAt = Date.now() - 1
await assert.rejects(
  () => handleBffRequest('/items/mine', {
    method: 'GET',
    token: expiringSession.token
  }, state),
  /登录态无效/
)

const logoutSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'logout-login-code',
    userInfo: {
      nickname: '退出用户',
      avatarUrl: ''
    }
  }
}, state)
const logoutResult = await handleBffRequest('/auth/logout', {
  method: 'POST',
  token: logoutSession.token
}, state)
assert.equal(logoutResult.ok, true)
assert.equal(Boolean(findSessionForUser(state, logoutSession.user.id).revokedAt), true)
await assert.rejects(
  () => handleBffRequest('/items/mine', {
    method: 'GET',
    token: logoutSession.token
  }, state),
  /登录态无效/
)

const region = await handleBffRequest('/lbs/resolve-region', {
  method: 'POST',
  data: {
    latitude: 31.22945,
    longitude: 121.45494,
    coordType: 'gcj02'
  }
}, state)

assert.equal(region.communityId, 'sh-jingan-shimen')

const upload = await handleBffRequest('/uploads/items', {
  method: 'UPLOAD',
  token: sellerSession.token,
  filePath: '/tmp/item.jpg'
}, state)

assert.equal(upload.status, 'uploaded')

const item = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerSession.token,
  data: {
    title: 'BFF 烟测商品',
    price: 128,
    category: 'home',
    condition: 'good',
    description: '用于 BFF 契约烟测',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      latitude: 31.22945,
      longitude: 121.45494,
      communityId: 'client-spoofed-community',
      communityName: region.communityName,
      streetId: 'client-spoofed-street',
      streetName: region.streetName
    }
  }
}, state)

assert.equal(item.seller.id, sellerSession.user.id)
assert.equal(item.seller.contactCode, undefined)
assert.equal(item.status, ITEM_STATUS.ONLINE)
assert.equal(item.images.length, 1)
assert.equal(item.location.communityId, region.communityId)
assert.equal(item.location.streetId, region.streetId)
assertNoPublicCoordinates(item)
await assert.rejects(
  () => handleBffRequest('/items', {
    method: 'POST',
    token: sellerSession.token,
    data: {
      title: 'BFF 烟测商品',
      price: 129,
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
        communityId: region.communityId,
        streetId: region.streetId
      }
    }
  }, state),
  /已存在同名在售或审核中的商品/
)

const idempotentItemPayload = {
  title: 'BFF 幂等发布商品',
  price: 88,
  category: 'electronics',
  condition: 'good',
  description: '相同幂等键重复提交必须返回同一商品',
  images: [upload],
  tradeScope: {
    type: 'community',
    label: '同社区',
    radiusMeters: 1200
  },
  location: {
    latitude: 31.22945,
    longitude: 121.45494,
    communityId: region.communityId,
    streetId: region.streetId
  }
}
const idempotentItem = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerSession.token,
  idempotencyKey: 'bff_item_create_key_001',
  data: idempotentItemPayload
}, state)
const replayedItem = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerSession.token,
  idempotencyKey: 'bff_item_create_key_001',
  data: idempotentItemPayload
}, state)
assert.equal(replayedItem.id, idempotentItem.id)
assert.equal(state.items.filter((candidate) => candidate.title === idempotentItemPayload.title).length, 1)
await assert.rejects(
  () => handleBffRequest('/items', {
    method: 'POST',
    token: sellerSession.token,
    idempotencyKey: 'bff_item_create_key_001',
    data: {
      ...idempotentItemPayload,
      price: 89
    }
  }, state),
  /幂等键已被不同请求使用/
)

const listed = await handleBffRequest('/items', {
  method: 'GET',
  data: {
    category: 'home',
    latitude: 31.2301,
    longitude: 121.4556
  }
}, state)

assert.equal(listed.items.length, 1)
assert.equal(listed.items[0].seller.contactCode, undefined)
assertNoPublicCoordinates(listed.items[0])
assert.equal(Number.isFinite(Number(listed.items[0].distanceMeters)), true)

const listedWithoutLocation = await handleBffRequest('/items', {
  method: 'GET',
  data: {
    category: 'home'
  }
}, state)
assert.equal(listedWithoutLocation.items.some((candidate) => candidate.id === item.id), false)

const listedOutsideScope = await handleBffRequest('/items', {
  method: 'GET',
  data: {
    category: 'home',
    latitude: 31.23648,
    longitude: 121.44373
  }
}, state)
assert.equal(listedOutsideScope.items.some((candidate) => candidate.id === item.id), false)

await assert.rejects(
  () => handleBffRequest('/trades', {
    method: 'POST',
    token: buyerSession.token,
    data: {
      itemId: item.id,
      buyerLocation: {
        latitude: 31.2301,
        longitude: 121.4556,
        accuracy: 60,
        capturedAt: Date.now() - 6 * 60 * 1000
      }
    }
  }, state),
  /当前位置已过期/
)
await assert.rejects(
  () => handleBffRequest('/trades', {
    method: 'POST',
    token: buyerSession.token,
    data: {
      itemId: item.id,
      buyerLocation: {
        latitude: 31.2301,
        longitude: 121.4556,
        accuracy: 300,
        capturedAt: Date.now()
      }
    }
  }, state),
  /定位精度约 300m/
)
await assert.rejects(
  () => handleBffRequest('/trades', {
    method: 'POST',
    token: buyerSession.token,
    data: {
      itemId: item.id,
      buyerLocation: {
        latitude: 31.2301,
        longitude: 121.4556,
        capturedAt: Date.now()
      }
    }
  }, state),
  /未获取到定位精度/
)

const trade = await handleBffRequest('/trades', {
  method: 'POST',
  token: buyerSession.token,
  data: {
    itemId: item.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 60,
      capturedAt: Date.now()
    }
  }
}, state)

assert.equal(trade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)
assert.equal(trade.locationAudit.regionStatus, 'match')
assert.equal(trade.contactCode, '')
const sellerNotifications = await handleBffRequest('/notifications', {
  method: 'GET',
  token: sellerSession.token
}, state)
assert.equal(sellerNotifications.notifications[0].type, 'trade_created')
assert.equal(sellerNotifications.notifications[0].targetId, trade.id)
const readSellerNotification = await handleBffRequest(`/notifications/${sellerNotifications.notifications[0].id}/read`, {
  method: 'PATCH',
  token: sellerSession.token
}, state)
assert.equal(Boolean(readSellerNotification.readAt), true)

const duplicateTrade = await handleBffRequest('/trades', {
  method: 'POST',
  token: buyerSession.token,
  data: {
    itemId: item.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 60,
      capturedAt: Date.now()
    }
  }
}, state)
assert.equal(duplicateTrade.id, trade.id)

const secondBuyerSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'second-buyer-login-code',
    userInfo: {
      nickname: '第二个买家',
      avatarUrl: ''
    }
  }
}, state)
await assert.rejects(
  () => handleBffRequest('/trades', {
    method: 'POST',
    token: secondBuyerSession.token,
    data: {
      itemId: item.id,
      buyerLocation: {
        latitude: 31.2301,
        longitude: 121.4556,
        accuracy: 60,
        capturedAt: Date.now()
      }
    }
  }, state),
  /物品已有交易处理中/
)

const riskSellerSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'risk-seller-login-code',
    userInfo: {
      nickname: '风控卖家',
      avatarUrl: ''
    }
  }
}, state)
const riskBuyerSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'risk-buyer-login-code',
    userInfo: {
      nickname: '风控买家',
      avatarUrl: ''
    }
  }
}, state)
const riskUpload = await handleBffRequest('/uploads/items', {
  method: 'UPLOAD',
  token: riskSellerSession.token,
  filePath: '/tmp/risk-item.jpg'
}, state)
const riskItem = await handleBffRequest('/items', {
  method: 'POST',
  token: riskSellerSession.token,
  data: {
    title: '风控封禁商品',
    price: 66,
    category: 'home',
    condition: 'good',
    description: '封禁卖家时应下架并冻结交易',
    images: [riskUpload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      latitude: 31.22945,
      longitude: 121.45494,
      communityId: region.communityId,
      streetId: region.streetId
    }
  }
}, state)
const riskTrade = await handleBffRequest('/trades', {
  method: 'POST',
  token: riskBuyerSession.token,
  data: {
    itemId: riskItem.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 60,
      capturedAt: Date.now()
    }
  }
}, state)
assert.equal(riskTrade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)
const blockedRiskSeller = await handleBffRequest(`/ops/users/${riskSellerSession.user.id}/status`, {
  method: 'POST',
  idempotencyKey: 'ops_user_block_key_001',
  data: {
    status: 'blocked',
    actorId: 'risk-smoke',
    reason: '疑似批量违规发布'
  }
}, state)
assert.equal(blockedRiskSeller.user.status, 'blocked')
assert.equal(blockedRiskSeller.affected.revokedSessions, 1)
assert.equal(blockedRiskSeller.affected.removedItems, 1)
assert.equal(blockedRiskSeller.affected.disputedTrades, 1)
assert.equal(state.items.find((candidate) => candidate.id === riskItem.id).status, ITEM_STATUS.REMOVED)
assert.equal(state.items.find((candidate) => candidate.id === riskItem.id).reviewStatus, 'user_blocked')
assert.equal(state.trades.find((candidate) => candidate.id === riskTrade.id).status, TRADE_STATUS.DISPUTED)
await assert.rejects(
  () => handleBffRequest('/items/mine', {
    method: 'GET',
    token: riskSellerSession.token
  }, state),
  /登录态无效/
)
const replayedBlockedRiskSeller = await handleBffRequest(`/ops/users/${riskSellerSession.user.id}/status`, {
  method: 'POST',
  idempotencyKey: 'ops_user_block_key_001',
  data: {
    status: 'blocked',
    actorId: 'risk-smoke',
    reason: '疑似批量违规发布'
  }
}, state)
assert.equal(replayedBlockedRiskSeller.affected.removedItems, 1)
const blockedUsers = await handleBffRequest('/ops/users', {
  method: 'GET',
  data: {
    status: 'blocked',
    limit: 20
  }
}, state)
assert.equal(blockedUsers.users.some((user) => user.id === riskSellerSession.user.id), true)
const unblockedRiskSeller = await handleBffRequest(`/ops/users/${riskSellerSession.user.id}/status`, {
  method: 'POST',
  data: {
    status: 'active',
    actorId: 'risk-smoke',
    reason: '误封恢复'
  }
}, state)
assert.equal(unblockedRiskSeller.user.status, 'active')
assert.equal(unblockedRiskSeller.user.unblockedBy, 'risk-smoke')

const lockedItem = await handleBffRequest(`/items/${item.id}`, {
  method: 'GET'
}, state)

assert.equal(lockedItem.status, ITEM_STATUS.RESERVED)
assertNoPublicCoordinates(lockedItem)
await assert.rejects(
  () => handleBffRequest(`/items/${item.id}/status`, {
    method: 'PATCH',
    token: sellerSession.token,
    data: {
      status: ITEM_STATUS.REMOVED
    }
  }, state),
  /交易中的商品不能手动下架/
)

const confirmed = await handleBffRequest(`/trades/${trade.id}/status`, {
  method: 'PATCH',
  token: sellerSession.token,
  idempotencyKey: 'bff_trade_confirm_key_001',
  data: {
    status: TRADE_STATUS.PENDING_MEETUP
  }
}, state)
const replayedConfirmed = await handleBffRequest(`/trades/${trade.id}/status`, {
  method: 'PATCH',
  token: sellerSession.token,
  idempotencyKey: 'bff_trade_confirm_key_001',
  data: {
    status: TRADE_STATUS.PENDING_MEETUP
  }
}, state)

assert.equal(confirmed.status, TRADE_STATUS.PENDING_MEETUP)
assert.equal(replayedConfirmed.contactCode, confirmed.contactCode)
assert.equal(state.trades.find((candidate) => candidate.id === trade.id).timeline.filter((event) => event.status === TRADE_STATUS.PENDING_MEETUP).length, 1)
assert.match(confirmed.contactCode, /^GC-[A-F0-9]{6}-[A-Z0-9]{4}$/)
assert.notEqual(confirmed.contactCode, sellerSession.user.contactCode)
assert.equal(confirmed.contactCodeExpiresAt > Date.now(), true)
const storedConfirmedTrade = state.trades.find((candidate) => candidate.id === trade.id)
storedConfirmedTrade.contactCodeExpiresAt = Date.now() - 1
const replayedConfirmedAfterContactExpiry = await handleBffRequest(`/trades/${trade.id}/status`, {
  method: 'PATCH',
  token: sellerSession.token,
  idempotencyKey: 'bff_trade_confirm_key_001',
  data: {
    status: TRADE_STATUS.PENDING_MEETUP
  }
}, state)
assert.equal(replayedConfirmedAfterContactExpiry.contactCode, '')
assert.equal(replayedConfirmedAfterContactExpiry.contactCodeExpiresAt, null)
const buyerTradesAfterContactExpiry = await handleBffRequest('/trades', {
  method: 'GET',
  token: buyerSession.token
}, state)
const expiredContactTrade = buyerTradesAfterContactExpiry.trades.find((candidate) => candidate.id === trade.id)
assert.equal(expiredContactTrade.contactCode, '')
assert.equal(expiredContactTrade.contactCodeExpiresAt, null)
assert.equal(state.trades.find((candidate) => candidate.id === trade.id).contactCode, '')
assert.equal(state.trades.find((candidate) => candidate.id === trade.id).contactCodeExpiresAt, null)
const buyerNotifications = await handleBffRequest('/notifications', {
  method: 'GET',
  token: buyerSession.token
}, state)
assert.equal(buyerNotifications.notifications[0].type, 'trade_confirmed')
assert.equal(buyerNotifications.notifications[0].targetId, trade.id)
await assert.rejects(
  () => handleBffRequest(`/trades/${trade.id}/review`, {
    method: 'POST',
    token: buyerSession.token,
    data: {
      rating: 5,
      content: '未完成前不能评价'
    }
  }, state),
  /交易完成后才能评价/
)

const completed = await handleBffRequest(`/trades/${trade.id}/status`, {
  method: 'PATCH',
  token: buyerSession.token,
  data: {
    status: TRADE_STATUS.COMPLETED
  }
}, state)

assert.equal(completed.status, TRADE_STATUS.COMPLETED)
assert.equal(completed.contactCode, '')
assert.equal(completed.contactCodeExpiresAt, null)
const sellerNotificationsAfterComplete = await handleBffRequest('/notifications', {
  method: 'GET',
  token: sellerSession.token
}, state)
assert.equal(sellerNotificationsAfterComplete.notifications.some((notification) => notification.type === 'trade_completed'), true)
const reviewPayload = {
  rating: 5,
  content: 'BFF 交易顺利',
  tags: ['准时', '物品一致']
}
const review = await handleBffRequest(`/trades/${trade.id}/review`, {
  method: 'POST',
  token: buyerSession.token,
  idempotencyKey: 'bff_trade_review_key_001',
  data: reviewPayload
}, state)
const replayedReview = await handleBffRequest(`/trades/${trade.id}/review`, {
  method: 'POST',
  token: buyerSession.token,
  idempotencyKey: 'bff_trade_review_key_001',
  data: reviewPayload
}, state)
assert.equal(review.tradeId, trade.id)
assert.equal(replayedReview.id, review.id)
assert.equal(review.itemId, item.id)
assert.equal(review.reviewer.id, buyerSession.user.id)
assert.equal(review.reviewee.id, sellerSession.user.id)
assert.equal(review.rating, 5)
assert.equal(state.reviews.filter((candidate) => candidate.tradeId === trade.id && candidate.reviewer?.id === buyerSession.user.id).length, 1)
const itemReviews = await handleBffRequest('/reviews', {
  method: 'GET',
  data: {
    itemId: item.id
  }
}, state)
assert.equal(itemReviews.reviews[0].id, review.id)
await assert.rejects(
  () => handleBffRequest(`/trades/${trade.id}/review`, {
    method: 'POST',
    token: buyerSession.token,
    data: {
      rating: 4,
      content: '重复评价'
    }
  }, state),
  /不能重复评价/
)
const buyerTradesAfterReview = await handleBffRequest('/trades', {
  method: 'GET',
  token: buyerSession.token
}, state)
assert.equal(buyerTradesAfterReview.trades.find((candidate) => candidate.id === trade.id).reviewedByMe, true)
const sellerNotificationsAfterReview = await handleBffRequest('/notifications', {
  method: 'GET',
  token: sellerSession.token
}, state)
assert.equal(sellerNotificationsAfterReview.notifications.some((notification) => notification.type === 'trade_reviewed'), true)

const soldItem = await handleBffRequest(`/items/${item.id}`, {
  method: 'GET'
}, state)

assert.equal(soldItem.status, ITEM_STATUS.SOLD)
await assert.rejects(
  () => handleBffRequest(`/items/${item.id}/status`, {
    method: 'PATCH',
    token: sellerSession.token,
    data: {
      status: ITEM_STATUS.ONLINE
    }
  }, state),
  /已售商品不能重新上架/
)
await assert.rejects(
  () => handleBffRequest(`/items/${item.id}/status`, {
    method: 'PATCH',
    token: sellerSession.token,
    data: {
      status: ITEM_STATUS.REMOVED
    }
  }, state),
  /已售商品不能手动下架/
)

const relistableItem = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerSession.token,
  data: {
    title: '可上下架商品',
    price: 68,
    category: 'home',
    condition: 'good',
    description: '用于上下架契约测试',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      latitude: 31.22945,
      longitude: 121.45494,
      communityId: region.communityId,
      streetId: region.streetId
    }
  }
}, state)
const removedBySeller = await handleBffRequest(`/items/${relistableItem.id}/status`, {
  method: 'PATCH',
  token: sellerSession.token,
  data: {
    status: ITEM_STATUS.REMOVED
  }
}, state)
assert.equal(removedBySeller.status, ITEM_STATUS.REMOVED)
const relistedBySeller = await handleBffRequest(`/items/${relistableItem.id}/status`, {
  method: 'PATCH',
  token: sellerSession.token,
  data: {
    status: ITEM_STATUS.ONLINE
  }
}, state)
assert.equal(relistedBySeller.status, ITEM_STATUS.ONLINE)

const rejectedItemPayload = {
  title: '违禁测试物品',
  price: 10,
  category: 'home',
  condition: 'good',
  description: '命中违禁内容',
  images: [upload],
  tradeScope: {
    type: 'community',
    label: '同社区',
    radiusMeters: 1200
  },
  location: {
    latitude: 31.22945,
    longitude: 121.45494,
    communityId: region.communityId,
    streetId: region.streetId
  }
}
await assert.rejects(
  () => handleBffRequest('/items', {
    method: 'POST',
    token: sellerSession.token,
    idempotencyKey: 'bff_rejected_item_key_001',
    data: rejectedItemPayload
  }, state),
  /商品未通过审核/
)
await assert.rejects(
  () => handleBffRequest('/items', {
    method: 'POST',
    token: sellerSession.token,
    idempotencyKey: 'bff_rejected_item_key_001',
    data: rejectedItemPayload
  }, state),
  /商品未通过审核/
)
assert.equal(state.moderationEvents.filter((event) =>
  event.targetType === 'item_submission' &&
  event.title === '违禁测试物品' &&
  event.status === 'rejected'
).length, 1)
assert.equal(state.idempotencyRecords.some((record) =>
  record.key === 'bff_rejected_item_key_001' &&
  record.status === 'committed_error' &&
  /商品未通过审核/.test(record.response?.message || '')
), true)
assert.equal(state.items.some((candidate) => candidate.title === '违禁测试物品'), false)

const pendingReviewItem = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerSession.token,
  data: {
    title: '待审图片商品',
    price: 18,
    category: 'home',
    condition: 'good',
    description: '图片未完成服务端审核',
    images: ['local://pending-review.jpg'],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      latitude: 31.22945,
      longitude: 121.45494,
      communityId: region.communityId,
      streetId: region.streetId
    }
  }
}, state)

assert.equal(pendingReviewItem.status, ITEM_STATUS.PENDING_REVIEW)
assert.equal(pendingReviewItem.reviewStatus, 'pending_media_review')
await assert.rejects(
  () => handleBffRequest(`/items/${pendingReviewItem.id}`, {
    method: 'GET'
  }, state),
  /物品不存在或已下架/
)
await assert.rejects(
  () => handleBffRequest(`/items/${pendingReviewItem.id}/status`, {
    method: 'PATCH',
    token: sellerSession.token,
    data: {
      status: ITEM_STATUS.ONLINE
    }
  }, state),
  /审核中的商品不能手动上架/
)

const mineWithPendingReview = await handleBffRequest('/items/mine', {
  method: 'GET',
  token: sellerSession.token
}, state)
assert.equal(mineWithPendingReview.items.some((candidate) => candidate.id === pendingReviewItem.id), true)
const approvedPendingReviewItem = await handleBffRequest(`/moderation/items/${pendingReviewItem.id}/review`, {
  method: 'POST',
  data: {
    status: 'approved',
    actorId: 'moderation-smoke'
  }
}, state)
assert.equal(approvedPendingReviewItem.status, ITEM_STATUS.ONLINE)
const visibleAfterReview = await handleBffRequest(`/items/${pendingReviewItem.id}`, {
  method: 'GET'
}, state)
assert.equal(visibleAfterReview.id, pendingReviewItem.id)

const mediaTraceItem = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerSession.token,
  data: {
    title: '微信 trace 审核商品',
    price: 28,
    category: 'home',
    condition: 'good',
    description: '通过图片 trace_id 完成异步审核',
    images: [{
      id: 'trace-image-smoke',
      url: 'https://cdn.example.com/trace-image-smoke.jpg',
      status: 'pending_review',
      traceId: 'trace-media-smoke'
    }],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      latitude: 31.22945,
      longitude: 121.45494,
      communityId: region.communityId,
      streetId: region.streetId
    }
  }
}, state)
assert.equal(mediaTraceItem.status, ITEM_STATUS.PENDING_REVIEW)
assert.equal(mediaTraceItem.reviewStatus, 'pending_media_review')
const approvedByMediaTrace = await handleBffRequest('/moderation/media/trace-media-smoke/review', {
  method: 'POST',
  data: {
    status: 'approved',
    actorId: 'wechat-media-check-smoke'
  }
}, state)
assert.equal(approvedByMediaTrace.status, ITEM_STATUS.ONLINE)
assert.equal(approvedByMediaTrace.images[0].status, 'uploaded')
const visibleAfterMediaTraceReview = await handleBffRequest(`/items/${mediaTraceItem.id}`, {
  method: 'GET'
}, state)
assert.equal(visibleAfterMediaTraceReview.id, mediaTraceItem.id)

const reportLockedItem = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerSession.token,
  data: {
    title: '举报锁定商品',
    price: 72,
    category: 'home',
    condition: 'good',
    description: '高风险举报后交易应进入争议',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      latitude: 31.22945,
      longitude: 121.45494,
      communityId: region.communityId,
      streetId: region.streetId
    }
  }
}, state)
const reportLockedTrade = await handleBffRequest('/trades', {
  method: 'POST',
  token: buyerSession.token,
  data: {
    itemId: reportLockedItem.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 60,
      capturedAt: Date.now()
    }
  }
}, state)
const highRiskReport = await handleBffRequest('/reports', {
  method: 'POST',
  token: secondBuyerSession.token,
  data: {
    targetType: 'item',
    targetId: reportLockedItem.id,
    reason: 'fraud',
    description: '高风险举报应冻结交易'
  }
}, state)
const disputedByReport = state.trades.find((candidate) => candidate.id === reportLockedTrade.id)
assert.equal(disputedByReport.status, TRADE_STATUS.DISPUTED)
const sellerDisputes = await handleBffRequest('/disputes', {
  method: 'GET',
  token: sellerSession.token
}, state)
const sellerDispute = sellerDisputes.disputes.find((candidate) => candidate.tradeId === reportLockedTrade.id)
assert.equal(sellerDispute.status, 'open')
assert.equal(sellerDispute.source, 'report')
assert.equal(state.moderationEvents[0].reportId, highRiskReport.id)
const opsModerationQueue = await handleBffRequest('/ops/moderation-queue', {
  method: 'GET'
}, state)
assert.equal(opsModerationQueue.reports.some((candidate) => candidate.id === highRiskReport.id), true)
assert.equal(opsModerationQueue.disputes.some((candidate) => candidate.id === sellerDispute.id), true)
await assert.rejects(
  () => handleBffRequest(`/items/${reportLockedItem.id}`, {
    method: 'GET'
  }, state),
  /物品不存在或已下架/
)
await assert.rejects(
  () => handleBffRequest(`/moderation/items/${reportLockedItem.id}/review`, {
    method: 'POST',
    data: {
      status: 'approved',
      actorId: 'late-moderation-callback'
    }
  }, state),
  /审核回调不能重新上架已下架商品/
)
assert.equal(
  state.items.find((candidate) => candidate.id === reportLockedItem.id).status,
  ITEM_STATUS.REMOVED
)
assert.equal(
  state.trades.find((candidate) => candidate.id === reportLockedTrade.id).status,
  TRADE_STATUS.DISPUTED
)
const resolvedDispute = await handleBffRequest(`/moderation/disputes/${sellerDispute.id}/resolve`, {
  method: 'POST',
  data: {
    resolution: DISPUTE_RESOLUTION.REMOVE_ITEM,
    actorId: 'support-smoke',
    note: 'BFF smoke 下架争议商品'
  }
}, state)
assert.equal(resolvedDispute.status, 'resolved')
assert.equal(resolvedDispute.resolution, DISPUTE_RESOLUTION.REMOVE_ITEM)
assert.equal(
  state.trades.find((candidate) => candidate.id === reportLockedTrade.id).status,
  TRADE_STATUS.CANCELLED
)
const sellerNotificationsAfterDisputeResolve = await handleBffRequest('/notifications', {
  method: 'GET',
  token: sellerSession.token
}, state)
assert.equal(sellerNotificationsAfterDisputeResolve.notifications.some((notification) => notification.type === 'trade_dispute_resolved'), true)

const reportableItem = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerSession.token,
  data: {
    title: '可举报商品',
    price: 99,
    category: 'home',
    condition: 'good',
    description: '用于举报链路测试',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      latitude: 31.22945,
      longitude: 121.45494,
      communityId: region.communityId,
      streetId: region.streetId
    }
  }
}, state)

await assert.rejects(
  () => handleBffRequest('/reports', {
    method: 'POST',
    token: sellerSession.token,
    data: {
      targetType: 'item',
      targetId: reportableItem.id,
      reason: 'other',
      description: '不能举报自己发布的商品'
    }
  }, state),
  /不能举报自己发布的物品/
)
await assert.rejects(
  () => handleBffRequest('/reports', {
    method: 'POST',
    token: buyerSession.token,
    data: {
      targetType: 'item',
      targetId: reportableItem.id,
      reason: 'bogus',
      description: '无效举报原因'
    }
  }, state),
  /举报原因无效/
)
await assert.rejects(
  () => handleBffRequest('/reports', {
    method: 'POST',
    token: buyerSession.token,
    data: {
      targetType: 'item',
      targetId: 'item_missing',
      reason: 'other',
      description: '不存在的举报对象'
    }
  }, state),
  /举报对象不存在或已下架/
)

const report = await handleBffRequest('/reports', {
  method: 'POST',
  token: buyerSession.token,
  data: {
    targetType: 'item',
    targetId: reportableItem.id,
    reason: 'prohibited',
    description: '疑似违禁物品'
  }
}, state)

assert.equal(report.status, 'pending_review')
const duplicateReport = await handleBffRequest('/reports', {
  method: 'POST',
  token: buyerSession.token,
  data: {
    targetType: 'item',
    targetId: reportableItem.id,
    reason: 'prohibited',
    description: '重复举报应幂等'
  }
}, state)
assert.equal(duplicateReport.id, report.id)
assert.equal(
  state.reports.filter((candidate) =>
    candidate.reporter.id === buyerSession.user.id &&
    candidate.targetId === reportableItem.id &&
    candidate.reason === 'prohibited'
  ).length,
  1
)

await assert.rejects(
  () => handleBffRequest(`/items/${reportableItem.id}`, {
    method: 'GET'
  }, state),
  /物品不存在或已下架/
)
await assert.rejects(
  () => handleBffRequest(`/items/${reportableItem.id}/status`, {
    method: 'PATCH',
    token: sellerSession.token,
    data: {
      status: ITEM_STATUS.ONLINE
    }
  }, state),
  /违规或注销下架的商品不能重新上架/
)
const dismissedReport = await handleBffRequest(`/ops/reports/${report.id}/resolve`, {
  method: 'POST',
  data: {
    resolution: 'dismiss_report',
    actorId: 'support-smoke',
    note: '举报不成立，恢复商品'
  }
}, state)
assert.equal(dismissedReport.status, 'rejected')
assert.equal(dismissedReport.resolution, 'dismiss_report')
const restoredReportedItem = await handleBffRequest(`/items/${reportableItem.id}`, {
  method: 'GET'
}, state)
assert.equal(restoredReportedItem.status, ITEM_STATUS.ONLINE)
const opsReportsAfterDismiss = await handleBffRequest('/ops/reports', {
  method: 'GET',
  data: {
    status: 'pending_review'
  }
}, state)
assert.equal(opsReportsAfterDismiss.reports.some((candidate) => candidate.id === report.id), false)

const deleteSellerSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'delete-seller-code',
    userInfo: {
      nickname: '待注销卖家',
      avatarUrl: ''
    }
  }
}, state)
const deleteUpload = await handleBffRequest('/uploads/items', {
  method: 'UPLOAD',
  token: deleteSellerSession.token,
  filePath: '/tmp/delete-item.jpg'
}, state)
const deleteItem = await handleBffRequest('/items', {
  method: 'POST',
  token: deleteSellerSession.token,
  data: {
    title: '注销前商品',
    price: 50,
    category: 'home',
    condition: 'good',
    description: '账号注销后应下架',
    images: [deleteUpload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      latitude: 31.22945,
      longitude: 121.45494,
      communityId: region.communityId,
      streetId: region.streetId
    }
  }
}, state)

assert.equal(deleteItem.status, ITEM_STATUS.ONLINE)

const deletion = await handleBffRequest('/auth/delete-account', {
  method: 'POST',
  token: deleteSellerSession.token,
  data: {
    reason: 'user_requested'
  }
}, state)

assert.equal(deletion.ok, true)
assert.equal(
  state.sessions
    .filter((session) => session.userId === deleteSellerSession.user.id)
    .every((session) => session.revokedAt),
  true
)
await assert.rejects(
  () => handleBffRequest('/items/mine', {
    method: 'GET',
    token: deleteSellerSession.token
  }, state),
  /登录态无效/
)
await assert.rejects(
  () => handleBffRequest(`/items/${deleteItem.id}`, {
    method: 'GET'
  }, state),
  /物品不存在或已下架/
)

const deleteBuyerSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'delete-buyer-code',
    userInfo: {
      nickname: '待注销买家',
      avatarUrl: ''
    }
  }
}, state)
const releaseItem = await handleBffRequest('/items', {
  method: 'POST',
  token: sellerSession.token,
  data: {
    title: '买家注销释放商品',
    price: 60,
    category: 'home',
    condition: 'good',
    description: '买家注销后应解除锁定',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      latitude: 31.22945,
      longitude: 121.45494,
      communityId: region.communityId,
      streetId: region.streetId
    }
  }
}, state)
const releaseTrade = await handleBffRequest('/trades', {
  method: 'POST',
  token: deleteBuyerSession.token,
  data: {
    itemId: releaseItem.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 60,
      capturedAt: Date.now()
    }
  }
}, state)
assert.equal(releaseTrade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)
await handleBffRequest('/auth/delete-account', {
  method: 'POST',
  token: deleteBuyerSession.token,
  data: {
    reason: 'user_requested'
  }
}, state)
assert.equal(
  state.sessions
    .filter((session) => session.userId === deleteBuyerSession.user.id)
    .every((session) => session.revokedAt),
  true
)
const releasedItem = await handleBffRequest(`/items/${releaseItem.id}`, {
  method: 'GET'
}, state)
assert.equal(releasedItem.status, ITEM_STATUS.ONLINE)
await assert.rejects(
  () => handleBffRequest('/items/mine', {
    method: 'GET',
    token: deleteBuyerSession.token
  }, state),
  /登录态无效/
)

await assert.rejects(
  () => handleBffRequest('/trades', {
    method: 'POST',
    token: buyerSession.token,
    data: {
      itemId: item.id,
      buyerLocation: {
        latitude: 31.264,
        longitude: 121.51,
        accuracy: 60,
        capturedAt: Date.now()
      }
    }
  }, state),
  /物品已完成交易/
)

console.log('BFF smoke checks passed')

function assertNoPublicCoordinates(item) {
  assert.equal(item.location.latitude, undefined)
  assert.equal(item.location.longitude, undefined)
  assert.equal(item.location.name, undefined)
  assert.equal(item.location.address, undefined)
}

function findSessionForUser(state, userId) {
  return state.sessions.find((session) => session.userId === userId)
}

function withAgreement(data = {}) {
  return {
    ...data,
    agreement: {
      version: USER_AGREEMENT_VERSION,
      acceptedAt: Date.now(),
      source: 'smoke'
    }
  }
}

function restoreSessionEnvironment() {
  if (originalGoodsCommEnv === undefined) {
    delete process.env.GOODS_COMM_ENV
  } else {
    process.env.GOODS_COMM_ENV = originalGoodsCommEnv
  }

  if (originalSessionSecret === undefined) {
    delete process.env.GOODS_COMM_SESSION_SECRET
  } else {
    process.env.GOODS_COMM_SESSION_SECRET = originalSessionSecret
  }
}
