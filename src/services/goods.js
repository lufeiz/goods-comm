import {
  LOCATION_CACHE_TTL_MS,
  MAX_LOCATION_ACCURACY_METERS
} from '../config/app.js'
import { SEED_ITEMS } from '../data/seed.js'
import { resolveRegionFromSamples } from '../data/regions.js'
import { verifyTradeEligibility } from '../domain/eligibility.js'
import { distanceInMeters } from '../utils/geo.js'
import { createIdempotencyKey, hasRemoteApi, requestApi } from './api.js'
import { requireUserAgreement } from './compliance.js'
import { normalizeImages } from './media.js'

const GOODS_KEY = 'goods.items'
const TRADES_KEY = 'goods.trades'
const MODERATION_EVENTS_KEY = 'goods.moderationEvents'
const NOTIFICATIONS_KEY = 'goods.notifications'
const REVIEWS_KEY = 'goods.reviews'
const DISPUTES_KEY = 'goods.disputes'

export const ITEM_STATUS = {
  PENDING_REVIEW: 'pending_review',
  ONLINE: 'online',
  RESERVED: 'reserved',
  SOLD: 'sold',
  REMOVED: 'removed'
}

export const TRADE_STATUS = {
  PENDING_SELLER_CONFIRM: 'pending_seller_confirm',
  PENDING_MEETUP: 'pending_meetup',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed'
}

export const DISPUTE_STATUS = {
  OPEN: 'open',
  RESOLVED: 'resolved'
}

export const DISPUTE_RESOLUTION = {
  RELEASE_ITEM: 'release_item',
  COMPLETE_TRADE: 'complete_trade',
  REMOVE_ITEM: 'remove_item'
}

const ACTIVE_TRADE_STATUSES = [
  TRADE_STATUS.PENDING_SELLER_CONFIRM,
  TRADE_STATUS.PENDING_MEETUP
]
const TRADE_CONTACT_CODE_TTL_MS = 48 * 60 * 60 * 1000
const BLOCKED_CONTENT_WORDS = ['违禁', '假货', '诈骗', '管制']
const REPORT_TAKE_DOWN_REASONS = ['prohibited', 'fraud', 'privacy']

export async function fetchGoodsList(filters = {}) {
  if (!hasTrustedListLocation(filters.currentLocation)) {
    return []
  }

  if (hasRemoteApi()) {
    const result = await requestApi('/items', {
      data: serializeListFilters(filters)
    })

    return normalizeRemoteList(result)
      .map((item) => ({
        ...normalizeItem(item),
        distanceMeters: normalizeRemoteDistance(item, filters.currentLocation)
      }))
      .sort(sortByDistanceThenCreatedAt)
  }

  return listGoods(filters)
}

export async function fetchMyGoods(user) {
  if (!user?.id) {
    return []
  }

  if (hasRemoteApi()) {
    const result = await requestApi('/items/mine', {
      token: user.token
    })

    return normalizeRemoteList(result)
      .map(normalizeItem)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  return listMyGoods(user)
}

export async function fetchGoodsItem(id) {
  if (hasRemoteApi()) {
    const item = await requestApi(`/items/${id}`)
    return item ? normalizeItem(item) : null
  }

  return getGoodsItem(id)
}

export async function submitGoods(payload, seller) {
  requireUserAgreement('发布物品前请先阅读并同意用户协议和隐私政策')
  assertPublishPayload(payload)

  if (!seller?.id) {
    throw new Error('发布物品前需要先登录')
  }

  if (hasRemoteApi()) {
    const item = await requestApi('/items', {
      method: 'POST',
      token: seller.token,
      idempotencyKey: createIdempotencyKey('item_create', {
        sellerId: seller.id,
        payload: normalizePublishIdempotencyPayload(payload)
      }),
      data: {
        ...payload,
        sellerId: seller.id
      }
    })

    return normalizeItem(item)
  }

  return publishGoods(payload, seller)
}

export async function changeGoodsStatus(itemId, nextStatus, user) {
  if (hasRemoteApi()) {
    const item = await requestApi(`/items/${itemId}/status`, {
      method: 'PATCH',
      token: user?.token,
      idempotencyKey: createIdempotencyKey('item_status', {
        actorId: user?.id,
        itemId,
        nextStatus
      }),
      data: {
        status: nextStatus
      }
    })

    return normalizeItem(item)
  }

  return updateGoodsStatus(itemId, nextStatus, user)
}

export async function fetchTradeIntents(options = {}) {
  const user = options.user

  if (!user?.id) {
    return []
  }

  if (hasRemoteApi()) {
    const result = await requestApi('/trades', {
      token: user.token
    })

    return normalizeRemoteList(result).sort((a, b) => b.createdAt - a.createdAt)
  }

  return listTradeIntents(options)
}

export async function submitTradeIntent(item, eligibility, buyer) {
  requireUserAgreement('发起交易前请先阅读并同意用户协议和隐私政策')

  if (hasRemoteApi()) {
    const trade = await requestApi('/trades', {
      method: 'POST',
      token: buyer?.token,
      idempotencyKey: createIdempotencyKey('trade_create', {
        buyerId: buyer?.id,
        itemId: item?.id,
        buyerLocation: normalizeLocationIdempotencyPayload(eligibility?.profile?.location)
      }),
      data: {
        itemId: item?.id,
        buyerLocation: eligibility?.profile?.location || null,
        localEligibility: {
          code: eligibility?.code,
          distanceMeters: eligibility?.distanceMeters,
          radiusMeters: eligibility?.radiusMeters,
          regionStatus: eligibility?.regionCheck?.status
        }
      }
    })

    return trade
  }

  return createTradeIntent(item, eligibility, buyer)
}

export async function fetchNotifications(options = {}) {
  if (hasRemoteApi()) {
    const result = await requestApi('/notifications', {
      method: 'GET',
      token: options.user?.token
    })

    return Array.isArray(result?.notifications) ? result.notifications : []
  }

  const userId = options.user?.id

  return getStorageArray(NOTIFICATIONS_KEY)
    .filter((notification) => notification.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function markNotificationRead(notificationId, user) {
  if (hasRemoteApi()) {
    return requestApi(`/notifications/${notificationId}/read`, {
      method: 'PATCH',
      token: user?.token,
      idempotencyKey: createIdempotencyKey('notification_read', {
        userId: user?.id,
        notificationId
      })
    })
  }

  const notifications = getStorageArray(NOTIFICATIONS_KEY)
  const notification = notifications.find((candidate) => candidate.id === notificationId && candidate.userId === user?.id)

  if (!notification) {
    throw new Error('通知不存在')
  }

  const next = {
    ...notification,
    readAt: notification.readAt || Date.now()
  }

  saveNotifications(notifications.map((candidate) => candidate.id === notificationId ? next : candidate))

  return next
}

export async function fetchItemReviews(itemId) {
  if (!itemId) {
    return []
  }

  if (hasRemoteApi()) {
    const result = await requestApi('/reviews', {
      data: {
        itemId
      }
    })

    return Array.isArray(result?.reviews) ? result.reviews.map(normalizeReview) : []
  }

  return getStorageArray(REVIEWS_KEY)
    .filter((review) => review.itemId === itemId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(normalizeReview)
}

export async function submitTradeReview(tradeId, payload, reviewer) {
  if (hasRemoteApi()) {
    const review = await requestApi(`/trades/${tradeId}/review`, {
      method: 'POST',
      token: reviewer?.token,
      idempotencyKey: createIdempotencyKey('trade_review', {
        reviewerId: reviewer?.id,
        tradeId,
        payload
      }),
      data: payload
    })

    return normalizeReview(review)
  }

  return createTradeReview(tradeId, payload, reviewer)
}

export async function fetchDisputeCases(options = {}) {
  const user = options.user

  if (!user?.id) {
    return []
  }

  if (hasRemoteApi()) {
    const result = await requestApi('/disputes', {
      token: user.token
    })

    return Array.isArray(result?.disputes) ? result.disputes.map(normalizeDisputeCase) : []
  }

  return listDisputeCases(user)
}

export async function resolveTradeDispute(disputeId, payload = {}, actor = {}) {
  if (hasRemoteApi()) {
    const moderationSecret = actor.moderationSecret || payload.moderationSecret || ''
    const requestPayload = {
      ...payload
    }
    delete requestPayload.moderationSecret
    const disputeCase = await requestApi(`/moderation/disputes/${disputeId}/resolve`, {
      method: 'POST',
      idempotencyKey: createIdempotencyKey('dispute_resolve', {
        disputeId,
        actorId: actor.id || payload.actorId || 'support',
        payload: requestPayload
      }),
      header: moderationSecret ? {
        'x-moderation-secret': moderationSecret
      } : {},
      data: {
        ...requestPayload,
        actorId: actor.id || payload.actorId || 'support'
      }
    })

    return normalizeDisputeCase(disputeCase)
  }

  return resolveLocalTradeDispute(disputeId, payload, actor)
}

export async function changeTradeStatus(tradeId, nextStatus, actor) {
  if (hasRemoteApi()) {
    return requestApi(`/trades/${tradeId}/status`, {
      method: 'PATCH',
      token: actor?.token,
      idempotencyKey: createIdempotencyKey('trade_status', {
        actorId: actor?.id,
        tradeId,
        nextStatus
      }),
      data: {
        status: nextStatus
      }
    })
  }

  return updateTradeStatus(tradeId, nextStatus, actor)
}

export function listGoods(filters = {}) {
  const keyword = normalizeKeyword(filters.keyword)
  const category = filters.category || 'all'
  const currentLocation = hasTrustedListLocation(filters.currentLocation)
    ? filters.currentLocation
    : null
  const currentRegion = normalizeCurrentRegion(filters, currentLocation)
  const visibleStatuses = filters.includeUnavailable
    ? [ITEM_STATUS.ONLINE, ITEM_STATUS.RESERVED, ITEM_STATUS.SOLD]
    : [ITEM_STATUS.ONLINE]

  return ensureGoods()
    .filter((item) => visibleStatuses.includes(item.status || ITEM_STATUS.ONLINE))
    .filter((item) => item.status !== ITEM_STATUS.REMOVED)
    .filter((item) => category === 'all' || item.category === category)
    .filter((item) => {
      if (!keyword) {
        return true
      }

      return `${item.title} ${item.description}`.toLowerCase().includes(keyword)
    })
    .map((item) => buildLocalListItem(item, currentLocation, currentRegion))
    .filter(Boolean)
    .sort(sortByDistanceThenCreatedAt)
}

export function listMyGoods(user) {
  if (!user?.id) {
    return []
  }

  return ensureGoods()
    .filter((item) => item.seller?.id === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function getGoodsItem(id) {
  return ensureGoods().find((item) =>
    item.id === id &&
    ![ITEM_STATUS.PENDING_REVIEW, ITEM_STATUS.REMOVED].includes(item.status)
  ) || null
}

export function publishGoods(payload, seller) {
  assertPublishPayload(payload)

  if (!seller?.id) {
    throw new Error('发布物品前需要先登录')
  }

  const review = reviewLocalItemContent(payload)
  assertNoDuplicateActiveItem(seller.id, payload, ensureGoods())

  if (!review.approved) {
    saveLocalModerationEvent({
      id: createId('moderation'),
      actorId: seller.id,
      targetType: 'item_submission',
      title: String(payload.title || '').trim(),
      status: review.status,
      reasons: review.reasons,
      createdAt: Date.now()
    })

    throw new Error(`商品未通过审核：${review.reasons.join('、')}`)
  }

  const items = ensureGoods()
  const item = {
    id: createId('item'),
    title: payload.title,
    price: Number(payload.price),
    category: payload.category,
    condition: payload.condition,
    description: payload.description,
    seller: normalizeSeller(seller),
    images: normalizeImages(payload.images),
    coverTone: payload.coverTone || 'sage',
    tradeScope: payload.tradeScope,
    location: payload.location,
    status: ITEM_STATUS.ONLINE,
    reviewStatus: 'approved_auto',
    reviewReasons: review.reasons,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  saveGoods([item, ...items])

  return item
}

export function updateGoodsStatus(itemId, nextStatus, user) {
  const items = ensureGoods()
  const item = items.find((candidate) => candidate.id === itemId)

  if (!item) {
    throw new Error('物品不存在或已下架')
  }

  if (item.seller?.id && item.seller.id !== user?.id) {
    throw new Error('只能管理自己发布的物品')
  }

  const allowed = [ITEM_STATUS.ONLINE, ITEM_STATUS.REMOVED]

  if (!allowed.includes(nextStatus)) {
    throw new Error('暂不支持该物品状态操作')
  }

  assertItemStatusTransition(item, nextStatus)

  const nextItems = items.map((candidate) => candidate.id === itemId
    ? {
        ...candidate,
        status: nextStatus,
        updatedAt: Date.now()
      }
    : candidate)

  saveGoods(nextItems)

  return nextItems.find((candidate) => candidate.id === itemId)
}

export function applyLocalReportToItem(itemId, reason, reporterId = '') {
  if (!REPORT_TAKE_DOWN_REASONS.includes(reason)) {
    return null
  }

  const items = ensureGoods()
  const item = items.find((candidate) => candidate.id === itemId)

  if (!item || item.status === ITEM_STATUS.SOLD) {
    return item || null
  }

  const nextItems = items.map((candidate) => candidate.id === itemId
    ? {
        ...candidate,
        status: ITEM_STATUS.REMOVED,
        reviewStatus: 'reported_removed',
        updatedAt: Date.now()
      }
    : candidate)

  saveGoods(nextItems)
  disputeActiveTradesForReportedItem(itemId, reporterId)

  return nextItems.find((candidate) => candidate.id === itemId)
}

function disputeActiveTradesForReportedItem(itemId, reporterId = '') {
  const now = Date.now()
  const trades = getStorageArray(TRADES_KEY)
  const nextTrades = trades.map((trade) => {
    if (trade.itemId !== itemId || !ACTIVE_TRADE_STATUSES.includes(trade.status)) {
      return trade
    }

    return {
      ...trade,
      status: TRADE_STATUS.DISPUTED,
      contactCode: '',
      contactCodeExpiresAt: null,
      timeline: [
        ...(trade.timeline || []),
        createTimelineEvent(TRADE_STATUS.DISPUTED, reporterId, '高风险举报触发风控复核')
      ],
      updatedAt: now
    }
  })

  saveTrades(nextTrades)

  for (const trade of nextTrades) {
    if (trade.itemId !== itemId || !ACTIVE_TRADE_STATUSES.includes(trades.find((candidate) => candidate.id === trade.id)?.status)) {
      continue
    }

    ensureDisputeCaseForTrade(trade, {
      source: 'report',
      opener: {
        id: reporterId,
        nickname: '举报用户'
      },
      reason: 'high_risk_report',
      description: '高风险举报触发风控复核'
    })
    pushTradeNotification({
      userId: trade.buyer?.id,
      type: 'trade_disputed',
      title: '交易转入争议',
      body: `「${trade.itemTitle}」因高风险举报转入争议。`,
      trade
    })
    pushTradeNotification({
      userId: trade.seller?.id,
      type: 'trade_disputed',
      title: '交易转入争议',
      body: `「${trade.itemTitle}」因高风险举报转入争议。`,
      trade
    })
  }
}

export function deleteUserOwnedData(user) {
  if (!user?.id) {
    return {
      removedItems: 0,
      cancelledTrades: 0
    }
  }

  const now = Date.now()
  const items = ensureGoods()
  const trades = getStorageArray(TRADES_KEY)
  const cancelledItemIds = new Set()
  const cancelledTradeIds = new Set()
  let cancelledTrades = 0

  const nextTrades = trades.map((trade) => {
    const belongsToUser = trade.buyer?.id === user.id || trade.seller?.id === user.id

    if (!belongsToUser || !ACTIVE_TRADE_STATUSES.includes(trade.status)) {
      return trade
    }

    cancelledTrades += 1
    cancelledItemIds.add(trade.itemId)
    cancelledTradeIds.add(trade.id)

    return {
      ...trade,
      status: TRADE_STATUS.CANCELLED,
      contactCode: '',
      contactCodeExpiresAt: null,
      timeline: [
        ...(trade.timeline || []),
        createTimelineEvent(TRADE_STATUS.CANCELLED, user.id, '账号注销，交易自动取消')
      ],
      updatedAt: now
    }
  })

  let removedItems = 0
  const nextItems = items.map((item) => {
    if (item.seller?.id === user.id && [
      ITEM_STATUS.PENDING_REVIEW,
      ITEM_STATUS.ONLINE,
      ITEM_STATUS.RESERVED
    ].includes(item.status)) {
      removedItems += 1
      return {
        ...item,
        status: ITEM_STATUS.REMOVED,
        reviewStatus: 'seller_deleted',
        updatedAt: now
      }
    }

    if (
      item.status === ITEM_STATUS.RESERVED &&
      cancelledItemIds.has(item.id) &&
      !nextTrades.some((trade) => trade.itemId === item.id && ACTIVE_TRADE_STATUSES.includes(trade.status))
    ) {
      return {
        ...item,
        status: ITEM_STATUS.ONLINE,
        updatedAt: now
      }
    }

    return item
  })

  saveTrades(nextTrades)
  saveReviews(getStorageArray(REVIEWS_KEY).map((review) => ({
    ...review,
    reviewer: review.reviewer?.id === user.id
      ? normalizeTradeUser({
          id: user.id,
          nickname: '已注销用户',
          avatarUrl: ''
        })
      : review.reviewer,
    reviewee: review.reviewee?.id === user.id
      ? normalizeTradeUser({
          id: user.id,
          nickname: '已注销用户',
          avatarUrl: ''
        })
      : review.reviewee
  })))

  for (const trade of nextTrades) {
    if (cancelledTradeIds.has(trade.id)) {
      notifyTradeCounterpart(trade, user, {
        type: 'trade_cancelled',
        title: '交易已取消',
        body: `「${trade.itemTitle}」因对方账号注销已自动取消。`
      })
    }
  }
  saveGoods(nextItems)

  return {
    removedItems,
    cancelledTrades
  }
}

export function listTradeIntents(options = {}) {
  const userId = options.user?.id || options.userId || ''

  return clearExpiredTradeContactCodes(getStorageArray(TRADES_KEY))
    .filter((trade) => {
      if (!userId) {
        return true
      }

      return trade.buyer?.id === userId || trade.seller?.id === userId
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((trade) => ({
      ...trade,
      reviewedByMe: hasTradeReview(trade.id, userId),
      disputeCase: findDisputeCaseForTrade(trade.id)
    }))
}

export function listDisputeCases(user = {}) {
  const visibleTradeIds = new Set(listTradeIntents({
    user
  }).map((trade) => trade.id))

  return getStorageArray(DISPUTES_KEY)
    .filter((disputeCase) => visibleTradeIds.has(disputeCase.tradeId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(normalizeDisputeCase)
}

export function createTradeIntent(item, eligibility, buyer) {
  if (!buyer?.id) {
    throw new Error('发起交易前需要先登录')
  }

  const currentItem = item?.id ? getGoodsItem(item.id) : null

  if (!currentItem) {
    throw new Error('物品不存在或已下架')
  }

  if (currentItem.status === ITEM_STATUS.SOLD) {
    throw new Error('物品已完成交易')
  }

  const trades = clearExpiredTradeContactCodes(getStorageArray(TRADES_KEY))
  const duplicate = trades.find((trade) =>
    trade.itemId === currentItem.id &&
    trade.buyer?.id === buyer.id &&
    ACTIVE_TRADE_STATUSES.includes(trade.status)
  )

  if (duplicate) {
    return duplicate
  }

  if (currentItem.status === ITEM_STATUS.RESERVED) {
    throw new Error('物品已有交易处理中')
  }

  if (currentItem.seller?.id && currentItem.seller.id === buyer.id) {
    throw new Error('不能购买自己发布的物品')
  }

  if (!eligibility?.eligible) {
    throw new Error(eligibility?.message || '当前位置不满足交易要求')
  }

  const trade = {
    id: createId('trade'),
    itemId: currentItem.id,
    itemTitle: currentItem.title,
    price: currentItem.price,
    seller: normalizeTradeUser(currentItem.seller),
    buyer: normalizeTradeUser(buyer),
    contactCode: '',
    status: TRADE_STATUS.PENDING_SELLER_CONFIRM,
    eligibilityCode: eligibility.code,
    eligibilityMessage: eligibility.message,
    locationAudit: buildLocationAudit(eligibility),
    timeline: [
      createTimelineEvent(TRADE_STATUS.PENDING_SELLER_CONFIRM, buyer.id, '买家已发起交易意向')
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  saveTrades([trade, ...trades])
  reserveItem(currentItem.id)
  pushTradeNotification({
    userId: trade.seller.id,
    type: 'trade_created',
    title: '有新的交易意向',
    body: `${trade.buyer.nickname || '买家'}想购买「${trade.itemTitle}」，请在交易页确认是否可交易。`,
    trade
  })

  return trade
}

export function updateTradeStatus(tradeId, nextStatus, actor) {
  const trades = getStorageArray(TRADES_KEY)
  const trade = trades.find((candidate) => candidate.id === tradeId)

  if (!trade) {
    throw new Error('交易意向不存在')
  }

  assertTradePermission(trade, nextStatus, actor)

  const nextTrade = {
    ...trade,
    status: nextStatus,
    contactCode: nextStatus === TRADE_STATUS.PENDING_MEETUP
      ? trade.contactCode || createTradeContactCode(trade)
      : '',
    contactCodeExpiresAt: nextStatus === TRADE_STATUS.PENDING_MEETUP
      ? trade.contactCodeExpiresAt || Date.now() + TRADE_CONTACT_CODE_TTL_MS
      : null,
    timeline: [
      ...(trade.timeline || []),
      createTimelineEvent(nextStatus, actor?.id || '', statusText(nextStatus))
    ],
    updatedAt: Date.now()
  }
  const nextTrades = trades.map((candidate) => candidate.id === tradeId ? nextTrade : candidate)

  saveTrades(nextTrades)

  if (nextStatus === TRADE_STATUS.COMPLETED) {
    markItemSold(trade.itemId)
  }

  if (nextStatus === TRADE_STATUS.CANCELLED) {
    releaseItemReservation(trade.itemId)
  }

  if (nextStatus === TRADE_STATUS.DISPUTED) {
    ensureDisputeCaseForTrade(nextTrade, {
      source: 'user',
      opener: actor,
      reason: 'user_dispute'
    })
  }
  pushTradeStatusNotifications(nextTrade, nextStatus, actor)

  return {
    ...nextTrade,
    disputeCase: findDisputeCaseForTrade(nextTrade.id)
  }
}

export function statusText(status) {
  const map = {
    [ITEM_STATUS.PENDING_REVIEW]: '审核中',
    [ITEM_STATUS.ONLINE]: '在售',
    [ITEM_STATUS.RESERVED]: '已锁定',
    [ITEM_STATUS.SOLD]: '已售出',
    [ITEM_STATUS.REMOVED]: '已下架',
    [TRADE_STATUS.PENDING_SELLER_CONFIRM]: '待卖家确认',
    [TRADE_STATUS.PENDING_MEETUP]: '待约定验货',
    [TRADE_STATUS.COMPLETED]: '已完成',
    [TRADE_STATUS.CANCELLED]: '已取消',
    [TRADE_STATUS.DISPUTED]: '争议中'
  }

  return map[status] || '处理中'
}

export function getTradeContactText(trade = {}) {
  if (trade.status === TRADE_STATUS.PENDING_SELLER_CONFIRM) {
    return '卖家确认后生成一次性联系码'
  }

  if (trade.status !== TRADE_STATUS.PENDING_MEETUP) {
    return ''
  }

  if (!isTradeContactCodeActive(trade)) {
    return '一次性联系码已过期，请取消后重新发起交易'
  }

  return `一次性联系码：${trade.contactCode}`
}

export function getTradeActionConfirmOptions(action) {
  const map = {
    [TRADE_STATUS.PENDING_MEETUP]: {
      title: '确认可交易？',
      content: '确认后系统会生成本次交易的一次性联系码，请先确认物品仍可交易。',
      confirmText: '确认'
    },
    [TRADE_STATUS.COMPLETED]: {
      title: '标记交易完成？',
      content: '完成后物品会变为已售，不能重新上架。',
      confirmText: '标记完成'
    },
    [TRADE_STATUS.CANCELLED]: {
      title: '取消交易？',
      content: '取消后如果没有其他进行中交易，物品会重新回到在售。',
      confirmText: '取消交易'
    },
    [TRADE_STATUS.DISPUTED]: {
      title: '发起争议？',
      content: '争议会锁定商品和交易，等待人工或后续处理。',
      confirmText: '发起争议'
    }
  }

  return map[action] || null
}

export function isTradeActionAllowed(trade, action, user) {
  const isSeller = trade?.seller?.id && trade.seller.id === user?.id
  const isBuyer = trade?.buyer?.id && trade.buyer.id === user?.id

  if (!isSeller && !isBuyer) {
    return false
  }

  if (action === TRADE_STATUS.PENDING_MEETUP) {
    return isSeller && trade.status === TRADE_STATUS.PENDING_SELLER_CONFIRM
  }

  if (action === TRADE_STATUS.CANCELLED) {
    return ACTIVE_TRADE_STATUSES.includes(trade.status)
  }

  if (action === TRADE_STATUS.COMPLETED) {
    return (isSeller || isBuyer) && trade.status === TRADE_STATUS.PENDING_MEETUP
  }

  if (action === TRADE_STATUS.DISPUTED) {
    return (isSeller || isBuyer) && trade.status === TRADE_STATUS.PENDING_MEETUP
  }

  return false
}

export function canReviewTrade(trade, user) {
  const isSeller = trade?.seller?.id && trade.seller.id === user?.id
  const isBuyer = trade?.buyer?.id && trade.buyer.id === user?.id

  return Boolean(
    (isSeller || isBuyer) &&
    trade?.status === TRADE_STATUS.COMPLETED &&
    !trade?.reviewedByMe
  )
}

export function createTradeReview(tradeId, payload = {}, reviewer) {
  const trades = getStorageArray(TRADES_KEY)
  const trade = trades.find((candidate) => candidate.id === tradeId)

  if (!trade) {
    throw new Error('交易意向不存在')
  }

  assertTradeReviewPermission(trade, reviewer)
  const reviewPayload = normalizeReviewPayload(payload)
  const reviewee = trade.buyer?.id === reviewer?.id ? trade.seller : trade.buyer
  const review = normalizeReview({
    id: createId('review'),
    tradeId: trade.id,
    itemId: trade.itemId,
    itemTitle: trade.itemTitle || '',
    reviewer: normalizeTradeUser(reviewer),
    reviewee: normalizeTradeUser(reviewee),
    rating: reviewPayload.rating,
    content: reviewPayload.content,
    tags: reviewPayload.tags,
    createdAt: Date.now()
  })

  saveReviews([
    review,
    ...getStorageArray(REVIEWS_KEY)
  ])

  pushTradeNotification({
    userId: review.reviewee.id,
    type: 'trade_reviewed',
    title: '收到新的交易评价',
    body: `${review.reviewer.nickname || '对方'}已给「${trade.itemTitle}」留下 ${review.rating} 星评价。`,
    trade
  })

  return review
}

export function resolveLocalTradeDispute(disputeId, payload = {}, actor = {}) {
  const disputes = getStorageArray(DISPUTES_KEY).map(normalizeDisputeCase)
  const disputeCase = disputes.find((candidate) => candidate.id === disputeId)

  if (!disputeCase) {
    throw new Error('争议工单不存在')
  }

  if (disputeCase.status !== DISPUTE_STATUS.OPEN) {
    throw new Error('争议工单已处理')
  }

  const trades = getStorageArray(TRADES_KEY)
  const trade = trades.find((candidate) => candidate.id === disputeCase.tradeId)

  if (!trade || trade.status !== TRADE_STATUS.DISPUTED) {
    throw new Error('当前交易状态不允许处理争议')
  }

  const resolution = normalizeDisputeResolution(payload.resolution)
  const now = Date.now()
  const resolverId = actor.id || payload.actorId || 'support'
  const resolved = normalizeDisputeCase({
    ...disputeCase,
    status: DISPUTE_STATUS.RESOLVED,
    resolution,
    resolutionNote: String(payload.note || payload.resolutionNote || '').trim().slice(0, 500),
    resolverId,
    updatedAt: now,
    resolvedAt: now
  })
  const nextTrade = {
    ...trade,
    status: resolution === DISPUTE_RESOLUTION.COMPLETE_TRADE
      ? TRADE_STATUS.COMPLETED
      : TRADE_STATUS.CANCELLED,
    contactCode: '',
    contactCodeExpiresAt: null,
    timeline: [
      ...(trade.timeline || []),
      createTimelineEvent(
        resolution === DISPUTE_RESOLUTION.COMPLETE_TRADE ? TRADE_STATUS.COMPLETED : TRADE_STATUS.CANCELLED,
        resolverId,
        `客服争议处理：${disputeResolutionText(resolution)}`
      )
    ],
    updatedAt: now
  }

  saveDisputes(disputes.map((candidate) => candidate.id === resolved.id ? resolved : candidate))
  saveTrades(trades.map((candidate) => candidate.id === nextTrade.id ? nextTrade : candidate))

  if (resolution === DISPUTE_RESOLUTION.COMPLETE_TRADE) {
    markItemSold(nextTrade.itemId)
  }

  if (resolution === DISPUTE_RESOLUTION.RELEASE_ITEM) {
    releaseItemReservation(nextTrade.itemId)
  }

  if (resolution === DISPUTE_RESOLUTION.REMOVE_ITEM) {
    removeItemForDispute(nextTrade.itemId)
  }

  notifyTradeParticipants(nextTrade, {
    type: 'trade_dispute_resolved',
    title: '争议已处理',
    body: `「${nextTrade.itemTitle}」争议处理结果：${disputeResolutionText(resolution)}。`
  })

  return resolved
}

export function isGoodsTradeAvailable(item, user = null) {
  if (item?.status !== ITEM_STATUS.ONLINE) {
    return false
  }

  if (user?.id && item.seller?.id === user.id) {
    return false
  }

  return true
}

function assertTradePermission(trade, nextStatus, actor) {
  if (!isTradeActionAllowed(trade, nextStatus, actor)) {
    throw new Error('当前账号不能执行该交易操作')
  }
}

function assertTradeReviewPermission(trade, reviewer) {
  const isSeller = trade?.seller?.id && trade.seller.id === reviewer?.id
  const isBuyer = trade?.buyer?.id && trade.buyer.id === reviewer?.id

  if (!isSeller && !isBuyer) {
    throw new Error('当前账号不能评价该交易')
  }

  if (trade.status !== TRADE_STATUS.COMPLETED) {
    throw new Error('交易完成后才能评价')
  }

  if (hasTradeReview(trade.id, reviewer?.id)) {
    throw new Error('该交易已评价，不能重复评价')
  }
}

function ensureDisputeCaseForTrade(trade, options = {}) {
  const disputes = getStorageArray(DISPUTES_KEY).map(normalizeDisputeCase)
  const existing = disputes.find((disputeCase) =>
    disputeCase.tradeId === trade.id &&
    disputeCase.status === DISPUTE_STATUS.OPEN
  )

  if (existing) {
    return existing
  }

  const now = Date.now()
  const disputeCase = normalizeDisputeCase({
    id: createId('dispute'),
    tradeId: trade.id,
    itemId: trade.itemId,
    itemTitle: trade.itemTitle || '',
    opener: normalizeTradeUser(options.opener || {}),
    source: options.source || 'user',
    reason: options.reason || '',
    description: String(options.description || '').trim().slice(0, 500),
    reportId: options.reportId || '',
    status: DISPUTE_STATUS.OPEN,
    resolution: '',
    resolutionNote: '',
    resolverId: '',
    createdAt: now,
    updatedAt: now,
    resolvedAt: null
  })

  saveDisputes([
    disputeCase,
    ...disputes
  ])

  return disputeCase
}

function findDisputeCaseForTrade(tradeId = '') {
  if (!tradeId) {
    return null
  }

  return getStorageArray(DISPUTES_KEY)
    .map(normalizeDisputeCase)
    .filter((disputeCase) => disputeCase.tradeId === tradeId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
}

function normalizeDisputeCase(disputeCase = {}) {
  return {
    id: disputeCase.id || '',
    tradeId: disputeCase.tradeId || '',
    itemId: disputeCase.itemId || '',
    itemTitle: disputeCase.itemTitle || '',
    opener: normalizeTradeUser(disputeCase.opener || {}),
    source: disputeCase.source || 'user',
    reason: disputeCase.reason || '',
    description: disputeCase.description || '',
    reportId: disputeCase.reportId || '',
    status: disputeCase.status || DISPUTE_STATUS.OPEN,
    resolution: disputeCase.resolution || '',
    resolutionNote: disputeCase.resolutionNote || '',
    resolverId: disputeCase.resolverId || '',
    createdAt: disputeCase.createdAt || Date.now(),
    updatedAt: disputeCase.updatedAt || disputeCase.createdAt || Date.now(),
    resolvedAt: disputeCase.resolvedAt || null
  }
}

function normalizeDisputeResolution(value = '') {
  const resolution = String(value || '').trim()

  if (!Object.values(DISPUTE_RESOLUTION).includes(resolution)) {
    throw new Error('争议处理结果无效')
  }

  return resolution
}

function disputeResolutionText(resolution = '') {
  const map = {
    [DISPUTE_RESOLUTION.RELEASE_ITEM]: '取消交易并释放商品',
    [DISPUTE_RESOLUTION.COMPLETE_TRADE]: '确认交易完成',
    [DISPUTE_RESOLUTION.REMOVE_ITEM]: '取消交易并下架商品'
  }

  return map[resolution] || '已处理'
}

function normalizeReviewPayload(payload = {}) {
  const rating = Number(payload.rating)
  const content = String(payload.content || '').trim()

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('评价星级无效')
  }

  if (content.length > 200) {
    throw new Error('评价内容不能超过 200 个字')
  }

  return {
    rating,
    content,
    tags: normalizeReviewTags(payload.tags)
  }
}

function normalizeReview(review = {}) {
  return {
    id: review.id || '',
    tradeId: review.tradeId || '',
    itemId: review.itemId || '',
    itemTitle: review.itemTitle || '',
    reviewer: normalizeTradeUser(review.reviewer || {}),
    reviewee: normalizeTradeUser(review.reviewee || {}),
    rating: Number(review.rating),
    content: review.content || '',
    tags: normalizeReviewTags(review.tags),
    createdAt: review.createdAt || Date.now()
  }
}

function normalizeReviewTags(tags = []) {
  if (!Array.isArray(tags)) {
    return []
  }

  return tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .slice(0, 5)
}

function hasTradeReview(tradeId = '', reviewerId = '') {
  if (!tradeId || !reviewerId) {
    return false
  }

  return getStorageArray(REVIEWS_KEY).some((review) =>
    review.tradeId === tradeId &&
    review.reviewer?.id === reviewerId
  )
}

function reserveItem(itemId) {
  const items = ensureGoods()

  saveGoods(items.map((item) => item.id === itemId
    ? {
        ...item,
        status: ITEM_STATUS.RESERVED,
        updatedAt: Date.now()
      }
    : item))
}

function markItemSold(itemId) {
  const items = ensureGoods()

  saveGoods(items.map((item) => item.id === itemId
    ? {
        ...item,
        status: ITEM_STATUS.SOLD,
        updatedAt: Date.now()
      }
    : item))
}

function releaseItemReservation(itemId) {
  const items = ensureGoods()
  const hasOtherActiveTrade = getStorageArray(TRADES_KEY)
    .some((trade) => trade.itemId === itemId && ACTIVE_TRADE_STATUSES.includes(trade.status))

  if (hasOtherActiveTrade) {
    return
  }

  saveGoods(items.map((item) => item.id === itemId && item.status === ITEM_STATUS.RESERVED
    ? {
        ...item,
        status: ITEM_STATUS.ONLINE,
        updatedAt: Date.now()
      }
    : item))
}

function removeItemForDispute(itemId) {
  const items = ensureGoods()

  saveGoods(items.map((item) => item.id === itemId
    ? {
        ...item,
        status: ITEM_STATUS.REMOVED,
        reviewStatus: 'dispute_removed',
        updatedAt: Date.now()
      }
    : item))
}

function normalizeSeller(user = {}) {
  return {
    id: user.id || '',
    nickname: user.nickname || '社区用户',
    avatarUrl: user.avatarUrl || '',
    contactCode: user.contactCode || user.contact || ''
  }
}

function normalizeTradeUser(user = {}) {
  return {
    id: user.id || '',
    nickname: user.nickname || '社区用户',
    avatarUrl: user.avatarUrl || ''
  }
}

function createTradeContactCode(trade = {}) {
  const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0')
  const tradePart = String(trade.id || createId('trade')).replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase().padStart(4, '0')

  return `GC-${randomPart}-${tradePart}`
}

function pushTradeStatusNotifications(trade, nextStatus, actor) {
  if (nextStatus === TRADE_STATUS.PENDING_MEETUP) {
    pushTradeNotification({
      userId: trade.buyer?.id,
      type: 'trade_confirmed',
      title: '卖家已确认交易',
      body: `「${trade.itemTitle}」已确认可交易，可在交易页查看一次性联系码。`,
      trade
    })
    return
  }

  if (nextStatus === TRADE_STATUS.COMPLETED) {
    notifyTradeCounterpart(trade, actor, {
      type: 'trade_completed',
      title: '交易已完成',
      body: `「${trade.itemTitle}」已标记完成。`
    })
    return
  }

  if (nextStatus === TRADE_STATUS.CANCELLED) {
    notifyTradeCounterpart(trade, actor, {
      type: 'trade_cancelled',
      title: '交易已取消',
      body: `「${trade.itemTitle}」已取消，商品将按规则恢复在售。`
    })
    return
  }

  if (nextStatus === TRADE_STATUS.DISPUTED) {
    notifyTradeCounterpart(trade, actor, {
      type: 'trade_disputed',
      title: '交易转入争议',
      body: `「${trade.itemTitle}」已转入争议，请等待后续处理。`
    })
  }
}

function notifyTradeCounterpart(trade, actor, notification = {}) {
  const actorId = actor?.id || actor
  const userIds = [trade.buyer, trade.seller]
    .map((user) => user?.id || '')
    .filter(Boolean)
    .filter((userId) => userId !== actorId)

  for (const userId of userIds) {
    pushTradeNotification({
      ...notification,
      userId,
      trade
    })
  }
}

function notifyTradeParticipants(trade, notification = {}) {
  const userIds = [trade.buyer, trade.seller]
    .map((user) => user?.id || '')
    .filter(Boolean)

  for (const userId of new Set(userIds)) {
    pushTradeNotification({
      ...notification,
      userId,
      trade
    })
  }
}

function pushTradeNotification(payload = {}) {
  const userId = String(payload.userId || '').trim()

  if (!userId) {
    return null
  }

  const notification = {
    id: createId('notification'),
    userId,
    type: payload.type || 'trade',
    title: payload.title || '交易提醒',
    body: payload.body || '',
    targetType: 'trade',
    targetId: payload.trade?.id || payload.targetId || '',
    readAt: null,
    createdAt: Date.now()
  }

  saveNotifications([
    notification,
    ...getStorageArray(NOTIFICATIONS_KEY)
  ])

  return notification
}

function assertPublishPayload(payload = {}) {
  if (!String(payload.title || '').trim()) {
    throw new Error('请填写物品名称')
  }

  if (!Number(payload.price) || Number(payload.price) <= 0) {
    throw new Error('请填写有效价格')
  }

  if (!payload.location) {
    throw new Error('请先确认发布位置')
  }

  if (!Number.isFinite(Number(payload.location.latitude)) || !Number.isFinite(Number(payload.location.longitude))) {
    throw new Error('发布位置坐标无效')
  }

  assertPublishLocationQuality(payload.location)

  if (payload.tradeScope?.type === 'community' && !payload.location.communityId) {
    throw new Error('未能确认发布位置所属社区，请重新定位后再发布')
  }

  if (payload.tradeScope?.type === 'street' && !payload.location.streetId) {
    throw new Error('未能确认发布位置所属街道，请重新定位后再发布')
  }

  if (!normalizeImages(payload.images).length) {
    throw new Error('请至少添加 1 张物品照片')
  }
}

function assertPublishLocationQuality(location = {}) {
  const capturedAt = Number(location.capturedAt)

  if (!Number.isFinite(capturedAt)) {
    throw new Error('需要提交实时 GPS 定位时间后才能发布')
  }

  const now = Date.now()

  if (capturedAt > now + 60 * 1000) {
    throw new Error('定位时间异常，请重新定位后再发布')
  }

  if (now - capturedAt > LOCATION_CACHE_TTL_MS) {
    throw new Error('当前位置已过期，请重新定位后再发布')
  }

  const accuracy = Number(location.accuracy)

  if (!Number.isFinite(accuracy)) {
    throw new Error('未获取到定位精度，请使用实时 GPS 定位后再试')
  }

  if (accuracy > MAX_LOCATION_ACCURACY_METERS) {
    throw new Error(`定位精度约 ${Math.round(accuracy)}m，请到开阔位置或开启精准定位后重试`)
  }
}

function assertNoDuplicateActiveItem(sellerId, payload = {}, items = []) {
  const title = normalizeTextKey(payload.title)
  const duplicate = items.find((item) =>
    item.seller?.id === sellerId &&
    normalizeTextKey(item.title) === title &&
    [ITEM_STATUS.PENDING_REVIEW, ITEM_STATUS.ONLINE, ITEM_STATUS.RESERVED].includes(item.status)
  )

  if (duplicate) {
    throw new Error('已存在同名在售或审核中的商品，请勿重复发布')
  }
}

function assertItemStatusTransition(item, nextStatus) {
  if (item.status === nextStatus) {
    return
  }

  if (item.status === ITEM_STATUS.ONLINE && nextStatus === ITEM_STATUS.REMOVED) {
    return
  }

  if (
    item.status === ITEM_STATUS.REMOVED &&
    nextStatus === ITEM_STATUS.ONLINE &&
    !['reported_removed', 'seller_deleted', 'rejected'].includes(item.reviewStatus)
  ) {
    return
  }

  if (item.status === ITEM_STATUS.SOLD && nextStatus === ITEM_STATUS.ONLINE) {
    throw new Error('已售商品不能重新上架')
  }

  if (item.status === ITEM_STATUS.SOLD && nextStatus === ITEM_STATUS.REMOVED) {
    throw new Error('已售商品不能手动下架')
  }

  if (item.status === ITEM_STATUS.RESERVED && nextStatus === ITEM_STATUS.REMOVED) {
    throw new Error('交易中的商品不能手动下架')
  }

  if (item.status === ITEM_STATUS.RESERVED && nextStatus === ITEM_STATUS.ONLINE) {
    throw new Error('交易中的商品不能手动上架')
  }

  if (item.status === ITEM_STATUS.PENDING_REVIEW && nextStatus === ITEM_STATUS.ONLINE) {
    throw new Error('审核中的商品不能手动上架')
  }

  if (item.status === ITEM_STATUS.REMOVED && nextStatus === ITEM_STATUS.ONLINE) {
    throw new Error('违规或注销下架的商品不能重新上架')
  }

  throw new Error('当前物品状态不允许该操作')
}

function buildLocationAudit(eligibility = {}) {
  const profile = eligibility.profile || {}
  const location = profile.location || {}

  return {
    source: profile.source || '',
    capturedAt: location.capturedAt || null,
    accuracy: Number.isFinite(Number(location.accuracy)) ? Number(location.accuracy) : null,
    distanceMeters: Number.isFinite(Number(eligibility.distanceMeters)) ? Number(eligibility.distanceMeters) : null,
    radiusMeters: Number.isFinite(Number(eligibility.radiusMeters)) ? Number(eligibility.radiusMeters) : null,
    scopeType: eligibility.scope?.type || '',
    regionStatus: eligibility.regionCheck?.status || ''
  }
}

function createTimelineEvent(status, actorId, label) {
  return {
    status,
    actorId,
    label,
    at: Date.now()
  }
}

function ensureGoods() {
  const existing = getStorageArray(GOODS_KEY)

  if (existing.length > 0) {
    return existing.map(normalizeItem)
  }

  const seeds = SEED_ITEMS.map(normalizeItem)
  saveGoods(seeds)

  return seeds
}

function normalizeItem(item) {
  return {
    status: ITEM_STATUS.ONLINE,
    reviewStatus: 'seed',
    images: [],
    ...item,
    seller: normalizeSeller(item.seller),
    updatedAt: item.updatedAt || item.createdAt || Date.now()
  }
}

function saveGoods(items) {
  uni.setStorageSync(GOODS_KEY, items)
}

function saveTrades(trades) {
  uni.setStorageSync(TRADES_KEY, trades)
}

function saveNotifications(notifications) {
  uni.setStorageSync(NOTIFICATIONS_KEY, notifications)
}

function saveReviews(reviews) {
  uni.setStorageSync(REVIEWS_KEY, reviews)
}

function saveDisputes(disputes) {
  uni.setStorageSync(DISPUTES_KEY, disputes)
}

function clearExpiredTradeContactCodes(trades = [], now = Date.now()) {
  let changed = false
  const nextTrades = trades.map((trade) => {
    if (!shouldClearExpiredTradeContactCode(trade, now)) {
      return trade
    }

    changed = true
    return {
      ...trade,
      contactCode: '',
      contactCodeExpiresAt: null,
      updatedAt: now
    }
  })

  if (changed) {
    saveTrades(nextTrades)
  }

  return nextTrades
}

function shouldClearExpiredTradeContactCode(trade = {}, now = Date.now()) {
  return trade.status === TRADE_STATUS.PENDING_MEETUP &&
    hasTradeContactMetadata(trade) &&
    !isTradeContactCodeActive(trade, now)
}

function isTradeContactCodeActive(trade = {}, now = Date.now()) {
  const expiresAt = Number(trade.contactCodeExpiresAt)

  return trade.status === TRADE_STATUS.PENDING_MEETUP &&
    Boolean(trade.contactCode) &&
    Number.isFinite(expiresAt) &&
    expiresAt > now
}

function hasTradeContactMetadata(trade = {}) {
  return Boolean(trade.contactCode) ||
    (trade.contactCodeExpiresAt !== null && trade.contactCodeExpiresAt !== undefined)
}

function getStorageArray(key) {
  const value = uni.getStorageSync(key)
  return Array.isArray(value) ? value : []
}

function normalizeKeyword(keyword) {
  return String(keyword || '').trim().toLowerCase()
}

function normalizeTextKey(value = '') {
  return String(value || '').trim().toLowerCase()
}

function normalizePublishIdempotencyPayload(payload = {}) {
  return {
    title: String(payload.title || '').trim(),
    price: Number(payload.price),
    category: payload.category || '',
    condition: payload.condition || '',
    description: String(payload.description || '').trim(),
    images: normalizeImages(payload.images).map((image) => ({
      id: image.id || '',
      url: image.url || '',
      storageKey: image.storageKey || '',
      checksum: image.checksum || '',
      status: image.status || ''
    })),
    tradeScope: payload.tradeScope || {},
    location: normalizeLocationIdempotencyPayload(payload.location)
  }
}

function normalizeLocationIdempotencyPayload(location = {}) {
  return {
    latitude: Number.isFinite(Number(location?.latitude)) ? Number(location.latitude) : null,
    longitude: Number.isFinite(Number(location?.longitude)) ? Number(location.longitude) : null,
    accuracy: Number.isFinite(Number(location?.accuracy)) ? Number(location.accuracy) : null,
    capturedAt: Number.isFinite(Number(location?.capturedAt)) ? Number(location.capturedAt) : null,
    communityId: location?.communityId || '',
    streetId: location?.streetId || '',
    scopeType: location?.scopeType || '',
    radiusMeters: Number.isFinite(Number(location?.radiusMeters)) ? Number(location.radiusMeters) : null
  }
}

function reviewLocalItemContent(payload = {}) {
  const content = `${payload.title || ''} ${payload.description || ''}`.toLowerCase()
  const blocked = BLOCKED_CONTENT_WORDS.filter((word) => content.includes(word))

  if (blocked.length) {
    return {
      approved: false,
      status: 'rejected',
      reasons: blocked.map((word) => `命中违禁词:${word}`)
    }
  }

  return {
    approved: true,
    status: 'approved_auto',
    reasons: []
  }
}

function saveLocalModerationEvent(event) {
  uni.setStorageSync(MODERATION_EVENTS_KEY, [
    event,
    ...getStorageArray(MODERATION_EVENTS_KEY)
  ])
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function sortByDistanceThenCreatedAt(a, b) {
  if (a.distanceMeters === null && b.distanceMeters === null) {
    return b.createdAt - a.createdAt
  }

  if (a.distanceMeters === null) {
    return 1
  }

  if (b.distanceMeters === null) {
    return -1
  }

  return a.distanceMeters - b.distanceMeters
}

function serializeListFilters(filters = {}) {
  return {
    keyword: filters.keyword || '',
    category: filters.category || 'all',
    latitude: filters.currentLocation?.latitude,
    longitude: filters.currentLocation?.longitude,
    accuracy: filters.currentLocation?.accuracy,
    capturedAt: filters.currentLocation?.capturedAt,
    communityId: filters.currentLocation?.communityId,
    streetId: filters.currentLocation?.streetId
  }
}

function normalizeRemoteList(result) {
  if (Array.isArray(result)) {
    return result
  }

  if (Array.isArray(result?.items)) {
    return result.items
  }

  if (Array.isArray(result?.trades)) {
    return result.trades
  }

  return []
}

function normalizeRemoteDistance(item, currentLocation) {
  const serverDistance = Number(item?.distanceMeters)

  if (Number.isFinite(serverDistance)) {
    return serverDistance
  }

  if (currentLocation && hasCoordinateLocation(item?.location)) {
    return distanceInMeters(currentLocation, item.location)
  }

  return null
}

function hasCoordinateLocation(location) {
  if (!location || typeof location !== 'object') {
    return false
  }

  return Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))
}

function hasTrustedListLocation(location) {
  if (!hasCoordinateLocation(location)) {
    return false
  }

  const capturedAt = Number(location.capturedAt)
  const accuracy = Number(location.accuracy)
  const now = Date.now()

  return Number.isFinite(capturedAt) &&
    capturedAt <= now + 60 * 1000 &&
    now - capturedAt <= LOCATION_CACHE_TTL_MS &&
    Number.isFinite(accuracy) &&
    accuracy <= MAX_LOCATION_ACCURACY_METERS
}

function normalizeCurrentRegion(filters = {}, currentLocation = null) {
  if (filters.currentRegion) {
    return filters.currentRegion
  }

  if (currentLocation?.communityId || currentLocation?.streetId) {
    return {
      communityId: currentLocation.communityId || '',
      streetId: currentLocation.streetId || ''
    }
  }

  return currentLocation ? resolveRegionFromSamples(currentLocation) : null
}

function buildLocalListItem(item, currentLocation, currentRegion) {
  if (!currentLocation) {
    return null
  }

  const eligibility = verifyTradeEligibility({
    item,
    userLocation: currentLocation,
    userRegion: currentRegion
  })

  if (!eligibility.eligible) {
    return null
  }

  return {
    ...item,
    distanceMeters: Number.isFinite(Number(eligibility.distanceMeters))
      ? Number(eligibility.distanceMeters)
      : distanceInMeters(currentLocation, item.location)
  }
}
