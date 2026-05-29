import { APP_ENV } from '../config/app.js'
import { hasRemoteApi, requestApi } from './api.js'
import { getPlatformName } from './platform.js'

const LOCAL_EVENTS_KEY = 'goods.clientEvents'
const MAX_LOCAL_EVENTS = 100

export function trackClientEvent(type, payload = {}) {
  const event = normalizeClientEvent(type, payload)
  saveLocalEvent(event)

  if (!hasRemoteApi()) {
    return Promise.resolve({
      accepted: 0,
      local: true
    })
  }

  return requestApi('/telemetry/client-events', {
    method: 'POST',
    token: payload.user?.token || payload.token || '',
    data: event
  }).catch(() => ({
    accepted: 0,
    local: true
  }))
}

export function getLocalClientEvents() {
  if (typeof uni === 'undefined') {
    return []
  }

  const value = uni.getStorageSync(LOCAL_EVENTS_KEY)
  return Array.isArray(value) ? value : []
}

export function clearLocalClientEvents() {
  if (typeof uni !== 'undefined') {
    uni.removeStorageSync(LOCAL_EVENTS_KEY)
  }
}

function normalizeClientEvent(type, payload = {}) {
  const error = payload.error || null

  return {
    type: String(type || payload.type || 'client_event').trim(),
    level: normalizeLevel(payload.level || (error ? 'error' : 'info')),
    code: String(payload.code || error.code || '').trim(),
    message: String(payload.message || error.message || error.errMsg || '').trim().slice(0, 500),
    route: String(payload.route || currentRoute()).trim(),
    userId: payload.user?.id || payload.userId || '',
    platform: payload.platform || getPlatformName(),
    appEnv: payload.appEnv || APP_ENV,
    context: sanitizeContext(payload.context || {}),
    createdAt: Date.now()
  }
}

function saveLocalEvent(event) {
  if (typeof uni === 'undefined') {
    return
  }

  const events = getLocalClientEvents()
  uni.setStorageSync(LOCAL_EVENTS_KEY, [
    event,
    ...events
  ].slice(0, MAX_LOCAL_EVENTS))
}

function normalizeLevel(level = '') {
  const normalized = String(level || '').trim().toLowerCase()
  return ['debug', 'info', 'warn', 'error'].includes(normalized) ? normalized : 'info'
}

function currentRoute() {
  if (typeof getCurrentPages !== 'function') {
    return ''
  }

  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  return current?.route || current?.$page?.fullPath || ''
}

function sanitizeContext(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return {}
  }

  const blockedKeys = /token|secret|password|authorization|contact|phone|mobile|openid|unionid|avatar|address|latitude|longitude/i
  const output = {}

  for (const [key, value] of Object.entries(context).slice(0, 24)) {
    if (blockedKeys.test(key)) {
      continue
    }

    output[key] = sanitizeValue(value)
  }

  return output
}

function sanitizeValue(value) {
  if (value === null || value === undefined) {
    return value
  }

  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return String(value).slice(0, 200)
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map(sanitizeValue)
  }

  if (typeof value === 'object') {
    return sanitizeContext(value)
  }

  return ''
}
