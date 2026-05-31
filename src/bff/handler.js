import { createHash, createHmac, randomBytes } from 'node:crypto'
import {
  AUTH_SESSION_TTL_MS,
  LOCATION_CACHE_TTL_MS,
  LOCATION_TYPE,
  MAX_LOCATION_ACCURACY_METERS,
  USER_AGREEMENT_LABEL,
  USER_AGREEMENT_VERSION
} from '../config/app.js'
import { SEED_ITEMS } from '../data/seed.js'
import { resolveRegionFromSamples } from '../data/regions.js'
import { verifyTradeEligibility } from '../domain/eligibility.js'
import { normalizeImages } from '../services/media.js'
import { distanceInMeters } from '../utils/geo.js'

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

export const REPORT_STATUS = {
  PENDING_REVIEW: 'pending_review',
  RESOLVED: 'resolved',
  REJECTED: 'rejected'
}

export const REPORT_RESOLUTION = {
  UPHOLD_REPORT: 'uphold_report',
  DISMISS_REPORT: 'dismiss_report'
}

export const USER_STATUS = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
  DELETED: 'deleted'
}

export const LOCATION_RISK_REVIEW_STATUS = {
  NOT_REQUIRED: 'not_required',
  PENDING_REVIEW: 'pending_review',
  CONFIRMED_RISK: 'confirmed_risk',
  FALSE_POSITIVE: 'false_positive',
  ESCALATED: 'escalated'
}

const ACTIVE_TRADE_STATUSES = [
  TRADE_STATUS.PENDING_SELLER_CONFIRM,
  TRADE_STATUS.PENDING_MEETUP
]
const BLOCKING_TRADE_STATUSES = [
  ...ACTIVE_TRADE_STATUSES,
  TRADE_STATUS.DISPUTED
]
const TRADE_CONTACT_CODE_TTL_MS = 48 * 60 * 60 * 1000
const BLOCKED_CONTENT_WORDS = ['违禁', '假货', '诈骗', '管制']
const ALLOWED_REPORT_REASONS = ['prohibited', 'fraud', 'privacy', 'other']
const REPORT_TAKE_DOWN_REASONS = ['prohibited', 'fraud', 'privacy']
const PROTECTED_ENVIRONMENTS = ['pre', 'prod']
const LOCAL_SESSION_SECRET = 'goods-comm-local-session-secret'
const AGREEMENT_ACCEPTED_AT_CLOCK_SKEW_MS = 5 * 60 * 1000
const IDEMPOTENCY_RECORD_TTL_MS = 24 * 60 * 60 * 1000
const IDEMPOTENCY_RECORD_LIMIT = 1000
const LOCATION_RISK_EVENT_LIMIT = 1000
const LOCATION_RISK_LOOKBACK_MS = 30 * 60 * 1000
const LOCATION_RISK_MIN_DISTANCE_METERS = 3000
const LOCATION_RISK_MAX_SPEED_METERS_PER_SECOND = 80
const IDEMPOTENT_PATHS = [
  /^\/items$/,
  /^\/items\/[^/]+\/status$/,
  /^\/trades$/,
  /^\/trades\/[^/]+\/status$/,
  /^\/trades\/[^/]+\/review$/,
  /^\/notifications\/[^/]+\/read$/,
  /^\/reports$/,
  /^\/ops\/reports\/[^/]+\/resolve$/,
  /^\/ops\/users\/[^/]+\/status$/,
  /^\/ops\/location-risk-events\/[^/]+\/review$/,
  /^\/moderation\/items\/[^/]+\/review$/,
  /^\/moderation\/media\/[^/]+\/review$/,
  /^\/moderation\/disputes\/[^/]+\/resolve$/
]

class CommittableBffError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CommittableBffError'
    this.commitStateOnError = true
  }
}

export function createBffState(seedItems = SEED_ITEMS) {
  return {
    users: [],
    sessions: [],
    idempotencyRecords: [],
    items: seedItems.map(normalizeItem),
    trades: [],
    disputeCases: [],
    reviews: [],
    notifications: [],
    notificationDeliveries: [],
    uploads: [],
    reports: [],
    locationRiskEvents: [],
    moderationEvents: [],
    clientEvents: [],
    opsAuditEvents: [],
    accountDeletions: []
  }
}

export async function handleBffRequest(path, options = {}, state = createBffState()) {
  const method = options.method || 'GET'

  return withIdempotency(path, method, options, state, () => routeBffRequest(path, method, options, state))
}

export function resolveAuthenticatedUser(options = {}, state = createBffState()) {
  return requireUser(options, state)
}

export function resolveIdempotencyReplay(path, options = {}, state = createBffState()) {
  const method = options.method || 'GET'
  const idempotencyKey = normalizeIdempotencyKey(resolveIdempotencyKey(options))

  if (!idempotencyKey || !isIdempotentRequest(path, method)) {
    return {
      handled: false
    }
  }

  const now = Date.now()
  const scope = resolveIdempotencyScope(options, state)
  const requestHash = hashRequestForIdempotency(method, path, options.data)
  const records = normalizeIdempotencyRecords(state.idempotencyRecords, now)
  const existing = records.find((record) =>
    record.scope === scope &&
    record.key === idempotencyKey
  )

  state.idempotencyRecords = records

  if (!existing) {
    return {
      handled: false,
      scope,
      key: idempotencyKey,
      requestHash,
      records,
      now
    }
  }

  if (existing.method !== method || existing.path !== path || existing.requestHash !== requestHash) {
    throw new Error('幂等键已被不同请求使用')
  }

  if (existing.status !== 'completed') {
    if (existing.status === 'committed_error') {
      throw new CommittableBffError(existing.response?.message || '请求处理失败')
    }

    throw new Error('幂等请求仍在处理，请稍后重试')
  }

  clearExpiredTradeContactCodes(state, now)
  const response = sanitizeIdempotencyReplayResponse(existing.response, state, now)
  existing.response = cloneJson(response)

  return {
    handled: true,
    response
  }
}

async function routeBffRequest(path, method, options = {}, state = createBffState()) {
  if (path === '/auth/login' && method === 'POST') {
    return login(options.data, state)
  }

  if (path === '/auth/logout' && method === 'POST') {
    return logout(options, state)
  }

  if (path === '/auth/delete-account' && method === 'POST') {
    return deleteAccount(options, state)
  }

  if (path === '/lbs/resolve-region' && method === 'POST') {
    return resolveRegion(options.data)
  }

  if (path === '/uploads/items' && method === 'UPLOAD') {
    return uploadItemImage(options, state)
  }

  if (path === '/items' && method === 'GET') {
    return listItems(options.data, state)
  }

  if (path === '/items' && method === 'POST') {
    return createItem(options, state)
  }

  if (path === '/items/mine' && method === 'GET') {
    return listMyItems(options, state)
  }

  const itemMatch = path.match(/^\/items\/([^/]+)$/)
  if (itemMatch && method === 'GET') {
    return getItem(itemMatch[1], state)
  }

  const itemStatusMatch = path.match(/^\/items\/([^/]+)\/status$/)
  if (itemStatusMatch && method === 'PATCH') {
    return updateItemStatus(itemStatusMatch[1], options, state)
  }

  if (path === '/trades' && method === 'GET') {
    return listTrades(options, state)
  }

  if (path === '/trades' && method === 'POST') {
    return createTrade(options, state)
  }

  const tradeReviewMatch = path.match(/^\/trades\/([^/]+)\/review$/)
  if (tradeReviewMatch && method === 'POST') {
    return createTradeReview(tradeReviewMatch[1], options, state)
  }

  if (path === '/reviews' && method === 'GET') {
    return listReviews(options.data, state)
  }

  if (path === '/disputes' && method === 'GET') {
    return listDisputeCases(options, state)
  }

  if (path === '/notifications' && method === 'GET') {
    return listNotifications(options, state)
  }

  const notificationReadMatch = path.match(/^\/notifications\/([^/]+)\/read$/)
  if (notificationReadMatch && method === 'PATCH') {
    return markNotificationRead(notificationReadMatch[1], options, state)
  }

  if (path === '/reports' && method === 'POST') {
    return createReport(options, state)
  }

  if (path === '/telemetry/client-events' && method === 'POST') {
    return createClientEvents(options, state)
  }

  if (path === '/ops/moderation-queue' && method === 'GET') {
    return listOpsModerationQueue(options, state)
  }

  if (path === '/ops/client-events' && method === 'GET') {
    return listOpsClientEvents(options, state)
  }

  if (path === '/ops/location-risk-events' && method === 'GET') {
    return listOpsLocationRiskEvents(options, state)
  }

  const opsLocationRiskReviewMatch = path.match(/^\/ops\/location-risk-events\/([^/]+)\/review$/)
  if (opsLocationRiskReviewMatch && ['POST', 'PATCH'].includes(method)) {
    return reviewOpsLocationRiskEvent(opsLocationRiskReviewMatch[1], options, state)
  }

  if (path === '/ops/audit-events' && method === 'GET') {
    return listOpsAuditEvents(options, state)
  }

  if (path === '/ops/reports' && method === 'GET') {
    return listOpsReports(options, state)
  }

  if (path === '/ops/users' && method === 'GET') {
    return listOpsUsers(options, state)
  }

  const opsReportResolveMatch = path.match(/^\/ops\/reports\/([^/]+)\/resolve$/)
  if (opsReportResolveMatch && ['POST', 'PATCH'].includes(method)) {
    return resolveReportModeration(opsReportResolveMatch[1], options, state)
  }

  const opsUserStatusMatch = path.match(/^\/ops\/users\/([^/]+)\/status$/)
  if (opsUserStatusMatch && ['POST', 'PATCH'].includes(method)) {
    return updateOpsUserStatus(opsUserStatusMatch[1], options, state)
  }

  const moderationItemMatch = path.match(/^\/moderation\/items\/([^/]+)\/review$/)
  if (moderationItemMatch && ['POST', 'PATCH'].includes(method)) {
    return reviewItemModeration(moderationItemMatch[1], options, state)
  }

  const moderationMediaMatch = path.match(/^\/moderation\/media\/([^/]+)\/review$/)
  if (moderationMediaMatch && ['POST', 'PATCH'].includes(method)) {
    return reviewMediaModeration(moderationMediaMatch[1], options, state)
  }

  const disputeResolveMatch = path.match(/^\/moderation\/disputes\/([^/]+)\/resolve$/)
  if (disputeResolveMatch && ['POST', 'PATCH'].includes(method)) {
    return resolveTradeDispute(disputeResolveMatch[1], options, state)
  }

  const tradeStatusMatch = path.match(/^\/trades\/([^/]+)\/status$/)
  if (tradeStatusMatch && method === 'PATCH') {
    return updateTradeStatus(tradeStatusMatch[1], options, state)
  }

  throw new Error(`接口不存在: ${method} ${path}`)
}

async function withIdempotency(path, method, options = {}, state, execute) {
  const replay = resolveIdempotencyReplay(path, {
    ...options,
    method
  }, state)

  if (replay.handled) {
    return replay.response
  }

  if (!replay.key) {
    return execute()
  }

  let result
  let committedError

  try {
    result = await execute()
  } catch (error) {
    if (!error?.commitStateOnError) {
      throw error
    }

    committedError = error
  }

  const completedAt = Date.now()
  const record = buildIdempotencyRecord({
    scope: replay.scope,
    key: replay.key,
    method,
    path,
    requestHash: replay.requestHash,
    status: committedError ? 'committed_error' : 'completed',
    response: committedError
      ? {
          message: committedError.message || '请求处理失败'
        }
      : cloneJson(result),
    createdAt: replay.now,
    updatedAt: completedAt,
    expiresAt: completedAt + IDEMPOTENCY_RECORD_TTL_MS
  })

  state.idempotencyRecords = [
    record,
    ...replay.records
  ].slice(0, IDEMPOTENCY_RECORD_LIMIT)

  if (committedError) {
    throw committedError
  }

  return result
}

function buildIdempotencyRecord(record = {}) {
  return {
    id: createId('idempotency'),
    scope: record.scope,
    key: record.key,
    method: record.method,
    path: record.path,
    requestHash: record.requestHash,
    status: record.status || 'completed',
    response: record.response || {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt
  }
}

function sanitizeIdempotencyReplayResponse(response = {}, state = {}, now = Date.now()) {
  const replay = cloneJson(response)
  const canonicalTrade = Array.isArray(state.trades)
    ? state.trades.find((trade) => trade.id === replay.id)
    : null

  if (
    shouldClearExpiredTradeContactCode(replay, now) ||
    canonicalTrade && hasTradeContactMetadata(replay) && !isTradeContactCodeActive(canonicalTrade, now)
  ) {
    replay.contactCode = ''
    replay.contactCodeExpiresAt = null
  }

  return replay
}

export function isIdempotentRequest(path, method) {
  if (!['POST', 'PATCH'].includes(method)) {
    return false
  }

  return IDEMPOTENT_PATHS.some((pattern) => pattern.test(path))
}

function resolveIdempotencyKey(options = {}) {
  return options.idempotencyKey ||
    getHeaderValue(options.header, ['Idempotency-Key', 'idempotency-key', 'X-Idempotency-Key', 'x-idempotency-key']) ||
    options.data?.idempotencyKey ||
    options.data?.clientRequestId ||
    ''
}

function normalizeIdempotencyKey(value = '') {
  const key = String(value || '').trim()

  if (!key) {
    return ''
  }

  if (key.length < 8 || key.length > 128 || !/^[a-zA-Z0-9_.:-]+$/.test(key)) {
    throw new Error('幂等键无效')
  }

  return key
}

function getHeaderValue(headers = {}, names = []) {
  for (const name of names) {
    const value = headers?.[name]

    if (Array.isArray(value)) {
      return value[0] || ''
    }

    if (value) {
      return value
    }
  }

  return ''
}

function resolveIdempotencyScope(options = {}, state = {}) {
  const token = options.token || parseBearer(options.header?.Authorization || options.header?.authorization || '')

  if (!token) {
    return 'system'
  }

  const { user } = requireSession(options, state)
  return `user:${user.id}`
}

function hashRequestForIdempotency(method, path, data) {
  return createHash('sha256')
    .update(stableStringify({
      method,
      path,
      data: stripIdempotencyFields(data)
    }))
    .digest('hex')
}

function stripIdempotencyFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripIdempotencyFields)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => ![
      'idempotencyKey',
      'clientRequestId',
      'moderation',
      'serverRegion'
    ].includes(key))
    .map(([key, entry]) => [key, stripIdempotencyFields(entry)]))
}

function stripServerOnlyItemFields(payload = {}) {
  const {
    moderation: _moderation,
    sellerOpenid: _sellerOpenid,
    contentSafetyOpenid: _contentSafetyOpenid,
    contentSafetyProvider: _contentSafetyProvider,
    contentSafetyUserId: _contentSafetyUserId,
    contentSafetyReviewer: _contentSafetyReviewer,
    platformId: _platformId,
    ...itemPayload
  } = payload || {}

  return itemPayload
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (!value || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function normalizeIdempotencyRecords(records = [], now = Date.now()) {
  return Array.isArray(records)
    ? records.filter((record) => !record.expiresAt || Number(record.expiresAt) > now)
    : []
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function login(payload = {}, state) {
  const platformIdentity = payload.platformIdentity || {}
  const provider = platformIdentity.provider || payload.provider || 'unknown'
  const platformId = platformIdentity.platformId || payload.code || `${provider}_${Date.now()}`
  const unionId = platformIdentity.unionId || ''
  const existing = state.users.find((user) => user.provider === provider && user.platformId === platformId)
  const now = Date.now()
  const agreement = normalizeUserAgreement(payload.agreement, now)

  if (existing?.status && existing.status !== 'active') {
    throw new Error('账号状态不可用，请联系客服处理')
  }

  if (isProtectedRuntime() && !agreement && !hasCurrentUserAgreement(existing)) {
    throw new Error(`登录前请先阅读并同意${USER_AGREEMENT_LABEL}`)
  }

  const user = existing || {
    id: `user_${hashText(`${provider}_${platformId}`)}`,
    provider,
    platformId,
    unionId,
    nickname: payload.userInfo?.nickname || '社区用户',
    avatarUrl: payload.userInfo?.avatarUrl || '',
    contactCode: `${provider}-${hashText(platformId).slice(0, 8)}`,
    status: 'active',
    createdAt: now
  }

  if (existing) {
    existing.unionId = existing.unionId || unionId
    existing.nickname = payload.userInfo?.nickname || existing.nickname
    existing.avatarUrl = payload.userInfo?.avatarUrl || existing.avatarUrl
  }

  if (agreement) {
    user.agreementVersion = agreement.version
    user.agreementAcceptedAt = agreement.acceptedAt
    user.agreementSource = agreement.source
  }

  if (!existing) {
    state.users.push(user)
  }

  const session = createSession(user, state, now)

  return {
    provider,
    token: session.token,
    sessionExpiresAt: session.expiresAt,
    user
  }
}

function normalizeUserAgreement(agreement = {}, now = Date.now()) {
  if (!agreement || typeof agreement !== 'object') {
    return null
  }

  const version = String(agreement.version || '').trim()
  const acceptedAt = Number(agreement.acceptedAt || 0)

  if (version !== USER_AGREEMENT_VERSION || !Number.isFinite(acceptedAt) || acceptedAt <= 0) {
    return null
  }

  if (acceptedAt > now + AGREEMENT_ACCEPTED_AT_CLOCK_SKEW_MS) {
    return null
  }

  return {
    version,
    acceptedAt: Math.trunc(acceptedAt),
    source: String(agreement.source || 'client').slice(0, 40)
  }
}

function hasCurrentUserAgreement(user = {}) {
  return Boolean(
    user?.agreementVersion === USER_AGREEMENT_VERSION &&
    Number(user.agreementAcceptedAt || 0) > 0
  )
}

function isProtectedRuntime() {
  return PROTECTED_ENVIRONMENTS.includes(String(process.env.GOODS_COMM_ENV || '').trim().toLowerCase())
}

function deleteAccount(options = {}, state) {
  const user = requireUser(options, state)
  const now = Date.now()

  user.status = 'deleted'
  user.nickname = '已注销用户'
  user.avatarUrl = ''
  user.contactCode = ''
  user.deletedAt = now

  for (const item of state.items) {
    if (item.seller?.id === user.id && [
      ITEM_STATUS.PENDING_REVIEW,
      ITEM_STATUS.ONLINE,
      ITEM_STATUS.RESERVED
    ].includes(item.status)) {
      item.status = ITEM_STATUS.REMOVED
      item.reviewStatus = 'seller_deleted'
      item.updatedAt = now
    }
  }

  for (const trade of state.trades) {
    const belongsToUser = trade.buyer?.id === user.id || trade.seller?.id === user.id

    if (belongsToUser && ACTIVE_TRADE_STATUSES.includes(trade.status)) {
      trade.status = TRADE_STATUS.CANCELLED
      trade.contactCode = ''
      trade.contactCodeExpiresAt = null
      trade.updatedAt = now
      trade.timeline = [
        ...(trade.timeline || []),
        createTimelineEvent(TRADE_STATUS.CANCELLED, user.id, '账号注销，交易自动取消')
      ]
      notifyTradeCounterpart(state, trade, user, {
        type: 'trade_cancelled',
        title: '交易已取消',
        body: `「${trade.itemTitle}」因对方账号注销已自动取消。`
      })

      const item = state.items.find((candidate) => candidate.id === trade.itemId)

      if (item?.status === ITEM_STATUS.RESERVED && !hasActiveTradeForItem(item.id, state)) {
        item.status = ITEM_STATUS.ONLINE
        item.updatedAt = now
      }
    }
  }

  state.reviews = normalizeReviews(state.reviews).map((review) => ({
    ...review,
    reviewer: review.reviewer?.id === user.id
      ? normalizeUserForTrade(user)
      : review.reviewer,
    reviewee: review.reviewee?.id === user.id
      ? normalizeUserForTrade(user)
      : review.reviewee
  }))

  state.accountDeletions.push({
    userId: user.id,
    reason: options.data?.reason || '',
    createdAt: now
  })
  revokeUserSessions(user.id, state, now)

  return {
    ok: true,
    deletedAt: now
  }
}

function logout(options = {}, state) {
  const { session } = requireSession(options, state)
  const now = Date.now()

  session.revokedAt = now

  return {
    ok: true,
    revokedAt: now
  }
}

function resolveRegion(payload = {}) {
  if (payload.serverRegion) {
    return normalizeResolvedRegion(payload.serverRegion)
  }

  const location = {
    latitude: Number(payload.latitude),
    longitude: Number(payload.longitude),
    coordType: payload.coordType || LOCATION_TYPE
  }
  const region = resolveRegionFromSamples(location)

  if (!region) {
    throw new Error('未能解析当前位置所属社区或街道')
  }

  return region
}

function uploadItemImage(options = {}, state) {
  const user = requireUser(options, state)
  const file = options.data?.file || {}
  const upload = {
    id: createId('upload'),
    ownerId: user.id,
    url: file.url || `https://cdn.local.goods-comm.test/items/${createId('image')}.jpg`,
    storageKey: file.storageKey || '',
    size: Number.isFinite(Number(file.size)) ? Number(file.size) : null,
    mimeType: file.mimeType || file.type || '',
    originalName: file.originalName || file.filename || file.name || '',
    checksum: file.checksum || '',
    status: file.status || 'uploaded',
    traceId: file.traceId || file.moderationTraceId || '',
    moderationStatus: file.moderationStatus || '',
    moderationReasons: normalizeReviewReasons(file.moderationReasons),
    createdAt: Date.now()
  }

  state.uploads.push(upload)

  return upload
}

function listItems(filters = {}, state) {
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  const category = filters.category || 'all'
  const currentLocation = normalizeFilterLocation(filters)
  const currentRegion = normalizeFilterRegion(filters, currentLocation)
  const items = state.items
    .filter((item) => item.status === ITEM_STATUS.ONLINE)
    .filter((item) => category === 'all' || item.category === category)
    .filter((item) => !keyword || `${item.title} ${item.description}`.toLowerCase().includes(keyword))
    .map((item) => buildVisibleListItem(item, currentLocation, currentRegion))
    .filter(Boolean)
    .sort((a, b) => sortByDistanceThenCreatedAt(a, b, Boolean(currentLocation)))

  return {
    items: items.map(sanitizeItemForResponse)
  }
}

function createItem(options = {}, state) {
  const user = requireUser(options, state)
  const payload = options.data || {}
  const now = Date.now()

  assertItemPayload(payload)
  const { serverRegion: _serverRegion, ...location } = payload.location || {}
  const serverRegion = payload.location?.serverRegion
    ? normalizeResolvedRegion(payload.location.serverRegion)
    : resolveRegionFromSamples(location)

  if (!serverRegion) {
    throw new Error('未能解析发布位置所属社区或街道')
  }

  assertNoDuplicateActiveItem(user.id, payload, state)

  const rawImages = normalizeImages(payload.images)
  assertUploadedImagesTrusted(rawImages, user, state)

  const review = reviewItemContent({
    ...payload,
    images: rawImages
  })
  const images = rawImages.map((image) => ({
    ...image,
    status: image.status === 'uploaded' ? 'uploaded' : 'pending_review'
  }))

  if (!review.approved) {
    state.moderationEvents.unshift({
      id: createId('moderation'),
      actorId: user.id,
      targetType: 'item_submission',
      title: String(payload.title || '').trim(),
      status: review.status,
      reasons: review.reasons,
      createdAt: now
    })

    throw new CommittableBffError(`商品未通过审核：${review.reasons.join('、')}`)
  }

  const item = normalizeItem({
    ...stripServerOnlyItemFields(payload),
    id: createId('item'),
    seller: normalizeUserForItem(user),
    images,
    location: {
      ...location,
      communityId: serverRegion.communityId || '',
      communityName: serverRegion.communityName || '',
      streetId: serverRegion.streetId || '',
      streetName: serverRegion.streetName || '',
      regionPrecision: serverRegion.precision || ''
    },
    status: review.status === 'pending_media_review' ? ITEM_STATUS.PENDING_REVIEW : ITEM_STATUS.ONLINE,
    reviewStatus: review.status,
    reviewReasons: review.reasons,
    createdAt: now,
    updatedAt: now
  })

  state.items.unshift(item)
  recordTrustedLocationUse(state, {
    user,
    action: 'item_publish',
    targetType: 'item',
    targetId: item.id,
    location: item.location,
    region: serverRegion,
    now
  })

  return sanitizeItemForResponse(item)
}

function listMyItems(options = {}, state) {
  const user = requireUser(options, state)

  return {
    items: state.items
      .filter((item) => item.seller?.id === user.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(sanitizeItemForResponse)
  }
}

function getItem(itemId, state) {
  return sanitizeItemForResponse(findVisibleItem(itemId, state))
}

function findVisibleItem(itemId, state) {
  const item = state.items.find((candidate) =>
    candidate.id === itemId &&
    ![ITEM_STATUS.PENDING_REVIEW, ITEM_STATUS.REMOVED].includes(candidate.status)
  )

  if (!item) {
    throw new Error('物品不存在或已下架')
  }

  return item
}

function updateItemStatus(itemId, options = {}, state) {
  const user = requireUser(options, state)
  const item = state.items.find((candidate) => candidate.id === itemId)
  const nextStatus = options.data?.status

  if (!item) {
    throw new Error('物品不存在或已下架')
  }

  if (item.seller?.id !== user.id) {
    throw new Error('只能管理自己发布的物品')
  }

  if (![ITEM_STATUS.ONLINE, ITEM_STATUS.REMOVED].includes(nextStatus)) {
    throw new Error('暂不支持该物品状态操作')
  }

  assertItemStatusTransition(item, nextStatus)

  item.status = nextStatus
  item.updatedAt = Date.now()

  return sanitizeItemForResponse(item)
}

function listTrades(options = {}, state) {
  const user = requireUser(options, state)
  clearExpiredTradeContactCodes(state)

  return {
    trades: state.trades
      .filter((trade) => trade.buyer?.id === user.id || trade.seller?.id === user.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((trade) => sanitizeTradeForResponse(trade, user, state))
  }
}

function listReviews(filters = {}, state) {
  const itemId = String(filters.itemId || '').trim()

  if (!itemId) {
    throw new Error('评价查询参数无效')
  }

  findVisibleItem(itemId, state)

  return {
    reviews: normalizeReviews(state.reviews)
      .filter((review) => review.itemId === itemId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(sanitizeReviewForResponse)
  }
}

function listDisputeCases(options = {}, state) {
  const user = requireUser(options, state)
  const visibleTradeIds = new Set(state.trades
    .filter((trade) => trade.buyer?.id === user.id || trade.seller?.id === user.id)
    .map((trade) => trade.id))

  return {
    disputes: normalizeDisputeCases(state.disputeCases)
      .filter((disputeCase) => visibleTradeIds.has(disputeCase.tradeId))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((disputeCase) => sanitizeDisputeCaseForResponse(disputeCase))
  }
}

function listNotifications(options = {}, state) {
  const user = requireUser(options, state)

  return {
    notifications: normalizeNotifications(state.notifications)
      .filter((notification) => notification.userId === user.id)
      .sort((a, b) => b.createdAt - a.createdAt)
  }
}

function markNotificationRead(notificationId, options = {}, state) {
  const user = requireUser(options, state)
  const notification = normalizeNotifications(state.notifications)
    .find((candidate) => candidate.id === notificationId && candidate.userId === user.id)

  if (!notification) {
    throw new Error('通知不存在')
  }

  notification.readAt = notification.readAt || Date.now()
  state.notifications = normalizeNotifications(state.notifications).map((candidate) =>
    candidate.id === notification.id ? notification : candidate
  )

  return notification
}

function createTrade(options = {}, state) {
  const buyer = requireUser(options, state)
  const payload = options.data || {}
  const item = findVisibleItem(payload.itemId, state)
  const now = Date.now()

  if (item.status === ITEM_STATUS.SOLD) {
    throw new Error('物品已完成交易')
  }

  if (item.seller?.id === buyer.id) {
    throw new Error('不能购买自己发布的物品')
  }

  assertBuyerLocationQuality(payload.buyerLocation)

  const buyerRegion = payload.buyerLocation?.serverRegion
    ? normalizeResolvedRegion(payload.buyerLocation.serverRegion)
    : resolveRegionFromSamples(payload.buyerLocation)
  const eligibility = verifyTradeEligibility({
    item,
    userLocation: payload.buyerLocation,
    userRegion: buyerRegion
  })

  if (!eligibility.eligible) {
    throw new Error(eligibility.message)
  }

  clearExpiredTradeContactCodes(state)

  const duplicate = state.trades.find((trade) =>
    trade.itemId === item.id &&
    trade.buyer?.id === buyer.id &&
    ACTIVE_TRADE_STATUSES.includes(trade.status)
  )

  if (duplicate) {
    return sanitizeTradeForResponse(duplicate, buyer, state)
  }

  if (item.status === ITEM_STATUS.RESERVED) {
    throw new Error('物品已有交易处理中')
  }

  const trade = {
    id: createId('trade'),
    itemId: item.id,
    itemTitle: item.title,
    price: item.price,
    seller: normalizeUserForTrade(item.seller),
    buyer: normalizeUserForTrade(buyer),
    contactCode: '',
    status: TRADE_STATUS.PENDING_SELLER_CONFIRM,
    eligibilityCode: eligibility.code,
    eligibilityMessage: eligibility.message,
    locationAudit: {
      source: 'server',
      capturedAt: payload.buyerLocation?.capturedAt || now,
      accuracy: Number.isFinite(Number(payload.buyerLocation?.accuracy)) ? Number(payload.buyerLocation.accuracy) : null,
      distanceMeters: eligibility.distanceMeters,
      radiusMeters: eligibility.radiusMeters,
      scopeType: eligibility.scope?.type || '',
      regionStatus: eligibility.regionCheck?.status || ''
    },
    timeline: [
      createTimelineEvent(TRADE_STATUS.PENDING_SELLER_CONFIRM, buyer.id, '买家已发起交易意向')
    ],
    createdAt: now,
    updatedAt: now
  }

  state.trades.unshift(trade)
  recordTrustedLocationUse(state, {
    user: buyer,
    action: 'trade_create',
    targetType: 'trade',
    targetId: trade.id,
    location: payload.buyerLocation,
    region: buyerRegion,
    now
  })
  item.status = ITEM_STATUS.RESERVED
  item.updatedAt = now
  pushTradeNotification(state, {
    userId: trade.seller.id,
    type: 'trade_created',
    title: '有新的交易意向',
    body: `${trade.buyer.nickname || '买家'}想购买「${trade.itemTitle}」，请在交易页确认是否可交易。`,
    trade
  })

  return sanitizeTradeForResponse(trade, buyer, state)
}

function updateTradeStatus(tradeId, options = {}, state) {
  const actor = requireUser(options, state)
  const trade = state.trades.find((candidate) => candidate.id === tradeId)
  const nextStatus = options.data?.status

  if (!trade) {
    throw new Error('交易意向不存在')
  }

  assertTradeTransition(trade, nextStatus, actor)

  const item = state.items.find((candidate) => candidate.id === trade.itemId)

  trade.status = nextStatus
  trade.updatedAt = Date.now()

  if (nextStatus === TRADE_STATUS.PENDING_MEETUP) {
    trade.contactCode = trade.contactCode || createTradeContactCode(trade)
    trade.contactCodeExpiresAt = trade.contactCodeExpiresAt || Date.now() + TRADE_CONTACT_CODE_TTL_MS
  }

  if (nextStatus !== TRADE_STATUS.PENDING_MEETUP) {
    trade.contactCode = ''
    trade.contactCodeExpiresAt = null
  }

  trade.timeline = [
    ...(trade.timeline || []),
    createTimelineEvent(nextStatus, actor.id, statusText(nextStatus))
  ]

  if (item && nextStatus === TRADE_STATUS.COMPLETED) {
    item.status = ITEM_STATUS.SOLD
    item.updatedAt = Date.now()
  }

  if (item && nextStatus === TRADE_STATUS.CANCELLED && !hasActiveTradeForItem(item.id, state)) {
    item.status = ITEM_STATUS.ONLINE
    item.updatedAt = Date.now()
  }

  if (nextStatus === TRADE_STATUS.DISPUTED) {
    ensureDisputeCaseForTrade(state, trade, {
      source: 'user',
      opener: actor,
      reason: options.data?.reason || 'user_dispute',
      description: options.data?.description || ''
    })
  }
  pushTradeStatusNotifications(state, trade, nextStatus, actor)

  return sanitizeTradeForResponse(trade, actor, state)
}

function resolveTradeDispute(disputeId, options = {}, state) {
  const payload = options.data || {}
  const disputeCase = normalizeDisputeCases(state.disputeCases)
    .find((candidate) => candidate.id === disputeId)

  if (!disputeCase) {
    throw new Error('争议工单不存在')
  }

  if (disputeCase.status !== DISPUTE_STATUS.OPEN) {
    throw new Error('争议工单已处理')
  }

  const trade = state.trades.find((candidate) => candidate.id === disputeCase.tradeId)

  if (!trade || trade.status !== TRADE_STATUS.DISPUTED) {
    throw new Error('当前交易状态不允许处理争议')
  }

  const resolution = normalizeDisputeResolution(payload.resolution)
  const item = state.items.find((candidate) => candidate.id === trade.itemId)
  const now = Date.now()
  const resolverId = payload.actorId || payload.resolverId || 'support'

  disputeCase.status = DISPUTE_STATUS.RESOLVED
  disputeCase.resolution = resolution
  disputeCase.resolutionNote = String(payload.note || payload.resolutionNote || '').trim().slice(0, 500)
  disputeCase.resolverId = resolverId
  disputeCase.resolvedAt = now
  disputeCase.updatedAt = now

  trade.contactCode = ''
  trade.contactCodeExpiresAt = null
  trade.status = resolution === DISPUTE_RESOLUTION.COMPLETE_TRADE
    ? TRADE_STATUS.COMPLETED
    : TRADE_STATUS.CANCELLED
  trade.updatedAt = now
  trade.timeline = [
    ...(trade.timeline || []),
    createTimelineEvent(trade.status, resolverId, `客服争议处理：${disputeResolutionText(resolution)}`)
  ]

  if (item && resolution === DISPUTE_RESOLUTION.COMPLETE_TRADE) {
    item.status = ITEM_STATUS.SOLD
    item.updatedAt = now
  }

  if (item && resolution === DISPUTE_RESOLUTION.RELEASE_ITEM && item.status === ITEM_STATUS.RESERVED && !hasActiveTradeForItem(item.id, state)) {
    item.status = ITEM_STATUS.ONLINE
    item.updatedAt = now
  }

  if (item && resolution === DISPUTE_RESOLUTION.REMOVE_ITEM) {
    item.status = ITEM_STATUS.REMOVED
    item.reviewStatus = 'dispute_removed'
    item.updatedAt = now
  }

  notifyTradeParticipants(state, trade, {
    type: 'trade_dispute_resolved',
    title: '争议已处理',
    body: `「${trade.itemTitle}」争议处理结果：${disputeResolutionText(resolution)}。`
  })

  state.disputeCases = normalizeDisputeCases(state.disputeCases).map((candidate) =>
    candidate.id === disputeCase.id ? disputeCase : candidate
  )

  return sanitizeDisputeCaseForResponse(disputeCase)
}

function createTradeReview(tradeId, options = {}, state) {
  const reviewer = requireUser(options, state)
  const trade = state.trades.find((candidate) => candidate.id === tradeId)
  const payload = options.data || {}

  if (!trade) {
    throw new Error('交易意向不存在')
  }

  assertTradeCanBeReviewed(trade, reviewer, state)
  const reviewee = trade.buyer?.id === reviewer.id ? trade.seller : trade.buyer
  const reviewPayload = normalizeReviewPayload(payload)
  const now = Date.now()
  const review = {
    id: createId('review'),
    tradeId: trade.id,
    itemId: trade.itemId,
    itemTitle: trade.itemTitle || '',
    reviewer: normalizeUserForTrade(reviewer),
    reviewee: normalizeUserForTrade(reviewee),
    rating: reviewPayload.rating,
    content: reviewPayload.content,
    tags: reviewPayload.tags,
    createdAt: now
  }

  state.reviews = [
    review,
    ...normalizeReviews(state.reviews)
  ]

  pushTradeNotification(state, {
    userId: review.reviewee.id,
    type: 'trade_reviewed',
    title: '收到新的交易评价',
    body: `${review.reviewer.nickname || '对方'}已给「${trade.itemTitle}」留下 ${review.rating} 星评价。`,
    trade
  })

  return sanitizeReviewForResponse(review)
}

function createReport(options = {}, state) {
  const reporter = requireUser(options, state)
  const payload = options.data || {}

  assertReportPayload(payload)
  const duplicate = findDuplicateReport(reporter.id, payload, state)

  if (duplicate) {
    return duplicate
  }

  const target = findReportTarget(payload, state)

  if (target?.seller?.id === reporter.id) {
    throw new Error('不能举报自己发布的物品')
  }

  const report = {
    id: createId('report'),
    reporter: normalizeUserForTrade(reporter),
    targetType: payload.targetType,
    targetId: payload.targetId,
    reason: payload.reason,
    description: payload.description || '',
    status: REPORT_STATUS.PENDING_REVIEW,
    resolution: '',
    resolutionNote: '',
    resolverId: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resolvedAt: null
  }

  state.reports.unshift(report)

  if (payload.targetType === 'item' && REPORT_TAKE_DOWN_REASONS.includes(payload.reason)) {
    applyHighRiskReportToItem(target, report, reporter, state)
  }

  return report
}

function listOpsModerationQueue(options = {}, state) {
  const filters = options.data || {}
  const limit = normalizeLimit(filters.limit, 50)
  const pendingItems = state.items
    .filter((item) =>
      item.status === ITEM_STATUS.PENDING_REVIEW ||
      item.reviewStatus === 'pending_media_review'
    )
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .slice(0, limit)
    .map(sanitizeItemForResponse)
  const pendingReports = listOpsReports({
    data: {
      status: REPORT_STATUS.PENDING_REVIEW,
      limit
    }
  }, state).reports
  const openDisputes = normalizeDisputeCases(state.disputeCases)
    .filter((disputeCase) => disputeCase.status === DISPUTE_STATUS.OPEN)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, limit)
    .map(sanitizeDisputeCaseForResponse)
  const failedDeliveries = normalizeNotificationDeliveries(state.notificationDeliveries)
    .filter((delivery) => ['failed', 'pending'].includes(delivery.status))
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .slice(0, limit)

  return {
    counts: {
      pendingItems: pendingItems.length,
      pendingReports: pendingReports.length,
      openDisputes: openDisputes.length,
      failedDeliveries: failedDeliveries.length
    },
    pendingItems,
    reports: pendingReports,
    disputes: openDisputes,
    notificationDeliveries: failedDeliveries
  }
}

function listOpsReports(options = {}, state) {
  const filters = options.data || {}
  const status = String(filters.status || '').trim()
  const targetId = String(filters.targetId || '').trim()
  const reporterId = String(filters.reporterId || '').trim()
  const limit = normalizeLimit(filters.limit, 50)

  return {
    reports: normalizeReports(state.reports)
      .filter((report) => !status || report.status === status)
      .filter((report) => !targetId || report.targetId === targetId)
      .filter((report) => !reporterId || report.reporter?.id === reporterId)
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
      .slice(0, limit)
      .map((report) => sanitizeReportForOps(report, state))
  }
}

function listOpsUsers(options = {}, state) {
  const filters = options.data || {}
  const status = String(filters.status || '').trim()
  const query = String(filters.query || filters.keyword || '').trim().toLowerCase()
  const limit = normalizeLimit(filters.limit, 50)
  const users = Array.isArray(state.users) ? state.users : []

  return {
    counts: {
      active: users.filter((user) => user.status === USER_STATUS.ACTIVE).length,
      blocked: users.filter((user) => user.status === USER_STATUS.BLOCKED).length,
      deleted: users.filter((user) => user.status === USER_STATUS.DELETED).length
    },
    users: users
      .filter((user) => !status || user.status === status)
      .filter((user) => !query || [
        user.id,
        user.nickname,
        user.provider,
        user.platformId,
        user.blockReason
      ].some((value) => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => Number(b.blockedAt || b.createdAt || 0) - Number(a.blockedAt || a.createdAt || 0))
      .slice(0, limit)
      .map(sanitizeUserForOps)
  }
}

function updateOpsUserStatus(userId, options = {}, state) {
  const payload = options.data || {}
  const user = state.users.find((candidate) => candidate.id === userId)

  if (!user) {
    throw new Error('用户不存在')
  }

  if (user.status === USER_STATUS.DELETED) {
    throw new Error('注销账号不能变更状态')
  }

  const status = normalizeOpsUserStatus(payload.status)
  const actorId = String(payload.actorId || payload.operatorId || 'risk').trim().slice(0, 80)
  const reason = String(payload.reason || payload.note || payload.blockReason || '').trim().slice(0, 500)

  if (status === USER_STATUS.BLOCKED && !reason) {
    throw new Error('请填写封禁原因')
  }

  const now = Date.now()
  const affected = status === USER_STATUS.BLOCKED
    ? blockUserForRisk(user, {
      actorId,
      reason,
      now
    }, state)
    : unblockUserForRisk(user, {
      actorId,
      reason,
      now
    })

  state.moderationEvents.unshift({
    id: createId('moderation'),
    actorId,
    targetType: 'user',
    targetId: user.id,
    reportId: '',
    title: user.nickname || user.id,
    status: `user_${status}`,
    reasons: reason ? [reason] : [],
    createdAt: now
  })

  return {
    user: sanitizeUserForOps(user),
    affected
  }
}

function blockUserForRisk(user, context = {}, state) {
  const now = context.now || Date.now()
  const actorId = context.actorId || 'risk'
  const reason = context.reason || 'risk_block'
  let revokedSessions = 0
  let removedItems = 0
  let disputedTrades = 0

  user.status = USER_STATUS.BLOCKED
  user.blockedAt = now
  user.blockedBy = actorId
  user.blockReason = reason
  user.unblockedAt = null
  user.unblockedBy = ''
  user.unblockReason = ''

  for (const session of state.sessions || []) {
    if (session.userId === user.id && !session.revokedAt) {
      session.revokedAt = now
      revokedSessions += 1
    }
  }

  for (const item of state.items || []) {
    if (item.seller?.id !== user.id || ![
      ITEM_STATUS.PENDING_REVIEW,
      ITEM_STATUS.ONLINE,
      ITEM_STATUS.RESERVED
    ].includes(item.status)) {
      continue
    }

    item.status = ITEM_STATUS.REMOVED
    item.reviewStatus = 'user_blocked'
    item.reviewReasons = normalizeReviewReasons(['user_blocked', reason])
    item.updatedAt = now
    removedItems += 1
  }

  for (const trade of state.trades || []) {
    const belongsToUser = trade.seller?.id === user.id || trade.buyer?.id === user.id

    if (!belongsToUser || !ACTIVE_TRADE_STATUSES.includes(trade.status)) {
      continue
    }

    trade.status = TRADE_STATUS.DISPUTED
    trade.contactCode = ''
    trade.contactCodeExpiresAt = null
    trade.updatedAt = now
    trade.timeline = [
      ...(trade.timeline || []),
      createTimelineEvent(TRADE_STATUS.DISPUTED, actorId, '用户风控封禁，交易转入争议')
    ]
    ensureDisputeCaseForTrade(state, trade, {
      source: 'risk',
      opener: {
        id: actorId,
        nickname: '运营风控'
      },
      reason: 'user_blocked',
      description: reason
    })
    notifyTradeParticipants(state, trade, {
      type: 'trade_disputed',
      title: '交易转入争议',
      body: `「${trade.itemTitle}」因账号风控处理转入争议。`
    })
    disputedTrades += 1
  }

  return {
    revokedSessions,
    removedItems,
    disputedTrades
  }
}

function unblockUserForRisk(user, context = {}) {
  const now = context.now || Date.now()

  user.status = USER_STATUS.ACTIVE
  user.unblockedAt = now
  user.unblockedBy = context.actorId || 'risk'
  user.unblockReason = context.reason || ''

  return {
    revokedSessions: 0,
    removedItems: 0,
    disputedTrades: 0
  }
}

function createClientEvents(options = {}, state) {
  const payload = options.data || {}
  const events = Array.isArray(payload.events) ? payload.events : [payload]
  const now = Date.now()
  const accepted = events
    .map((event) => normalizeClientEvent(event, options, state, now))
    .filter(Boolean)

  state.clientEvents = [
    ...accepted,
    ...normalizeClientEvents(state.clientEvents)
  ].slice(0, 1000)

  return {
    accepted: accepted.length
  }
}

function listOpsClientEvents(options = {}, state) {
  const filters = options.data || {}
  const type = String(filters.type || '').trim()
  const level = String(filters.level || '').trim()
  const userId = String(filters.userId || '').trim()
  const limit = normalizeLimit(filters.limit, 100)

  return {
    events: normalizeClientEvents(state.clientEvents)
      .filter((event) => !type || event.type === type)
      .filter((event) => !level || event.level === level)
      .filter((event) => !userId || event.userId === userId)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, limit)
  }
}

function listOpsLocationRiskEvents(options = {}, state) {
  const filters = options.data || {}
  const riskLevel = String(filters.riskLevel || filters.level || '').trim()
  const riskCode = String(filters.riskCode || filters.code || '').trim()
  const reviewStatus = String(filters.reviewStatus || filters.status || '').trim()
  const userId = String(filters.userId || '').trim()
  const action = String(filters.action || '').trim()
  const limit = normalizeLimit(filters.limit, 100)
  const events = normalizeLocationRiskEvents(state.locationRiskEvents)
  const usersById = new Map((Array.isArray(state.users) ? state.users : []).map((user) => [user.id, user]))

  return {
    counts: {
      total: events.length,
      high: events.filter((event) => event.riskLevel === 'high').length,
      normal: events.filter((event) => event.riskLevel === 'normal').length,
      pendingReview: events.filter((event) => event.reviewStatus === LOCATION_RISK_REVIEW_STATUS.PENDING_REVIEW).length,
      confirmedRisk: events.filter((event) => event.reviewStatus === LOCATION_RISK_REVIEW_STATUS.CONFIRMED_RISK).length,
      falsePositive: events.filter((event) => event.reviewStatus === LOCATION_RISK_REVIEW_STATUS.FALSE_POSITIVE).length,
      escalated: events.filter((event) => event.reviewStatus === LOCATION_RISK_REVIEW_STATUS.ESCALATED).length
    },
    events: events
      .filter((event) => !riskLevel || event.riskLevel === riskLevel)
      .filter((event) => !riskCode || event.riskCode === riskCode)
      .filter((event) => !reviewStatus || event.reviewStatus === reviewStatus)
      .filter((event) => !userId || event.userId === userId)
      .filter((event) => !action || event.action === action)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, limit)
      .map((event) => sanitizeLocationRiskEventForOps(event, usersById.get(event.userId)))
  }
}

function reviewOpsLocationRiskEvent(eventId, options = {}, state) {
  const payload = options.data || {}
  const events = normalizeLocationRiskEvents(state.locationRiskEvents)
  const event = events.find((candidate) => candidate.id === eventId)

  if (!event) {
    throw new Error('位置风险事件不存在')
  }

  const reviewStatus = normalizeLocationRiskReviewStatus(payload.reviewStatus || payload.status || payload.resolution)
  const actorId = String(payload.actorId || payload.operatorId || 'risk').trim().slice(0, 80)
  const note = String(payload.note || payload.resolutionNote || '').trim().slice(0, 500)
  const now = Date.now()

  if (reviewStatus !== LOCATION_RISK_REVIEW_STATUS.PENDING_REVIEW && !note) {
    throw new Error('请填写位置风险复核说明')
  }

  event.reviewStatus = reviewStatus
  event.resolution = reviewStatus
  event.resolutionNote = note
  event.reviewerId = actorId
  event.reviewedAt = reviewStatus === LOCATION_RISK_REVIEW_STATUS.PENDING_REVIEW ? null : now
  event.updatedAt = now

  state.locationRiskEvents = [
    event,
    ...events.filter((candidate) => candidate.id !== event.id)
  ].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))

  const user = Array.isArray(state.users) ? state.users.find((candidate) => candidate.id === event.userId) : null

  return {
    event: sanitizeLocationRiskEventForOps(event, user)
  }
}

function listOpsAuditEvents(options = {}, state) {
  const filters = options.data || {}
  const action = String(filters.action || '').trim()
  const actorId = String(filters.actorId || '').trim()
  const targetType = String(filters.targetType || '').trim()
  const targetId = String(filters.targetId || '').trim()
  const limit = normalizeLimit(filters.limit, 100)

  return {
    events: normalizeOpsAuditEvents(state.opsAuditEvents)
      .filter((event) => !action || event.action === action)
      .filter((event) => !actorId || event.actorId === actorId)
      .filter((event) => !targetType || event.targetType === targetType)
      .filter((event) => !targetId || event.targetId === targetId)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, limit)
  }
}

function resolveReportModeration(reportId, options = {}, state) {
  const payload = options.data || {}
  const report = normalizeReports(state.reports).find((candidate) => candidate.id === reportId)

  if (!report) {
    throw new Error('举报记录不存在')
  }

  if (report.status !== REPORT_STATUS.PENDING_REVIEW) {
    throw new Error('举报记录已处理')
  }

  const resolution = normalizeReportResolution(payload.resolution || payload.decision)
  const item = state.items.find((candidate) => candidate.id === report.targetId)
  const now = Date.now()
  const resolverId = payload.actorId || payload.resolverId || 'support'

  report.status = resolution === REPORT_RESOLUTION.DISMISS_REPORT
    ? REPORT_STATUS.REJECTED
    : REPORT_STATUS.RESOLVED
  report.resolution = resolution
  report.resolutionNote = String(payload.note || payload.resolutionNote || '').trim().slice(0, 500)
  report.resolverId = resolverId
  report.resolvedAt = now
  report.updatedAt = now

  if (item && resolution === REPORT_RESOLUTION.UPHOLD_REPORT) {
    item.status = ITEM_STATUS.REMOVED
    item.reviewStatus = 'report_resolved_removed'
    item.reviewReasons = normalizeReviewReasons(payload.reasons).length
      ? normalizeReviewReasons(payload.reasons)
      : [`report:${report.reason}`]
    item.updatedAt = now
    disputeActiveTradesForReport(item, report, report.reporter, state, now, '举报处理确认违规，交易转入争议')
  }

  if (
    item &&
    resolution === REPORT_RESOLUTION.DISMISS_REPORT &&
    item.status === ITEM_STATUS.REMOVED &&
    item.reviewStatus === 'reported_removed' &&
    !hasBlockingTradeForItem(item.id, state)
  ) {
    item.status = ITEM_STATUS.ONLINE
    item.reviewStatus = 'report_dismissed'
    item.reviewReasons = []
    item.updatedAt = now
  }

  state.moderationEvents.unshift({
    id: createId('moderation'),
    actorId: resolverId,
    targetType: 'report',
    targetId: report.id,
    reportId: report.id,
    title: item?.title || '',
    status: resolution,
    reasons: normalizeReviewReasons(payload.reasons).length
      ? normalizeReviewReasons(payload.reasons)
      : [`report:${report.reason}`],
    createdAt: now
  })
  state.reports = normalizeReports(state.reports).map((candidate) =>
    candidate.id === report.id ? report : candidate
  )

  return sanitizeReportForOps(report, state)
}

function reviewItemModeration(itemId, options = {}, state) {
  const payload = options.data || {}
  const status = payload.status || payload.reviewStatus
  const item = state.items.find((candidate) => candidate.id === itemId)
  const now = Date.now()
  const reasons = normalizeReviewReasons(payload.reasons)

  if (!item) {
    throw new Error('物品不存在或已下架')
  }

  if (!['approved', 'rejected', 'pending_media_review'].includes(status)) {
    throw new Error('审核状态无效')
  }

  if (status === 'approved') {
    assertModerationCanApprove(item)
    item.status = item.status === ITEM_STATUS.PENDING_REVIEW ? ITEM_STATUS.ONLINE : item.status
    item.reviewStatus = payload.reviewStatus || 'approved_manual'
    item.reviewReasons = []
    item.images = normalizeImages(item.images).map((image) => ({
      ...image,
      status: image.status === 'rejected' ? 'rejected' : 'uploaded'
    }))
    item.updatedAt = now
  }

  if (status === 'pending_media_review') {
    assertModerationCanPend(item)
    if (item.status === ITEM_STATUS.ONLINE || item.status === ITEM_STATUS.PENDING_REVIEW) {
      item.status = ITEM_STATUS.PENDING_REVIEW
    }
    item.reviewStatus = 'pending_media_review'
    item.reviewReasons = reasons.length ? reasons : ['内容安全待复核']
    item.updatedAt = now
  }

  if (status === 'rejected') {
    item.status = ITEM_STATUS.REMOVED
    item.reviewStatus = 'rejected'
    item.reviewReasons = reasons.length ? reasons : ['内容安全审核未通过']
    item.images = normalizeImages(item.images).map((image) => ({
      ...image,
      status: 'rejected'
    }))
    item.updatedAt = now

    disputeActiveTradesForModeration(item, payload.actorId, state, now)
  }

  state.moderationEvents.unshift({
    id: createId('moderation'),
    actorId: payload.actorId || null,
    targetType: 'item',
    targetId: item.id,
    title: item.title,
    status: item.reviewStatus,
    reasons: item.reviewReasons || [],
    createdAt: now
  })

  return sanitizeItemForResponse(item)
}

function reviewMediaModeration(traceId, options = {}, state) {
  const mediaTraceId = normalizeTraceId(traceId)
  const payload = options.data || {}
  const status = payload.status || payload.reviewStatus
  const now = Date.now()
  const reasons = normalizeReviewReasons(payload.reasons)
  const match = findImageByTraceId(state, mediaTraceId)

  if (!mediaTraceId || !match) {
    throw new Error('审核媒体不存在或已处理')
  }

  if (!['approved', 'rejected', 'pending_media_review'].includes(status)) {
    throw new Error('审核状态无效')
  }

  if (status === 'approved') {
    assertModerationCanApprove(match.item)
    updateMatchedImage(match, {
      status: 'uploaded',
      moderationStatus: payload.reviewStatus || 'approved_manual',
      moderationReasons: []
    })

    if (match.item.status === ITEM_STATUS.PENDING_REVIEW && !hasPendingMedia(match.item)) {
      match.item.status = ITEM_STATUS.ONLINE
      match.item.reviewStatus = payload.reviewStatus || 'approved_manual'
      match.item.reviewReasons = []
    }

    match.item.updatedAt = now
  }

  if (status === 'pending_media_review') {
    assertModerationCanPend(match.item)
    updateMatchedImage(match, {
      status: 'pending_review',
      moderationStatus: 'pending_media_review',
      moderationReasons: reasons.length ? reasons : ['内容安全待复核']
    })

    if (match.item.status === ITEM_STATUS.ONLINE || match.item.status === ITEM_STATUS.PENDING_REVIEW) {
      match.item.status = ITEM_STATUS.PENDING_REVIEW
    }
    match.item.reviewStatus = 'pending_media_review'
    match.item.reviewReasons = reasons.length ? reasons : ['内容安全待复核']
    match.item.updatedAt = now
  }

  if (status === 'rejected') {
    updateMatchedImage(match, {
      status: 'rejected',
      moderationStatus: 'rejected',
      moderationReasons: reasons.length ? reasons : ['内容安全审核未通过']
    })
    match.item.status = ITEM_STATUS.REMOVED
    match.item.reviewStatus = 'rejected'
    match.item.reviewReasons = reasons.length ? reasons : ['内容安全审核未通过']
    match.item.updatedAt = now
    disputeActiveTradesForModeration(match.item, payload.actorId, state, now)
  }

  state.moderationEvents.unshift({
    id: createId('moderation'),
    actorId: payload.actorId || null,
    targetType: 'item_image',
    targetId: match.image.id || null,
    title: match.item.title,
    status: status === 'approved' ? 'approved_manual' : match.item.reviewStatus,
    reasons: status === 'approved' ? [] : match.item.reviewReasons || [],
    createdAt: now
  })

  return sanitizeItemForResponse(match.item)
}

function findImageByTraceId(state, traceId) {
  for (const item of state.items || []) {
    const images = Array.isArray(item.images) ? item.images : []
    const imageIndex = images.findIndex((image) => normalizeTraceId(image?.traceId || image?.moderationTraceId) === traceId)

    if (imageIndex >= 0) {
      return {
        item,
        image: images[imageIndex],
        imageIndex
      }
    }
  }

  return null
}

function updateMatchedImage(match, patch) {
  const images = Array.isArray(match.item.images) ? match.item.images : []
  match.item.images = images.map((image, index) => index === match.imageIndex
    ? {
        ...image,
        ...patch
      }
    : image)
  match.image = match.item.images[match.imageIndex]
}

function hasPendingMedia(item) {
  return normalizeImages(item.images).some((image) =>
    image.status === 'pending_review' ||
    image.moderationStatus === 'pending_media_review'
  )
}

function normalizeTraceId(value = '') {
  return String(value || '').trim()
}

function assertModerationCanApprove(item) {
  if (item.status === ITEM_STATUS.REMOVED) {
    throw new Error('审核回调不能重新上架已下架商品')
  }
}

function assertModerationCanPend(item) {
  if ([ITEM_STATUS.REMOVED, ITEM_STATUS.SOLD].includes(item.status)) {
    throw new Error('审核回调不能改变已终态商品')
  }
}

function disputeActiveTradesForModeration(item, actorId, state, now = Date.now()) {
  for (const trade of state.trades) {
    if (trade.itemId !== item.id || !ACTIVE_TRADE_STATUSES.includes(trade.status)) {
      continue
    }

    trade.status = TRADE_STATUS.DISPUTED
    trade.contactCode = ''
    trade.contactCodeExpiresAt = null
    trade.updatedAt = now
    trade.timeline = [
      ...(trade.timeline || []),
      createTimelineEvent(TRADE_STATUS.DISPUTED, actorId || 'moderation', '内容安全审核拒绝，交易转入争议')
    ]
    ensureDisputeCaseForTrade(state, trade, {
      source: 'moderation',
      opener: {
        id: actorId || 'moderation',
        nickname: '内容安全审核'
      },
      reason: 'content_rejected',
      description: '内容安全审核拒绝，交易转入争议'
    })
    pushTradeNotification(state, {
      userId: trade.buyer?.id,
      type: 'trade_disputed',
      title: '交易转入争议',
      body: `「${trade.itemTitle}」因内容安全审核拒绝转入争议。`,
      trade
    })
    pushTradeNotification(state, {
      userId: trade.seller?.id,
      type: 'trade_disputed',
      title: '交易转入争议',
      body: `「${trade.itemTitle}」因内容安全审核拒绝转入争议。`,
      trade
    })
  }
}

function applyHighRiskReportToItem(item, report, reporter, state) {
  if (item.status === ITEM_STATUS.SOLD) {
    return
  }

  const now = Date.now()

  item.status = ITEM_STATUS.REMOVED
  item.reviewStatus = 'reported_removed'
  item.updatedAt = now

  state.moderationEvents.unshift({
    id: createId('moderation'),
    actorId: reporter.id,
    targetType: 'item',
    targetId: item.id,
    reportId: report.id,
    status: 'reported_removed',
    reasons: [`report:${report.reason}`],
    createdAt: now
  })

  disputeActiveTradesForReport(item, report, reporter, state, now, '高风险举报触发风控复核')
}

function disputeActiveTradesForReport(item, report, opener, state, now = Date.now(), label = '高风险举报触发风控复核') {
  for (const trade of state.trades) {
    if (trade.itemId !== item.id || !ACTIVE_TRADE_STATUSES.includes(trade.status)) {
      continue
    }

    trade.status = TRADE_STATUS.DISPUTED
    trade.contactCode = ''
    trade.contactCodeExpiresAt = null
    trade.updatedAt = now
    trade.timeline = [
      ...(trade.timeline || []),
      createTimelineEvent(TRADE_STATUS.DISPUTED, opener?.id || 'report', label)
    ]
    ensureDisputeCaseForTrade(state, trade, {
      source: 'report',
      opener,
      reason: report.reason,
      description: report.description || label,
      reportId: report.id
    })
    pushTradeNotification(state, {
      userId: trade.buyer?.id,
      type: 'trade_disputed',
      title: '交易转入争议',
      body: `「${trade.itemTitle}」因举报处理转入争议。`,
      trade
    })
    pushTradeNotification(state, {
      userId: trade.seller?.id,
      type: 'trade_disputed',
      title: '交易转入争议',
      body: `「${trade.itemTitle}」因举报处理转入争议。`,
      trade
    })
  }
}

function findDuplicateReport(reporterId, payload = {}, state) {
  return state.reports.find((report) =>
    report.reporter?.id === reporterId &&
    report.targetType === payload.targetType &&
    report.targetId === payload.targetId &&
    report.reason === payload.reason &&
    report.status === 'pending_review'
  ) || null
}

function assertReportPayload(payload = {}) {
  if (!payload.targetType || !payload.targetId || !payload.reason) {
    throw new Error('举报信息不完整')
  }

  if (payload.targetType !== 'item') {
    throw new Error('暂不支持该举报对象')
  }

  if (!ALLOWED_REPORT_REASONS.includes(payload.reason)) {
    throw new Error('举报原因无效')
  }
}

function normalizeReviewReasons(reasons) {
  if (Array.isArray(reasons)) {
    return reasons.map((reason) => String(reason || '').trim()).filter(Boolean)
  }

  if (reasons) {
    return [String(reasons).trim()].filter(Boolean)
  }

  return []
}

function findReportTarget(payload = {}, state) {
  const item = state.items.find((candidate) =>
    candidate.id === payload.targetId &&
    ![ITEM_STATUS.PENDING_REVIEW, ITEM_STATUS.REMOVED].includes(candidate.status)
  )

  if (!item) {
    throw new Error('举报对象不存在或已下架')
  }

  return item
}

function assertTradeTransition(trade, nextStatus, actor) {
  const isSeller = trade.seller?.id === actor.id
  const isBuyer = trade.buyer?.id === actor.id

  if (!isSeller && !isBuyer) {
    throw new Error('当前账号不能执行该交易操作')
  }

  if (nextStatus === TRADE_STATUS.PENDING_MEETUP && isSeller && trade.status === TRADE_STATUS.PENDING_SELLER_CONFIRM) {
    return
  }

  if (nextStatus === TRADE_STATUS.CANCELLED && ACTIVE_TRADE_STATUSES.includes(trade.status)) {
    return
  }

  if (nextStatus === TRADE_STATUS.COMPLETED && trade.status === TRADE_STATUS.PENDING_MEETUP) {
    return
  }

  if (nextStatus === TRADE_STATUS.DISPUTED && trade.status === TRADE_STATUS.PENDING_MEETUP) {
    return
  }

  throw new Error('当前交易状态不允许该操作')
}

function assertTradeCanBeReviewed(trade, reviewer, state) {
  const isSeller = trade.seller?.id === reviewer.id
  const isBuyer = trade.buyer?.id === reviewer.id

  if (!isSeller && !isBuyer) {
    throw new Error('当前账号不能评价该交易')
  }

  if (trade.status !== TRADE_STATUS.COMPLETED) {
    throw new Error('交易完成后才能评价')
  }

  const duplicate = normalizeReviews(state.reviews).find((review) =>
    review.tradeId === trade.id &&
    review.reviewer?.id === reviewer.id
  )

  if (duplicate) {
    throw new Error('该交易已评价，不能重复评价')
  }
}

function ensureDisputeCaseForTrade(state, trade, options = {}) {
  const existing = normalizeDisputeCases(state.disputeCases).find((disputeCase) =>
    disputeCase.tradeId === trade.id &&
    disputeCase.status === DISPUTE_STATUS.OPEN
  )

  if (existing) {
    return existing
  }

  const now = Date.now()
  const disputeCase = {
    id: createId('dispute'),
    tradeId: trade.id,
    itemId: trade.itemId,
    itemTitle: trade.itemTitle || '',
    opener: normalizeUserForTrade(options.opener || {}),
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
  }

  state.disputeCases = [
    disputeCase,
    ...normalizeDisputeCases(state.disputeCases)
  ]

  return disputeCase
}

function normalizeDisputeResolution(value = '') {
  const resolution = String(value || '').trim()

  if (!Object.values(DISPUTE_RESOLUTION).includes(resolution)) {
    throw new Error('争议处理结果无效')
  }

  return resolution
}

function normalizeReportResolution(value = '') {
  const resolution = String(value || '').trim()

  if (!Object.values(REPORT_RESOLUTION).includes(resolution)) {
    throw new Error('举报处理结果无效')
  }

  return resolution
}

function normalizeOpsUserStatus(value = '') {
  const status = String(value || '').trim()

  if (![USER_STATUS.ACTIVE, USER_STATUS.BLOCKED].includes(status)) {
    throw new Error('用户状态只能调整为 active 或 blocked')
  }

  return status
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

function normalizeReviewTags(tags = []) {
  if (!Array.isArray(tags)) {
    return []
  }

  return tags
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .slice(0, 5)
}

function assertBuyerLocationQuality(location = {}) {
  if (!Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) {
    throw new Error('需要提交实时 GPS 定位后才能发起交易')
  }

  const capturedAt = Number(location.capturedAt)

  if (!Number.isFinite(capturedAt)) {
    throw new Error('需要提交实时 GPS 定位时间后才能发起交易')
  }

  const now = Date.now()

  if (capturedAt > now + 60 * 1000) {
    throw new Error('定位时间异常，请重新定位后再发起交易')
  }

  if (now - capturedAt > LOCATION_CACHE_TTL_MS) {
    throw new Error('当前位置已过期，请重新定位后再发起交易')
  }

  const accuracy = Number(location.accuracy)

  if (!Number.isFinite(accuracy)) {
    throw new Error('未获取到定位精度，请使用实时 GPS 定位后再试')
  }

  if (accuracy > MAX_LOCATION_ACCURACY_METERS) {
    throw new Error(`定位精度约 ${Math.round(accuracy)}m，请到开阔位置或开启精准定位后重试`)
  }
}

function hasActiveTradeForItem(itemId, state) {
  return state.trades.some((trade) => trade.itemId === itemId && ACTIVE_TRADE_STATUSES.includes(trade.status))
}

function hasBlockingTradeForItem(itemId, state) {
  return state.trades.some((trade) => trade.itemId === itemId && BLOCKING_TRADE_STATUSES.includes(trade.status))
}

function requireUser(options = {}, state) {
  return requireSession(options, state).user
}

function resolveOptionalUser(options = {}, state = {}) {
  try {
    return requireSession(options, state).user
  } catch (error) {
    return null
  }
}

function requireSession(options = {}, state) {
  const token = options.token || parseBearer(options.header?.Authorization)
  const now = Date.now()
  const tokenHash = hashSessionToken(token)
  const session = state.sessions.find((candidate) => candidate.tokenHash === tokenHash)

  if (!session || session.revokedAt || Number(session.expiresAt) <= now) {
    throw new Error('登录态无效，请重新登录')
  }

  const user = state.users.find((candidate) => candidate.id === session.userId)

  if (!user || user.status !== 'active') {
    session.revokedAt = now
    throw new Error('登录态无效，请重新登录')
  }

  session.lastSeenAt = now

  return {
    user,
    session
  }
}

function createSession(user, state, now = Date.now()) {
  const token = createSessionToken(user.id)
  const session = {
    id: createId('session'),
    tokenHash: hashSessionToken(token),
    userId: user.id,
    provider: user.provider || '',
    createdAt: now,
    expiresAt: now + AUTH_SESSION_TTL_MS,
    lastSeenAt: now,
    revokedAt: null
  }

  state.sessions.unshift(session)

  return {
    ...session,
    token
  }
}

function revokeUserSessions(userId, state, now = Date.now()) {
  for (const session of state.sessions) {
    if (session.userId === userId && !session.revokedAt) {
      session.revokedAt = now
    }
  }
}

function normalizeItem(item) {
  return {
    status: ITEM_STATUS.ONLINE,
    reviewStatus: 'seed',
    images: [],
    ...item,
    seller: normalizeUserForItem(item.seller || {}),
    updatedAt: item.updatedAt || item.createdAt || Date.now()
  }
}

function normalizeUserForItem(user = {}) {
  return {
    id: user.id || '',
    nickname: user.nickname || '社区用户',
    avatarUrl: user.avatarUrl || '',
    contactCode: user.contactCode || user.contact || ''
  }
}

function normalizeUserForTrade(user = {}) {
  return {
    id: user.id || '',
    nickname: user.nickname || '社区用户',
    avatarUrl: user.avatarUrl || ''
  }
}

function sanitizeItemForResponse(item) {
  return {
    ...item,
    location: sanitizeItemLocation(item.location),
    seller: normalizeUserForTrade(item.seller || {})
  }
}

function sanitizeTradeForResponse(trade = {}, user = {}, state = {}) {
  const canViewContact = isTradeContactCodeActive(trade) &&
    (trade.buyer?.id === user.id || trade.seller?.id === user.id)

  return {
    ...trade,
    contactCode: canViewContact ? trade.contactCode || '' : '',
    contactCodeExpiresAt: canViewContact ? trade.contactCodeExpiresAt || null : null,
    reviewedByMe: hasReviewForTrade(state, trade.id, user.id),
    disputeCase: sanitizeDisputeCaseForResponse(findDisputeCaseForTrade(state, trade.id))
  }
}

function clearExpiredTradeContactCodes(state = {}, now = Date.now()) {
  if (!Array.isArray(state.trades)) {
    return
  }

  for (const trade of state.trades) {
    if (!shouldClearExpiredTradeContactCode(trade, now)) {
      continue
    }

    trade.contactCode = ''
    trade.contactCodeExpiresAt = null
    trade.updatedAt = now
  }
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

function normalizeNotifications(notifications = []) {
  return Array.isArray(notifications) ? notifications : []
}

function normalizeNotificationDeliveries(deliveries = []) {
  return Array.isArray(deliveries) ? deliveries : []
}

function normalizeReviews(reviews = []) {
  return Array.isArray(reviews) ? reviews : []
}

function normalizeDisputeCases(disputeCases = []) {
  return Array.isArray(disputeCases) ? disputeCases : []
}

function normalizeReports(reports = []) {
  return Array.isArray(reports)
    ? reports.map((report) => ({
        ...report,
        status: report.status || REPORT_STATUS.PENDING_REVIEW,
        resolution: report.resolution || '',
        resolutionNote: report.resolutionNote || '',
        resolverId: report.resolverId || '',
        updatedAt: report.updatedAt || report.createdAt || Date.now(),
        resolvedAt: report.resolvedAt || null
      }))
    : []
}

function hasReviewForTrade(state = {}, tradeId = '', reviewerId = '') {
  if (!tradeId || !reviewerId) {
    return false
  }

  return normalizeReviews(state.reviews).some((review) =>
    review.tradeId === tradeId &&
    review.reviewer?.id === reviewerId
  )
}

function sanitizeReviewForResponse(review = {}) {
  return {
    id: review.id || '',
    tradeId: review.tradeId || '',
    itemId: review.itemId || '',
    itemTitle: review.itemTitle || '',
    reviewer: normalizeUserForTrade(review.reviewer || {}),
    reviewee: normalizeUserForTrade(review.reviewee || {}),
    rating: Number(review.rating),
    content: review.content || '',
    tags: normalizeReviewTags(review.tags),
    createdAt: review.createdAt || Date.now()
  }
}

function findDisputeCaseForTrade(state = {}, tradeId = '') {
  if (!tradeId) {
    return null
  }

  return normalizeDisputeCases(state.disputeCases)
    .filter((disputeCase) => disputeCase.tradeId === tradeId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
}

function sanitizeDisputeCaseForResponse(disputeCase = null) {
  if (!disputeCase) {
    return null
  }

  return {
    id: disputeCase.id || '',
    tradeId: disputeCase.tradeId || '',
    itemId: disputeCase.itemId || '',
    itemTitle: disputeCase.itemTitle || '',
    opener: normalizeUserForTrade(disputeCase.opener || {}),
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

function sanitizeReportForOps(report = {}, state = {}) {
  const targetItem = report.targetType === 'item'
    ? state.items?.find((item) => item.id === report.targetId)
    : null

  return {
    id: report.id || '',
    reporter: normalizeUserForTrade(report.reporter || {}),
    targetType: report.targetType || '',
    targetId: report.targetId || '',
    reason: report.reason || '',
    description: report.description || '',
    status: report.status || REPORT_STATUS.PENDING_REVIEW,
    resolution: report.resolution || '',
    resolutionNote: report.resolutionNote || '',
    resolverId: report.resolverId || '',
    targetItem: targetItem ? sanitizeItemForResponse(targetItem) : null,
    createdAt: report.createdAt || Date.now(),
    updatedAt: report.updatedAt || report.createdAt || Date.now(),
    resolvedAt: report.resolvedAt || null
  }
}

function sanitizeUserForOps(user = {}) {
  return {
    id: user.id || '',
    provider: user.provider || '',
    platformId: maskSensitiveId(user.platformId),
    nickname: user.nickname || '社区用户',
    avatarUrl: user.avatarUrl || '',
    status: user.status || USER_STATUS.ACTIVE,
    agreementVersion: user.agreementVersion || '',
    agreementAcceptedAt: user.agreementAcceptedAt || null,
    blockReason: user.blockReason || '',
    blockedAt: user.blockedAt || null,
    blockedBy: user.blockedBy || '',
    unblockedAt: user.unblockedAt || null,
    unblockedBy: user.unblockedBy || '',
    createdAt: user.createdAt || Date.now(),
    deletedAt: user.deletedAt || null
  }
}

function sanitizeLocationRiskEventForOps(event = {}, user = {}) {
  return {
    id: event.id || '',
    userId: event.userId || '',
    user: user?.id ? sanitizeUserForOps(user) : null,
    action: event.action || '',
    targetType: event.targetType || '',
    targetId: event.targetId || '',
    regionCommunityId: event.regionCommunityId || '',
    regionStreetId: event.regionStreetId || '',
    capturedAt: event.capturedAt || null,
    previousEventId: event.previousEventId || '',
    distanceMeters: normalizeOptionalNumber(event.distanceMeters),
    elapsedMs: Number.isFinite(Number(event.elapsedMs)) ? Math.trunc(Number(event.elapsedMs)) : null,
    speedMetersPerSecond: normalizeOptionalNumber(event.speedMetersPerSecond),
    riskLevel: event.riskLevel || 'normal',
    riskCode: event.riskCode || '',
    reviewStatus: normalizeLocationRiskReviewStatus(event.reviewStatus || event.review_status || defaultLocationRiskReviewStatus(event)),
    resolution: event.resolution || '',
    resolutionNote: event.resolutionNote || '',
    reviewerId: event.reviewerId || '',
    reviewedAt: event.reviewedAt || null,
    createdAt: event.createdAt || Date.now(),
    updatedAt: event.updatedAt || event.createdAt || Date.now()
  }
}

function maskSensitiveId(value = '') {
  const normalized = String(value || '').trim()

  if (!normalized) {
    return ''
  }

  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`
  }

  return `${normalized.slice(0, 4)}***${normalized.slice(-4)}`
}

function normalizeClientEvent(event = {}, options = {}, state = {}, now = Date.now()) {
  const type = String(event.type || '').trim().slice(0, 80)

  if (!type) {
    return null
  }

  const user = resolveOptionalUser(options, state)
  const context = sanitizeClientEventContext(event.context || event.meta || {})

  return {
    id: event.id || createId('client_event'),
    type,
    level: normalizeClientEventLevel(event.level),
    code: String(event.code || '').trim().slice(0, 80),
    message: String(event.message || '').trim().slice(0, 500),
    route: String(event.route || '').trim().slice(0, 160),
    userId: event.userId || user?.id || '',
    platform: String(event.platform || '').trim().slice(0, 40),
    appEnv: String(event.appEnv || '').trim().slice(0, 20),
    traceId: String(event.traceId || '').trim().slice(0, 120),
    context,
    createdAt: Number(event.createdAt || now)
  }
}

function normalizeClientEvents(events = []) {
  return Array.isArray(events)
    ? events.map((event) => ({
        id: event.id || '',
        type: event.type || '',
        level: normalizeClientEventLevel(event.level),
        code: event.code || '',
        message: event.message || '',
        route: event.route || '',
        userId: event.userId || '',
        platform: event.platform || '',
        appEnv: event.appEnv || '',
        traceId: event.traceId || '',
        context: sanitizeClientEventContext(event.context || {}),
        createdAt: event.createdAt || Date.now()
      })).filter((event) => event.id && event.type)
    : []
}

function normalizeOpsAuditEvents(events = []) {
  return Array.isArray(events)
    ? events.map((event) => ({
        id: event.id || '',
        actorId: event.actorId || '',
        action: event.action || '',
        targetType: event.targetType || '',
        targetId: event.targetId || '',
        result: event.result || 'success',
        message: String(event.message || '').slice(0, 500),
        traceId: event.traceId || '',
        source: event.source || '',
        context: sanitizeClientEventContext(event.context || {}),
        createdAt: event.createdAt || Date.now()
      })).filter((event) => event.id && event.action)
    : []
}

function normalizeClientEventLevel(level = '') {
  const normalized = String(level || '').trim().toLowerCase()
  return ['debug', 'info', 'warn', 'error'].includes(normalized) ? normalized : 'info'
}

function sanitizeClientEventContext(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return {}
  }

  const blockedKeys = /token|secret|password|authorization|contact|phone|mobile|openid|unionid|avatar|address|latitude|longitude/i
  const sanitized = {}

  for (const [key, value] of Object.entries(context).slice(0, 30)) {
    if (blockedKeys.test(key)) {
      continue
    }

    sanitized[key] = sanitizeClientEventValue(value)
  }

  return sanitized
}

function sanitizeClientEventValue(value) {
  if (value === null || value === undefined) {
    return value
  }

  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return String(value).slice(0, 200)
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map(sanitizeClientEventValue)
  }

  if (typeof value === 'object') {
    return sanitizeClientEventContext(value)
  }

  return ''
}

function recordTrustedLocationUse(state = {}, options = {}) {
  const userId = String(options.user?.id || '').trim()
  const currentLocation = normalizeLocationRiskPoint(options.location)

  if (!userId || !currentLocation) {
    return null
  }

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const events = normalizeLocationRiskEvents(state.locationRiskEvents)
  const event = {
    id: createId('location_risk'),
    userId,
    action: String(options.action || '').trim(),
    targetType: String(options.targetType || '').trim(),
    targetId: String(options.targetId || '').trim(),
    latitude: currentLocation.latitude,
    longitude: currentLocation.longitude,
    accuracy: normalizeOptionalNumber(options.location?.accuracy),
    regionCommunityId: options.region?.communityId || options.location?.communityId || '',
    regionStreetId: options.region?.streetId || options.location?.streetId || '',
    capturedAt: currentLocation.capturedAt,
    previousEventId: '',
    distanceMeters: null,
    elapsedMs: null,
    speedMetersPerSecond: null,
    riskLevel: 'normal',
    riskCode: '',
    reviewStatus: LOCATION_RISK_REVIEW_STATUS.NOT_REQUIRED,
    resolution: '',
    resolutionNote: '',
    reviewerId: '',
    reviewedAt: null,
    createdAt: now,
    updatedAt: now
  }
  const previous = findPreviousLocationRiskEvent(events, event)

  if (previous) {
    const distanceMeters = distanceInMeters(event, previous)
    const elapsedMs = Math.max(event.capturedAt - previous.capturedAt, 1)
    const speedMetersPerSecond = distanceMeters === null ? null : distanceMeters / (elapsedMs / 1000)

    event.previousEventId = previous.id || ''
    event.distanceMeters = Number.isFinite(distanceMeters) ? Math.round(distanceMeters) : null
    event.elapsedMs = elapsedMs
    event.speedMetersPerSecond = Number.isFinite(speedMetersPerSecond)
      ? Math.round(speedMetersPerSecond * 10) / 10
      : null

    if (isImpossibleLocationTravel(event)) {
      event.riskLevel = 'high'
      event.riskCode = 'IMPOSSIBLE_TRAVEL'
      event.reviewStatus = LOCATION_RISK_REVIEW_STATUS.PENDING_REVIEW
      pushLocationRiskClientEvent(state, event, previous)
    }
  }

  state.locationRiskEvents = [event, ...events]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, LOCATION_RISK_EVENT_LIMIT)

  return event
}

function normalizeLocationRiskEvents(events = []) {
  return Array.isArray(events)
    ? events
        .map((event) => ({
          id: event.id || '',
          userId: event.userId || '',
          action: event.action || '',
          targetType: event.targetType || '',
          targetId: event.targetId || '',
          latitude: normalizeOptionalNumber(event.latitude),
          longitude: normalizeOptionalNumber(event.longitude),
          accuracy: normalizeOptionalNumber(event.accuracy),
          regionCommunityId: event.regionCommunityId || '',
          regionStreetId: event.regionStreetId || '',
          capturedAt: Number.isFinite(Number(event.capturedAt)) ? Number(event.capturedAt) : Number(event.createdAt || Date.now()),
          previousEventId: event.previousEventId || '',
          distanceMeters: normalizeOptionalNumber(event.distanceMeters),
          elapsedMs: Number.isFinite(Number(event.elapsedMs)) ? Math.trunc(Number(event.elapsedMs)) : null,
          speedMetersPerSecond: normalizeOptionalNumber(event.speedMetersPerSecond),
          riskLevel: event.riskLevel || 'normal',
          riskCode: event.riskCode || '',
          reviewStatus: normalizeLocationRiskReviewStatus(event.reviewStatus || event.review_status || defaultLocationRiskReviewStatus(event)),
          resolution: event.resolution || '',
          resolutionNote: event.resolutionNote || event.resolution_note || '',
          reviewerId: event.reviewerId || event.reviewer_id || '',
          reviewedAt: Number.isFinite(Number(event.reviewedAt ?? event.reviewed_at)) ? Number(event.reviewedAt ?? event.reviewed_at) : null,
          createdAt: Number.isFinite(Number(event.createdAt)) ? Number(event.createdAt) : Date.now(),
          updatedAt: Number.isFinite(Number(event.updatedAt ?? event.updated_at)) ? Number(event.updatedAt ?? event.updated_at) : Number(event.createdAt || Date.now())
        }))
        .filter((event) =>
          event.id &&
          event.userId &&
          Number.isFinite(event.capturedAt)
        )
    : []
}

function defaultLocationRiskReviewStatus(event = {}) {
  return event.riskLevel === 'high'
    ? LOCATION_RISK_REVIEW_STATUS.PENDING_REVIEW
    : LOCATION_RISK_REVIEW_STATUS.NOT_REQUIRED
}

function normalizeLocationRiskReviewStatus(value = '') {
  const normalized = String(value || '').trim()
  const allowed = new Set(Object.values(LOCATION_RISK_REVIEW_STATUS))

  if (allowed.has(normalized)) {
    return normalized
  }

  throw new Error('位置风险复核状态无效')
}

function normalizeLocationRiskPoint(location = {}) {
  const latitude = Number(location.latitude)
  const longitude = Number(location.longitude)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }

  const capturedAt = Number(location.capturedAt)

  return {
    latitude,
    longitude,
    capturedAt: Number.isFinite(capturedAt) ? capturedAt : Date.now()
  }
}

function findPreviousLocationRiskEvent(events = [], event = {}) {
  return events
    .filter((candidate) =>
      candidate.userId === event.userId &&
      candidate.id !== event.id &&
      Number.isFinite(candidate.latitude) &&
      Number.isFinite(candidate.longitude) &&
      Number.isFinite(candidate.capturedAt) &&
      candidate.capturedAt <= event.capturedAt &&
      event.capturedAt - candidate.capturedAt <= LOCATION_RISK_LOOKBACK_MS
    )
    .sort((a, b) => b.capturedAt - a.capturedAt)[0] || null
}

function isImpossibleLocationTravel(event = {}) {
  return Number.isFinite(event.distanceMeters) &&
    Number.isFinite(event.speedMetersPerSecond) &&
    event.distanceMeters >= LOCATION_RISK_MIN_DISTANCE_METERS &&
    event.speedMetersPerSecond > LOCATION_RISK_MAX_SPEED_METERS_PER_SECOND
}

function pushLocationRiskClientEvent(state = {}, event = {}, previous = {}) {
  state.clientEvents = [
    {
      id: createId('client_event'),
      type: 'location_risk',
      level: 'warn',
      code: event.riskCode,
      message: '账号短时间位置切换异常',
      route: event.action,
      userId: event.userId,
      platform: '',
      appEnv: '',
      traceId: '',
      context: sanitizeClientEventContext({
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        previousAction: previous.action || '',
        previousTargetType: previous.targetType || '',
        previousTargetId: previous.targetId || '',
        previousRegionCommunityId: previous.regionCommunityId || '',
        previousRegionStreetId: previous.regionStreetId || '',
        currentRegionCommunityId: event.regionCommunityId || '',
        currentRegionStreetId: event.regionStreetId || '',
        distanceMeters: event.distanceMeters,
        elapsedMs: event.elapsedMs,
        speedMetersPerSecond: event.speedMetersPerSecond
      }),
      createdAt: event.createdAt
    },
    ...normalizeClientEvents(state.clientEvents)
  ]
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function pushTradeStatusNotifications(state, trade, nextStatus, actor) {
  if (nextStatus === TRADE_STATUS.PENDING_MEETUP) {
    pushTradeNotification(state, {
      userId: trade.buyer?.id,
      type: 'trade_confirmed',
      title: '卖家已确认交易',
      body: `「${trade.itemTitle}」已确认可交易，可在交易页查看一次性联系码。`,
      trade
    })
    return
  }

  if (nextStatus === TRADE_STATUS.COMPLETED) {
    notifyTradeCounterpart(state, trade, actor, {
      type: 'trade_completed',
      title: '交易已完成',
      body: `「${trade.itemTitle}」已标记完成。`
    })
    return
  }

  if (nextStatus === TRADE_STATUS.CANCELLED) {
    notifyTradeCounterpart(state, trade, actor, {
      type: 'trade_cancelled',
      title: '交易已取消',
      body: `「${trade.itemTitle}」已取消，商品将按规则恢复在售。`
    })
    return
  }

  if (nextStatus === TRADE_STATUS.DISPUTED) {
    notifyTradeCounterpart(state, trade, actor, {
      type: 'trade_disputed',
      title: '交易转入争议',
      body: `「${trade.itemTitle}」已转入争议，请等待后续处理。`
    })
  }
}

function notifyTradeCounterpart(state, trade, actor, notification = {}) {
  const actorId = actor?.id || actor
  const users = [trade.buyer, trade.seller]
    .map((user) => user?.id || '')
    .filter(Boolean)
    .filter((userId) => userId !== actorId)

  for (const userId of users) {
    pushTradeNotification(state, {
      ...notification,
      userId,
      trade
    })
  }
}

function notifyTradeParticipants(state, trade, notification = {}) {
  const userIds = [trade.buyer, trade.seller]
    .map((user) => user?.id || '')
    .filter(Boolean)

  for (const userId of new Set(userIds)) {
    pushTradeNotification(state, {
      ...notification,
      userId,
      trade
    })
  }
}

function pushTradeNotification(state, payload = {}) {
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

  state.notifications = [
    notification,
    ...normalizeNotifications(state.notifications)
  ]

  return notification
}

function sanitizeItemLocation(location = {}) {
  return {
    communityId: location.communityId || '',
    communityName: location.communityName || '',
    streetId: location.streetId || '',
    streetName: location.streetName || '',
    regionPrecision: location.regionPrecision || '',
    scopeType: location.scopeType || '',
    radiusMeters: location.radiusMeters || null
  }
}

function normalizeResolvedRegion(region = {}) {
  return {
    communityId: region.communityId || '',
    communityName: region.communityName || '',
    streetId: region.streetId || '',
    streetName: region.streetName || '',
    precision: region.precision || (region.communityId ? 'community' : 'street'),
    distanceMeters: Number.isFinite(Number(region.distanceMeters)) ? Number(region.distanceMeters) : null
  }
}

function normalizeFilterLocation(filters = {}) {
  const latitude = Number(filters.latitude)
  const longitude = Number(filters.longitude)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }

  assertListLocationQuality(filters)

  return {
    latitude,
    longitude,
    accuracy: Number(filters.accuracy),
    capturedAt: Number(filters.capturedAt)
  }
}

function assertListLocationQuality(location = {}) {
  const capturedAt = Number(location.capturedAt)

  if (!Number.isFinite(capturedAt)) {
    throw new Error('需要提交实时 GPS 定位时间后才能查看附近商品')
  }

  const now = Date.now()

  if (capturedAt > now + 60 * 1000) {
    throw new Error('定位时间异常，请重新定位后再查看附近商品')
  }

  if (now - capturedAt > LOCATION_CACHE_TTL_MS) {
    throw new Error('当前位置已过期，请重新定位后再查看附近商品')
  }

  const accuracy = Number(location.accuracy)

  if (!Number.isFinite(accuracy)) {
    throw new Error('未获取到定位精度，请使用实时 GPS 定位后再试')
  }

  if (accuracy > MAX_LOCATION_ACCURACY_METERS) {
    throw new Error(`定位精度约 ${Math.round(accuracy)}m，请到开阔位置或开启精准定位后重试`)
  }
}

function normalizeFilterRegion(filters = {}, currentLocation = null) {
  if (filters.serverRegion) {
    return normalizeResolvedRegion(filters.serverRegion)
  }

  if (filters.communityId || filters.streetId) {
    return {
      communityId: filters.communityId || '',
      communityName: filters.communityName || '',
      streetId: filters.streetId || '',
      streetName: filters.streetName || '',
      precision: filters.communityId ? 'community' : 'street'
    }
  }

  const sampleRegion = currentLocation ? resolveRegionFromSamples(currentLocation) : null
  return sampleRegion ? normalizeResolvedRegion(sampleRegion) : null
}

function buildVisibleListItem(item, currentLocation, currentRegion) {
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

function normalizeLimit(value, fallback = 50) {
  return Math.min(Math.max(Number(value || fallback), 1), 100)
}

function sortByDistanceThenCreatedAt(a, b, hasCurrentLocation) {
  if (!hasCurrentLocation) {
    return b.createdAt - a.createdAt
  }

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

function assertItemPayload(payload = {}) {
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

  assertSellerLocationQuality(payload.location)

  if (!normalizeImages(payload.images).length) {
    throw new Error('请至少添加 1 张物品照片')
  }
}

function assertSellerLocationQuality(location = {}) {
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

function assertUploadedImagesTrusted(images = [], user = {}, state = {}) {
  for (const image of images) {
    if (image.status !== 'uploaded') {
      continue
    }

    const upload = findTrustedUploadForImage(image, user, state)

    if (!upload) {
      throw new Error('图片未通过当前账号上传或审核，请重新上传')
    }
  }
}

function findTrustedUploadForImage(image = {}, user = {}, state = {}) {
  const uploads = Array.isArray(state.uploads) ? state.uploads : []

  return uploads.find((upload) =>
    upload?.ownerId === user.id &&
    upload.status === 'uploaded' &&
    doesImageReferenceUpload(image, upload)
  )
}

function doesImageReferenceUpload(image = {}, upload = {}) {
  if (image.id) {
    return upload.id === image.id
  }

  if (image.storageKey) {
    return Boolean(upload.storageKey && upload.storageKey === image.storageKey)
  }

  if (image.checksum) {
    return Boolean(upload.checksum && upload.checksum === image.checksum)
  }

  return Boolean(image.url && upload.url && upload.url === image.url)
}

function assertNoDuplicateActiveItem(sellerId, payload = {}, state) {
  const title = normalizeTextKey(payload.title)
  const duplicate = state.items.find((item) =>
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

function reviewItemContent(payload = {}) {
  if (payload.moderation?.status === 'rejected') {
    return {
      approved: false,
      status: 'rejected',
      reasons: payload.moderation.reasons || ['内容安全审核未通过']
    }
  }

  if (payload.moderation?.status === 'pending_media_review') {
    return {
      approved: true,
      status: 'pending_media_review',
      reasons: payload.moderation.reasons || ['内容安全待复核']
    }
  }

  const content = `${payload.title || ''} ${payload.description || ''}`.toLowerCase()
  const blocked = BLOCKED_CONTENT_WORDS.filter((word) => content.includes(word))

  if (blocked.length) {
    return {
      approved: false,
      status: 'rejected',
      reasons: blocked.map((word) => `命中违禁词:${word}`)
    }
  }

  const images = normalizeImages(payload.images)

  if (images.some((image) => image.status !== 'uploaded')) {
    return {
      approved: true,
      status: 'pending_media_review',
      reasons: ['图片待内容审核']
    }
  }

  return {
    approved: true,
    status: 'approved_auto',
    reasons: []
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

function statusText(status) {
  const map = {
    [TRADE_STATUS.PENDING_SELLER_CONFIRM]: '待卖家确认',
    [TRADE_STATUS.PENDING_MEETUP]: '待约定验货',
    [TRADE_STATUS.COMPLETED]: '已完成',
    [TRADE_STATUS.CANCELLED]: '已取消',
    [TRADE_STATUS.DISPUTED]: '争议中'
  }

  return map[status] || '处理中'
}

function parseBearer(value = '') {
  return value.startsWith('Bearer ') ? value.slice(7) : value
}

function createSessionToken() {
  return `session_${randomBytes(32).toString('base64url')}`
}

function hashSessionToken(token = '') {
  const value = String(token || '')

  if (!value) {
    return ''
  }

  return createHmac('sha256', resolveSessionSecret())
    .update(value)
    .digest('hex')
}

function resolveSessionSecret() {
  const secret = String(process.env.GOODS_COMM_SESSION_SECRET || '').trim()
  const environment = String(process.env.GOODS_COMM_ENV || 'dev').trim().toLowerCase()

  if (secret && !containsPlaceholder(secret)) {
    return secret
  }

  if (PROTECTED_ENVIRONMENTS.includes(environment)) {
    throw new Error('会话密钥配置未完成：GOODS_COMM_SESSION_SECRET')
  }

  return LOCAL_SESSION_SECRET
}

function containsPlaceholder(value = '') {
  return /REPLACE_WITH|placeholder|example\./i.test(String(value || ''))
}

function normalizeTextKey(value = '') {
  return String(value || '').trim().toLowerCase()
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function createTradeContactCode(trade = {}) {
  const randomPart = randomBytes(3).toString('hex').toUpperCase()
  const tradePart = hashText(trade.id || createId('trade')).slice(0, 4).toUpperCase().padEnd(4, '0')

  return `GC-${randomPart}-${tradePart}`
}

function hashText(text) {
  let hash = 2166136261

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return Math.abs(hash >>> 0).toString(36)
}
