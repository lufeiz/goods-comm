import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 300
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000
const DEFAULT_ROUTE_RATE_LIMIT_MAX_REQUESTS = 120
const DEFAULT_ROUTE_RATE_LIMIT_WINDOW_MS = 60 * 1000
const DEFAULT_USER_RATE_LIMIT_MAX_REQUESTS = 80
const DEFAULT_USER_RATE_LIMIT_WINDOW_MS = 60 * 1000

export function createRateLimiter(options = {}) {
  const maxRequests = normalizePositiveInteger(
    options.maxRequests ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    'GOODS_COMM_RATE_LIMIT_MAX_REQUESTS'
  )
  const windowMs = normalizePositiveInteger(
    options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    'GOODS_COMM_RATE_LIMIT_WINDOW_MS'
  )
  const routeMaxRequests = normalizePositiveInteger(
    options.routeMaxRequests ?? DEFAULT_ROUTE_RATE_LIMIT_MAX_REQUESTS,
    'GOODS_COMM_ROUTE_RATE_LIMIT_MAX_REQUESTS'
  )
  const routeWindowMs = normalizePositiveInteger(
    options.routeWindowMs ?? DEFAULT_ROUTE_RATE_LIMIT_WINDOW_MS,
    'GOODS_COMM_ROUTE_RATE_LIMIT_WINDOW_MS'
  )
  const userMaxRequests = normalizePositiveInteger(
    options.userMaxRequests ?? DEFAULT_USER_RATE_LIMIT_MAX_REQUESTS,
    'GOODS_COMM_USER_RATE_LIMIT_MAX_REQUESTS'
  )
  const userWindowMs = normalizePositiveInteger(
    options.userWindowMs ?? DEFAULT_USER_RATE_LIMIT_WINDOW_MS,
    'GOODS_COMM_USER_RATE_LIMIT_WINDOW_MS'
  )
  const trustedProxyRules = parseTrustedProxyRules(options.trustedProxyIps)
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const clients = new Map()
  const routes = new Map()
  const principals = new Map()

  return {
    check(request) {
      if (isRateLimitExemptRequest(request)) {
        return {
          allowed: true,
          scope: 'client',
          maxRequests,
          windowMs,
          remaining: maxRequests,
          resetAt: now()
        }
      }

      const currentTime = now()
      const clientId = getRateLimitClientId(request, trustedProxyRules)
      const clientLimit = checkRateLimitBucket(clients, `client:${clientId}`, {
        scope: 'client',
        maxRequests,
        windowMs,
        currentTime
      })

      if (!clientLimit.allowed) {
        return clientLimit
      }

      const routeId = getRateLimitRouteId(request)
      const routeLimit = checkRateLimitBucket(routes, `route:${clientId}:${routeId}`, {
        scope: 'route',
        maxRequests: routeMaxRequests,
        windowMs: routeWindowMs,
        currentTime
      })

      if (!routeLimit.allowed) {
        return routeLimit
      }

      const principalId = getRateLimitPrincipalId(request)
      let principalLimit = null

      if (principalId && isPrincipalRateLimitedRequest(request)) {
        principalLimit = checkRateLimitBucket(principals, `principal:${routeId}:${principalId}`, {
          scope: 'user',
          maxRequests: userMaxRequests,
          windowMs: userWindowMs,
          currentTime
        })

        if (!principalLimit.allowed) {
          return principalLimit
        }
      }

      cleanupExpiredRateLimitEntries(clients, currentTime)
      cleanupExpiredRateLimitEntries(routes, currentTime)
      cleanupExpiredRateLimitEntries(principals, currentTime)

      return {
        allowed: true,
        scope: principalLimit?.scope || routeLimit.scope || clientLimit.scope,
        clientId,
        routeId,
        principalId,
        maxRequests: Math.min(clientLimit.maxRequests, routeLimit.maxRequests, principalLimit?.maxRequests ?? Number.POSITIVE_INFINITY),
        windowMs: Math.min(clientLimit.windowMs, routeLimit.windowMs, principalLimit?.windowMs ?? Number.POSITIVE_INFINITY),
        remaining: Math.min(clientLimit.remaining, routeLimit.remaining, principalLimit?.remaining ?? Number.POSITIVE_INFINITY),
        resetAt: Math.min(clientLimit.resetAt, routeLimit.resetAt, principalLimit?.resetAt ?? Number.POSITIVE_INFINITY),
        retryAfterMs: Math.max(clientLimit.retryAfterMs, routeLimit.retryAfterMs, principalLimit?.retryAfterMs ?? 0)
      }
    },
    describe() {
      return {
        maxRequests,
        windowMs,
        routeMaxRequests,
        routeWindowMs,
        userMaxRequests,
        userWindowMs,
        trustedProxyCount: trustedProxyRules.length
      }
    }
  }
}

export function rateLimitHeaders(rateLimit = {}) {
  return {
    'retry-after': String(Math.max(Math.ceil((rateLimit.retryAfterMs || 0) / 1000), 1)),
    'x-rate-limit-limit': String(rateLimit.maxRequests || ''),
    'x-rate-limit-remaining': String(rateLimit.remaining || 0),
    'x-rate-limit-reset': String(Math.ceil((rateLimit.resetAt || Date.now()) / 1000))
  }
}

export function getRateLimitRouteId(request = {}) {
  const method = routeMethod(request)
  const pathname = String(request.url || '').split('?')[0] || '/'

  return `${method}:${normalizeRateLimitPath(pathname)}`
}

export function normalizeRateLimitPath(pathname = '/') {
  if (/^\/items\/[^/]+$/.test(pathname)) {
    return '/items/:id'
  }

  if (/^\/trades\/[^/]+\/status$/.test(pathname)) {
    return '/trades/:id/status'
  }

  if (/^\/trades\/[^/]+\/review$/.test(pathname)) {
    return '/trades/:id/review'
  }

  if (/^\/ops\/reports\/[^/]+\/resolve$/.test(pathname)) {
    return '/ops/reports/:id/resolve'
  }

  if (/^\/ops\/users\/[^/]+\/status$/.test(pathname)) {
    return '/ops/users/:id/status'
  }

  if (/^\/moderation\/items\/[^/]+\/review$/.test(pathname)) {
    return '/moderation/items/:id/review'
  }

  if (/^\/moderation\/media\/[^/]+\/review$/.test(pathname)) {
    return '/moderation/media/:id/review'
  }

  return pathname
}

export function getRateLimitPrincipalId(request = {}) {
  const headers = request.headers || {}
  const authorization = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization
  const opsSessionToken = Array.isArray(headers['x-ops-session-token'])
    ? headers['x-ops-session-token'][0]
    : headers['x-ops-session-token']
  const moderationSecret = Array.isArray(headers['x-moderation-secret'])
    ? headers['x-moderation-secret'][0]
    : headers['x-moderation-secret']
  const credential = authorization || opsSessionToken || moderationSecret

  if (!credential) {
    return ''
  }

  return createHash('sha256').update(String(credential)).digest('hex')
}

function checkRateLimitBucket(entries, key, options = {}) {
  const currentTime = options.currentTime ?? Date.now()
  const existing = entries.get(key)
  const entry = existing && existing.resetAt > currentTime
    ? existing
    : {
        count: 0,
        resetAt: currentTime + options.windowMs
      }

  if (entry.count >= options.maxRequests) {
    entries.set(key, entry)
    return {
      allowed: false,
      scope: options.scope,
      maxRequests: options.maxRequests,
      windowMs: options.windowMs,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterMs: Math.max(entry.resetAt - currentTime, 0)
    }
  }

  entry.count += 1
  entries.set(key, entry)

  return {
    allowed: true,
    scope: options.scope,
    maxRequests: options.maxRequests,
    windowMs: options.windowMs,
    remaining: Math.max(options.maxRequests - entry.count, 0),
    resetAt: entry.resetAt,
    retryAfterMs: Math.max(entry.resetAt - currentTime, 0)
  }
}

function cleanupExpiredRateLimitEntries(clients, currentTime) {
  if (clients.size < 1000) {
    return
  }

  for (const [clientId, entry] of clients.entries()) {
    if (!entry || entry.resetAt <= currentTime) {
      clients.delete(clientId)
    }
  }
}

function isRateLimitExemptRequest(request = {}) {
  if (request.method === 'OPTIONS') {
    return true
  }

  const pathname = String(request.url || '').split('?')[0]
  return pathname === '/health' || pathname === '/health/ready'
}

function isPrincipalRateLimitedRequest(request = {}) {
  const method = routeMethod(request)

  return !['GET', 'OPTIONS'].includes(method)
}

function getRateLimitClientId(request = {}, trustedProxyRules = []) {
  const remoteAddress = normalizeIpAddress(request.socket?.remoteAddress || '')

  if (!isTrustedProxyAddress(remoteAddress, trustedProxyRules)) {
    return remoteAddress || 'unknown'
  }

  const forwardedFor = request.headers?.['x-forwarded-for']
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  const forwardedClient = normalizeIpAddress(String(forwardedValue || '').split(',')[0].trim())

  if (forwardedClient) {
    return forwardedClient
  }

  return remoteAddress || 'unknown'
}

function parseTrustedProxyRules(value = '') {
  const normalized = String(value || 'none').trim()

  if (!normalized || normalized.toLowerCase() === 'none') {
    return []
  }

  if (/REPLACE_WITH|placeholder|example\./i.test(normalized)) {
    throw new Error('GOODS_COMM_TRUSTED_PROXY_IPS must be a comma-separated list of IPs/CIDRs or "none"')
  }

  return normalized.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseTrustedProxyRule)
}

function parseTrustedProxyRule(value = '') {
  if (value.includes('/')) {
    const [baseIp, prefixValue] = value.split('/')
    const prefix = Number(prefixValue)
    const base = ipv4ToNumber(baseIp)

    if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error(`GOODS_COMM_TRUSTED_PROXY_IPS contains invalid CIDR: ${value}`)
    }

    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return {
      type: 'ipv4-cidr',
      value,
      base: base & mask,
      mask
    }
  }

  const normalized = normalizeIpAddress(value)

  if (!normalized || isIP(normalized) === 0) {
    throw new Error(`GOODS_COMM_TRUSTED_PROXY_IPS contains invalid IP: ${value}`)
  }

  return {
    type: 'exact',
    value: normalized
  }
}

function isTrustedProxyAddress(address = '', rules = []) {
  if (!address || !rules.length) {
    return false
  }

  const normalized = normalizeIpAddress(address)
  const ipv4 = ipv4ToNumber(normalized)

  return rules.some((rule) => {
    if (rule.type === 'exact') {
      return rule.value === normalized
    }

    if (rule.type === 'ipv4-cidr' && ipv4 !== null) {
      return (ipv4 & rule.mask) === rule.base
    }

    return false
  })
}

function normalizeIpAddress(value = '') {
  const normalized = String(value || '').trim()

  if (!normalized) {
    return ''
  }

  if (normalized.startsWith('::ffff:')) {
    return normalized.slice('::ffff:'.length)
  }

  return normalized
}

function ipv4ToNumber(value = '') {
  const parts = String(value || '').trim().split('.')

  if (parts.length !== 4) {
    return null
  }

  let result = 0

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null
    }

    const octet = Number(part)

    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null
    }

    result = ((result << 8) | octet) >>> 0
  }

  return result
}

function routeMethod(request = {}) {
  if (request.url?.startsWith('/uploads/items') && request.method === 'POST') {
    return 'UPLOAD'
  }

  return request.method || 'GET'
}

function normalizePositiveInteger(value, name) {
  const normalized = Number(value)

  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}`)
  }

  return normalized
}
