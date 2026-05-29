import { createIdempotencyKey, hasRemoteApi, requestApi } from './api.js'
import { requireUserAgreement } from './compliance.js'
import { applyLocalReportToItem, getGoodsItem } from './goods.js'

const REPORTS_KEY = 'goods.reports'

export const REPORT_REASONS = [
  {
    value: 'prohibited',
    label: '违禁物品'
  },
  {
    value: 'fraud',
    label: '疑似诈骗'
  },
  {
    value: 'privacy',
    label: '隐私泄露'
  },
  {
    value: 'other',
    label: '其他问题'
  }
]

export async function submitReport(payload = {}, user) {
  requireUserAgreement('举报前请先阅读并同意用户协议和隐私政策')

  if (!user?.id) {
    throw new Error('请先登录后再举报')
  }

  assertReportPayload(payload)

  if (hasRemoteApi()) {
    return requestApi('/reports', {
      method: 'POST',
      token: user.token,
      idempotencyKey: createIdempotencyKey('report_create', {
        userId: user.id,
        targetType: payload.targetType,
        targetId: payload.targetId,
        reason: payload.reason,
        description: payload.description || ''
      }),
      data: payload
    })
  }

  const duplicate = findLocalDuplicateReport(user.id, payload)

  if (duplicate) {
    return duplicate
  }

  const target = findLocalReportTarget(payload)

  if (target.seller?.id === user.id) {
    throw new Error('不能举报自己发布的物品')
  }

  const report = {
    id: createId('report'),
    reporter: {
      id: user.id,
      nickname: user.nickname || '社区用户'
    },
    targetType: payload.targetType,
    targetId: payload.targetId,
    reason: payload.reason,
    description: payload.description || '',
    status: 'pending_review',
    createdAt: Date.now()
  }

  uni.setStorageSync(REPORTS_KEY, [
    report,
    ...getStorageArray(REPORTS_KEY)
  ])

  if (payload.targetType === 'item') {
    applyLocalReportToItem(payload.targetId, payload.reason, user.id)
  }

  return report
}

function assertReportPayload(payload = {}) {
  if (!payload.targetType || !payload.targetId || !payload.reason) {
    throw new Error('举报信息不完整')
  }

  if (payload.targetType !== 'item') {
    throw new Error('暂不支持该举报对象')
  }

  if (!REPORT_REASONS.some((reason) => reason.value === payload.reason)) {
    throw new Error('举报原因无效')
  }
}

function findLocalReportTarget(payload = {}) {
  const item = getGoodsItem(payload.targetId)

  if (!item) {
    throw new Error('举报对象不存在或已下架')
  }

  return item
}

function findLocalDuplicateReport(userId, payload = {}) {
  return getStorageArray(REPORTS_KEY).find((report) =>
    report.reporter?.id === userId &&
    report.targetType === payload.targetType &&
    report.targetId === payload.targetId &&
    report.reason === payload.reason &&
    report.status === 'pending_review'
  ) || null
}

function getStorageArray(key) {
  const value = uni.getStorageSync(key)
  return Array.isArray(value) ? value : []
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
