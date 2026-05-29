export const APP_NAME = '邻里旧货'

export const APP_ENV = normalizeAppEnv(import.meta.env?.VITE_APP_ENV || 'dev')

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env?.VITE_API_BASE_URL || '')

export const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const LOCATION_TYPE = 'gcj02'

export const LOCATION_PERMISSION_DESC = '需要获取当前位置，用于判断是否满足同社区或同街道交易要求。'

export const LOCATION_CACHE_TTL_MS = 5 * 60 * 1000

export const MAX_LOCATION_ACCURACY_METERS = 200

export const USER_AGREEMENT_VERSION = '2026-05-28'

export const USER_AGREEMENT_LABEL = '用户协议和隐私政策'

export const DEFAULT_TRADE_SCOPES = {
  community: {
    type: 'community',
    label: '同社区',
    radiusMeters: 1200
  },
  street: {
    type: 'street',
    label: '同街道',
    radiusMeters: 4000
  }
}

export const DEMO_CENTER = {
  latitude: 31.22945,
  longitude: 121.45494
}

function normalizeApiBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function normalizeAppEnv(value) {
  const normalized = String(value || '').trim().toLowerCase()

  if (['dev', 'test', 'pre', 'prod'].includes(normalized)) {
    return normalized
  }

  return 'dev'
}
