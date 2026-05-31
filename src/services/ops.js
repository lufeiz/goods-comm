import { createIdempotencyKey, hasRemoteApi, requestApi } from './api.js'

const OPS_SECRET_KEY = 'goods.opsSecret'
const OPS_SESSION_KEY = 'goods.opsSession'

export const OPS_REPORT_RESOLUTIONS = [
  {
    value: 'dismiss_report',
    label: '驳回举报'
  },
  {
    value: 'uphold_report',
    label: '确认违规'
  }
]

export const OPS_DISPUTE_RESOLUTIONS = [
  {
    value: 'release_item',
    label: '释放商品'
  },
  {
    value: 'complete_trade',
    label: '确认完成'
  },
  {
    value: 'remove_item',
    label: '下架商品'
  }
]

export const OPS_ITEM_REVIEW_STATUSES = [
  {
    value: 'approved',
    label: '通过'
  },
  {
    value: 'rejected',
    label: '拒绝'
  }
]

export function getStoredOpsSecret() {
  return typeof uni === 'undefined' ? '' : uni.getStorageSync(OPS_SECRET_KEY) || ''
}

export function setStoredOpsSecret(secret = '') {
  const normalized = normalizeSecret(secret)

  if (typeof uni !== 'undefined') {
    if (normalized) {
      uni.setStorageSync(OPS_SECRET_KEY, normalized)
    } else {
      uni.removeStorageSync(OPS_SECRET_KEY)
    }
  }

  return normalized
}

export function clearStoredOpsSecret() {
  if (typeof uni !== 'undefined') {
    uni.removeStorageSync(OPS_SECRET_KEY)
  }
}

export function getStoredOpsSession() {
  if (typeof uni === 'undefined') {
    return null
  }

  const session = uni.getStorageSync(OPS_SESSION_KEY)

  return isOpsSessionUsable(session) ? session : null
}

export function clearStoredOpsSession() {
  if (typeof uni !== 'undefined') {
    uni.removeStorageSync(OPS_SESSION_KEY)
  }
}

export async function loginOpsSession(payload = {}) {
  assertRemoteApi()
  const password = normalizeSecret(payload.password || payload.secret)

  if (!password) {
    throw new Error('请输入运营密码或密钥')
  }

  const session = await requestApi('/ops/login', {
    method: 'POST',
    data: {
      accountId: String(payload.accountId || payload.actorId || 'ops-console').trim(),
      password
    }
  })
  const normalized = normalizeOpsSession(session)

  if (typeof uni !== 'undefined') {
    uni.setStorageSync(OPS_SESSION_KEY, normalized)
  }

  return normalized
}

export async function fetchOpsModerationQueue(secret, filters = {}) {
  return requestOps('/ops/moderation-queue', {
    method: 'GET',
    secret,
    data: normalizeLimitFilter(filters)
  })
}

export async function fetchOpsReports(secret, filters = {}) {
  return requestOps('/ops/reports', {
    method: 'GET',
    secret,
    data: normalizeReportFilters(filters)
  })
}

export async function fetchOpsUsers(secret, filters = {}) {
  return requestOps('/ops/users', {
    method: 'GET',
    secret,
    data: normalizeUserFilters(filters)
  })
}

export async function updateOpsUserStatus(userId, payload = {}, secret) {
  const data = normalizeUserStatusPayload(payload)

  return requestOps(`/ops/users/${encodeURIComponent(userId)}/status`, {
    method: 'POST',
    secret,
    idempotencyKey: createIdempotencyKey('ops_user_status', {
      userId,
      payload: data
    }),
    data
  })
}

export async function resolveOpsReport(reportId, payload = {}, secret) {
  const data = normalizeReportResolutionPayload(payload)

  return requestOps(`/ops/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: 'POST',
    secret,
    idempotencyKey: createIdempotencyKey('ops_report_resolve', {
      reportId,
      payload: data
    }),
    data
  })
}

export async function reviewOpsItem(itemId, payload = {}, secret) {
  const data = normalizeItemReviewPayload(payload)

  return requestOps(`/moderation/items/${encodeURIComponent(itemId)}/review`, {
    method: 'POST',
    secret,
    idempotencyKey: createIdempotencyKey('ops_item_review', {
      itemId,
      payload: data
    }),
    data
  })
}

export async function resolveOpsDispute(disputeId, payload = {}, secret) {
  const data = normalizeDisputeResolutionPayload(payload)

  return requestOps(`/moderation/disputes/${encodeURIComponent(disputeId)}/resolve`, {
    method: 'POST',
    secret,
    idempotencyKey: createIdempotencyKey('ops_dispute_resolve', {
      disputeId,
      payload: data
    }),
    data
  })
}

export async function fetchNotificationDeliveries(secret, filters = {}) {
  return requestOps('/ops/notification-deliveries', {
    method: 'GET',
    secret,
    data: normalizeNotificationDeliveryFilters(filters)
  })
}

export async function fetchClientEvents(secret, filters = {}) {
  return requestOps('/ops/client-events', {
    method: 'GET',
    secret,
    data: normalizeClientEventFilters(filters)
  })
}

export async function fetchLocationRiskEvents(secret, filters = {}) {
  return requestOps('/ops/location-risk-events', {
    method: 'GET',
    secret,
    data: normalizeLocationRiskFilters(filters)
  })
}

export async function fetchOpsAuditEvents(secret, filters = {}) {
  return requestOps('/ops/audit-events', {
    method: 'GET',
    secret,
    data: normalizeOpsAuditFilters(filters)
  })
}

export async function retryNotificationDeliveries(secret, payload = {}) {
  const data = {
    ids: Array.isArray(payload.ids) ? payload.ids.filter(Boolean) : [],
    force: Boolean(payload.force),
    limit: normalizeLimit(payload.limit, 20)
  }

  return requestOps('/ops/notification-deliveries/retry', {
    method: 'POST',
    secret,
    data
  })
}

function requestOps(path, options = {}) {
  assertRemoteApi()
  const secret = normalizeSecret(options.secret)
  const session = getStoredOpsSession()

  if (!secret && !session?.token) {
    throw new Error('请先登录运营控制台')
  }

  return requestApi(path, {
    ...options,
    header: {
      ...options.header,
      ...(secret ? { 'x-moderation-secret': secret } : {}),
      ...(session?.token ? { 'x-ops-session-token': session.token } : {}),
      ...(session?.operator?.id ? { 'x-ops-actor-id': session.operator.id } : {})
    }
  })
}

function assertRemoteApi() {
  if (!hasRemoteApi()) {
    throw new Error('运营控制台需要连接后端 API')
  }
}

function normalizeSecret(secret = '') {
  return String(secret || '').trim()
}

function normalizeOpsSession(session = {}) {
  return {
    token: String(session.token || '').trim(),
    expiresAt: Number(session.expiresAt || 0),
    operator: {
      id: String(session.operator?.id || 'ops-console').trim(),
      roles: Array.isArray(session.operator?.roles) ? session.operator.roles : [],
      source: String(session.operator?.source || '').trim()
    }
  }
}

function isOpsSessionUsable(session, now = Date.now()) {
  return Boolean(session?.token && Number(session.expiresAt) > now)
}

function normalizeLimitFilter(filters = {}) {
  return {
    limit: normalizeLimit(filters.limit, 50)
  }
}

function normalizeReportFilters(filters = {}) {
  return {
    status: String(filters.status || '').trim(),
    targetId: String(filters.targetId || '').trim(),
    reporterId: String(filters.reporterId || '').trim(),
    limit: normalizeLimit(filters.limit, 50)
  }
}

function normalizeUserFilters(filters = {}) {
  return {
    status: String(filters.status || '').trim(),
    query: String(filters.query || filters.keyword || '').trim(),
    limit: normalizeLimit(filters.limit, 50)
  }
}

function normalizeUserStatusPayload(payload = {}) {
  const status = String(payload.status || '').trim()

  if (!['active', 'blocked'].includes(status)) {
    throw new Error('用户状态只能调整为 active 或 blocked')
  }

  return {
    status,
    actorId: String(payload.actorId || 'ops-console').trim(),
    reason: String(payload.reason || payload.note || '').trim().slice(0, 500)
  }
}

function normalizeNotificationDeliveryFilters(filters = {}) {
  return {
    status: String(filters.status || '').trim(),
    notificationId: String(filters.notificationId || '').trim(),
    userId: String(filters.userId || '').trim(),
    limit: normalizeLimit(filters.limit, 50)
  }
}

function normalizeClientEventFilters(filters = {}) {
  return {
    type: String(filters.type || '').trim(),
    level: String(filters.level || '').trim(),
    userId: String(filters.userId || '').trim(),
    limit: normalizeLimit(filters.limit, 100)
  }
}

function normalizeLocationRiskFilters(filters = {}) {
  return {
    riskLevel: String(filters.riskLevel || filters.level || '').trim(),
    riskCode: String(filters.riskCode || filters.code || '').trim(),
    userId: String(filters.userId || '').trim(),
    action: String(filters.action || '').trim(),
    limit: normalizeLimit(filters.limit, 100)
  }
}

function normalizeOpsAuditFilters(filters = {}) {
  return {
    actorId: String(filters.actorId || '').trim(),
    action: String(filters.action || '').trim(),
    targetType: String(filters.targetType || '').trim(),
    targetId: String(filters.targetId || '').trim(),
    limit: normalizeLimit(filters.limit, 100)
  }
}

function normalizeReportResolutionPayload(payload = {}) {
  const resolution = String(payload.resolution || payload.decision || '').trim()

  if (!OPS_REPORT_RESOLUTIONS.some((item) => item.value === resolution)) {
    throw new Error('举报处理结论无效')
  }

  return {
    resolution,
    note: String(payload.note || payload.resolutionNote || '').trim().slice(0, 500),
    actorId: String(payload.actorId || 'ops-console').trim(),
    reasons: normalizeReasons(payload.reasons)
  }
}

function normalizeItemReviewPayload(payload = {}) {
  const status = String(payload.status || payload.reviewStatus || '').trim()

  if (!OPS_ITEM_REVIEW_STATUSES.some((item) => item.value === status)) {
    throw new Error('商品审核结论无效')
  }

  return {
    status,
    actorId: String(payload.actorId || 'ops-console').trim(),
    reasons: normalizeReasons(payload.reasons),
    note: String(payload.note || '').trim().slice(0, 500)
  }
}

function normalizeDisputeResolutionPayload(payload = {}) {
  const resolution = String(payload.resolution || '').trim()

  if (!OPS_DISPUTE_RESOLUTIONS.some((item) => item.value === resolution)) {
    throw new Error('争议处理结论无效')
  }

  return {
    resolution,
    note: String(payload.note || payload.resolutionNote || '').trim().slice(0, 500),
    actorId: String(payload.actorId || 'ops-console').trim()
  }
}

function normalizeReasons(reasons = []) {
  return Array.isArray(reasons)
    ? reasons.map((reason) => String(reason || '').trim()).filter(Boolean).slice(0, 8)
    : []
}

function normalizeLimit(value, fallback) {
  const limit = Number(value || fallback)

  if (!Number.isFinite(limit)) {
    return fallback
  }

  return Math.max(1, Math.min(100, Math.floor(limit)))
}
