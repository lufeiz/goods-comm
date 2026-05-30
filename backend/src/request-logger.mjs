import { normalizeRateLimitPath } from './rate-limiter.mjs'

const PROTECTED_ENVIRONMENTS = new Set(['pre', 'prod'])

export function createRequestLogger(options = {}) {
  const environment = normalizeEnvironment(options.environment || process.env.GOODS_COMM_ENV || 'dev')
  const enabled = normalizeBoolean(
    options.accessLogEnabled ?? process.env.GOODS_COMM_ACCESS_LOG_ENABLED ?? defaultAccessLogEnabled(environment),
    'GOODS_COMM_ACCESS_LOG_ENABLED'
  )
  const sink = typeof options.logSink === 'function'
    ? options.logSink
    : (line) => console.log(line)

  return {
    describe() {
      return {
        enabled,
        format: 'json',
        destination: 'stdout'
      }
    },
    logRequest(event = {}) {
      if (!enabled) {
        return {
          logged: false,
          reason: 'access log disabled'
        }
      }

      const entry = createAccessLogEntry(event, environment)
      try {
        sink(JSON.stringify(entry))
      } catch (error) {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'access_log_failed',
          traceId: entry.traceId,
          message: error?.message || '访问日志写入失败'
        }))
      }

      return {
        logged: true
      }
    }
  }
}

export function normalizeBoolean(value, label = 'boolean setting') {
  if (typeof value === 'boolean') {
    return value
  }

  const normalized = String(value ?? '').trim().toLowerCase()

  if (normalized === 'true') {
    return true
  }

  if (normalized === 'false') {
    return false
  }

  throw new Error(`${label} must be true or false, got ${value}`)
}

function createAccessLogEntry(event = {}, environment = 'dev') {
  const statusCode = Number(event.statusCode || 0)
  const durationMs = Number(event.durationMs || 0)
  const rateLimit = event.rateLimit && typeof event.rateLimit === 'object'
    ? event.rateLimit
    : {}

  return {
    level: statusCode >= 500 ? 'error' : 'info',
    event: 'http_request',
    service: 'goods-comm-backend',
    environment,
    traceId: String(event.traceId || ''),
    method: normalizeMethod(event.method),
    path: sanitizeRequestPath(event.path || event.url || '/'),
    statusCode: Number.isSafeInteger(statusCode) ? statusCode : 0,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : 0,
    corsAllowed: event.corsAllowed !== false,
    rateLimitScope: String(rateLimit.scope || ''),
    rateLimitRemaining: Number.isFinite(Number(rateLimit.remaining)) ? Number(rateLimit.remaining) : null,
    rateLimitLimited: rateLimit.allowed === false
  }
}

function sanitizeRequestPath(value = '/') {
  const text = String(value || '/').trim() || '/'

  try {
    const parsed = new URL(text, 'http://goods-comm.local')
    return normalizeRateLimitPath(parsed.pathname || '/')
  } catch {
    return normalizeRateLimitPath(text.split('?')[0] || '/')
  }
}

function normalizeMethod(value = '') {
  return String(value || 'GET').trim().toUpperCase() || 'GET'
}

function normalizeEnvironment(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  return normalized || 'dev'
}

function defaultAccessLogEnabled(environment = 'dev') {
  return PROTECTED_ENVIRONMENTS.has(environment) ? 'true' : 'false'
}
