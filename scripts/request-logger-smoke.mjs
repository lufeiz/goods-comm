import assert from 'node:assert/strict'
import { createRequestLogger } from '../backend/src/request-logger.mjs'

const disabledLines = []
const disabledLogger = createRequestLogger({
  environment: 'test',
  accessLogEnabled: false,
  logSink: (line) => disabledLines.push(line)
})
const disabledResult = disabledLogger.logRequest({
  method: 'GET',
  path: '/items?authorization=must-not-log',
  statusCode: 200,
  durationMs: 12,
  traceId: 'trace_access_log_disabled'
})
assert.equal(disabledLogger.describe().enabled, false)
assert.equal(disabledResult.logged, false)
assert.equal(disabledLines.length, 0)

assert.throws(() => createRequestLogger({
  accessLogEnabled: 'sometimes'
}), /GOODS_COMM_ACCESS_LOG_ENABLED must be true or false/)

const lines = []
const enabledLogger = createRequestLogger({
  environment: 'prod',
  accessLogEnabled: true,
  logSink: (line) => lines.push(line)
})
const loggedResult = enabledLogger.logRequest({
  method: 'post',
  path: '/trades/trade_secret/status?authorization=Bearer%20token&phone=13800138000',
  statusCode: 429,
  durationMs: 15.7,
  traceId: 'trace_access_log_smoke',
  corsAllowed: true,
  rateLimit: {
    allowed: false,
    scope: 'user',
    remaining: 0
  }
})
assert.equal(enabledLogger.describe().enabled, true)
assert.equal(enabledLogger.describe().format, 'json')
assert.equal(loggedResult.logged, true)
assert.equal(lines.length, 1)

const entry = JSON.parse(lines[0])
assert.equal(entry.level, 'info')
assert.equal(entry.event, 'http_request')
assert.equal(entry.service, 'goods-comm-backend')
assert.equal(entry.environment, 'prod')
assert.equal(entry.traceId, 'trace_access_log_smoke')
assert.equal(entry.method, 'POST')
assert.equal(entry.path, '/trades/:id/status')
assert.equal(entry.statusCode, 429)
assert.equal(entry.durationMs, 16)
assert.equal(entry.corsAllowed, true)
assert.equal(entry.rateLimitScope, 'user')
assert.equal(entry.rateLimitRemaining, 0)
assert.equal(entry.rateLimitLimited, true)
assert.equal(lines[0].includes('trade_secret'), false)
assert.equal(lines[0].includes('Bearer'), false)
assert.equal(lines[0].includes('13800138000'), false)
assert.equal(lines[0].includes('authorization'), false)

const errorLines = []
createRequestLogger({
  environment: 'pre',
  accessLogEnabled: true,
  logSink: (line) => errorLines.push(line)
}).logRequest({
  method: 'GET',
  path: '/health/ready',
  statusCode: 503,
  durationMs: 2,
  traceId: 'trace_access_log_error'
})
const errorEntry = JSON.parse(errorLines[0])
assert.equal(errorEntry.level, 'error')
assert.equal(errorEntry.path, '/health/ready')

console.log('Request logger smoke checks passed')
