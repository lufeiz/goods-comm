import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  createRateLimiter,
  getRateLimitPrincipalId,
  getRateLimitRouteId,
  normalizeRateLimitPath,
  rateLimitHeaders
} from '../backend/src/rate-limiter.mjs'

let now = 1_780_000_000_000

assert.equal(normalizeRateLimitPath('/items/item_123'), '/items/:id')
assert.equal(normalizeRateLimitPath('/trades/trade_123/status'), '/trades/:id/status')
assert.equal(normalizeRateLimitPath('/trades/trade_123/review'), '/trades/:id/review')
assert.equal(normalizeRateLimitPath('/ops/reports/report_123/resolve'), '/ops/reports/:id/resolve')
assert.equal(normalizeRateLimitPath('/ops/users/user_123/status'), '/ops/users/:id/status')
assert.equal(normalizeRateLimitPath('/moderation/items/item_123/review'), '/moderation/items/:id/review')
assert.equal(normalizeRateLimitPath('/moderation/media/trace_123/review'), '/moderation/media/:id/review')
assert.equal(normalizeRateLimitPath('/items'), '/items')

assert.equal(getRateLimitRouteId(request({
  method: 'POST',
  url: '/uploads/items',
  contentType: 'multipart/form-data'
})), 'UPLOAD:/uploads/items')

const principalRequest = request({
  method: 'POST',
  url: '/items',
  authorization: 'Bearer smoke-user-token'
})
assert.equal(
  getRateLimitPrincipalId(principalRequest),
  createHash('sha256').update('Bearer smoke-user-token').digest('hex')
)

const routeLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
  routeMaxRequests: 1,
  routeWindowMs: 60_000,
  userMaxRequests: 10,
  userWindowMs: 60_000,
  trustedProxyIps: '127.0.0.1,10.0.0.0/8',
  now: () => now
})

assert.equal(routeLimiter.describe().trustedProxyCount, 2)
assert.equal(routeLimiter.describe().routeMaxRequests, 1)

assert.equal(routeLimiter.check(request({
  method: 'GET',
  url: '/health',
  remoteAddress: '127.0.0.1'
})).allowed, true)

const firstRouteHit = routeLimiter.check(request({
  method: 'GET',
  url: '/items/item_a',
  remoteAddress: '10.1.2.3',
  forwardedFor: '203.0.113.10'
}))
assert.equal(firstRouteHit.allowed, true)
assert.equal(firstRouteHit.clientId, '203.0.113.10')
assert.equal(firstRouteHit.routeId, 'GET:/items/:id')

const limitedRoute = routeLimiter.check(request({
  method: 'GET',
  url: '/items/item_b',
  remoteAddress: '10.1.2.3',
  forwardedFor: '203.0.113.10'
}))
assert.equal(limitedRoute.allowed, false)
assert.equal(limitedRoute.scope, 'route')
assert.equal(limitedRoute.maxRequests, 1)

const differentClientSameRoute = routeLimiter.check(request({
  method: 'GET',
  url: '/items/item_c',
  remoteAddress: '10.1.2.3',
  forwardedFor: '203.0.113.11'
}))
assert.equal(differentClientSameRoute.allowed, true)

now += 60_001
const routeWindowReset = routeLimiter.check(request({
  method: 'GET',
  url: '/items/item_d',
  remoteAddress: '10.1.2.3',
  forwardedFor: '203.0.113.10'
}))
assert.equal(routeWindowReset.allowed, true)

const untrustedProxyLimiter = createRateLimiter({
  maxRequests: 1,
  windowMs: 60_000,
  routeMaxRequests: 10,
  routeWindowMs: 60_000,
  userMaxRequests: 10,
  userWindowMs: 60_000,
  trustedProxyIps: 'none',
  now: () => now
})
assert.equal(untrustedProxyLimiter.check(request({
  method: 'GET',
  url: '/items',
  remoteAddress: '127.0.0.1',
  forwardedFor: '203.0.113.20'
})).allowed, true)
const untrustedProxyLimited = untrustedProxyLimiter.check(request({
  method: 'GET',
  url: '/trades',
  remoteAddress: '127.0.0.1',
  forwardedFor: '203.0.113.21'
}))
assert.equal(untrustedProxyLimited.allowed, false)
assert.equal(untrustedProxyLimited.scope, 'client')

const userLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
  routeMaxRequests: 10,
  routeWindowMs: 60_000,
  userMaxRequests: 1,
  userWindowMs: 60_000,
  trustedProxyIps: '127.0.0.1',
  now: () => now
})
const firstUserWrite = userLimiter.check(request({
  method: 'POST',
  url: '/items',
  remoteAddress: '127.0.0.1',
  forwardedFor: '203.0.113.30',
  authorization: 'Bearer smoke-user-token'
}))
assert.equal(firstUserWrite.allowed, true)
assert.equal(firstUserWrite.scope, 'user')
assert.equal(firstUserWrite.principalId, getRateLimitPrincipalId(principalRequest))

const limitedUserWrite = userLimiter.check(request({
  method: 'POST',
  url: '/items',
  remoteAddress: '127.0.0.1',
  forwardedFor: '203.0.113.31',
  authorization: 'Bearer smoke-user-token'
}))
assert.equal(limitedUserWrite.allowed, false)
assert.equal(limitedUserWrite.scope, 'user')
assert.equal(limitedUserWrite.maxRequests, 1)

assert.equal(userLimiter.check(request({
  method: 'GET',
  url: '/items',
  remoteAddress: '127.0.0.1',
  forwardedFor: '203.0.113.32',
  authorization: 'Bearer smoke-user-token'
})).allowed, true)

const headers = rateLimitHeaders({
  maxRequests: 1,
  remaining: 0,
  resetAt: now + 30_000,
  retryAfterMs: 1500
})
assert.equal(headers['retry-after'], '2')
assert.equal(headers['x-rate-limit-limit'], '1')
assert.equal(headers['x-rate-limit-remaining'], '0')
assert.equal(headers['x-rate-limit-reset'], String(Math.ceil((now + 30_000) / 1000)))

assert.throws(
  () => createRateLimiter({ trustedProxyIps: 'REPLACE_WITH_PRE_TRUSTED_PROXY_IPS' }),
  /GOODS_COMM_TRUSTED_PROXY_IPS must be a comma-separated list/
)
assert.throws(
  () => createRateLimiter({ routeMaxRequests: 0 }),
  /GOODS_COMM_ROUTE_RATE_LIMIT_MAX_REQUESTS must be a positive integer/
)

console.log('Rate limiter smoke checks passed')

function request(options = {}) {
  return {
    method: options.method || 'GET',
    url: options.url || '/',
    headers: {
      ...(options.contentType ? { 'content-type': options.contentType } : {}),
      ...(options.forwardedFor ? { 'x-forwarded-for': options.forwardedFor } : {}),
      ...(options.authorization ? { authorization: options.authorization } : {}),
      ...(options.opsSessionToken ? { 'x-ops-session-token': options.opsSessionToken } : {}),
      ...(options.moderationSecret ? { 'x-moderation-secret': options.moderationSecret } : {})
    },
    socket: {
      remoteAddress: options.remoteAddress || '127.0.0.1'
    }
  }
}
