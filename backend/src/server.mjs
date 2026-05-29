import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { isIP } from 'node:net'
import { handleBffRequest } from '../../src/bff/handler.js'
import { normalizeBffHttpError } from '../../src/bff/http-error.js'
import { createRuntimeStateStore } from './state-store.mjs'
import { createPlatformAuthResolver } from './platform-auth.mjs'
import { createRuntimeObjectStore } from './object-store.mjs'
import { createContentSafetyClient } from './content-safety.mjs'
import { createRegionResolver } from './region-resolver.mjs'
import { createPlatformNotifier } from './platform-notifier.mjs'
import { createOpsAuth } from './ops-auth.mjs'

const DEFAULT_PORT = 8787
const DEFAULT_CORS_METHODS = 'GET,POST,PATCH,OPTIONS'
const DEFAULT_CORS_HEADERS = 'content-type,authorization,x-trace-id,idempotency-key,x-idempotency-key,x-moderation-secret,x-ops-session-token,x-ops-actor-id'
const DEFAULT_MAX_REQUEST_BYTES = 6 * 1024 * 1024
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 300
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000
const PROTECTED_ENVIRONMENTS = ['pre', 'prod']

export function createGoodsCommServer(options = {}) {
  const deploymentEnv = normalizeDeploymentEnv(options.environment || process.env.GOODS_COMM_ENV || 'dev')
  const stateStore = createRuntimeStateStore({
    ...options,
    environment: deploymentEnv
  })
  const store = stateStore.store
  const runtimeObjectStore = createRuntimeObjectStore({
    ...options,
    environment: deploymentEnv
  })
  const objectStore = runtimeObjectStore.store
  const maxRequestBytes = normalizeMaxRequestBytes(options.maxRequestBytes ?? process.env.GOODS_COMM_MAX_REQUEST_BYTES)
  const rateLimiter = createRateLimiter({
    maxRequests: options.rateLimitMaxRequests ?? process.env.GOODS_COMM_RATE_LIMIT_MAX_REQUESTS,
    windowMs: options.rateLimitWindowMs ?? process.env.GOODS_COMM_RATE_LIMIT_WINDOW_MS,
    trustedProxyIps: options.trustedProxyIps ?? process.env.GOODS_COMM_TRUSTED_PROXY_IPS,
    now: options.now
  })
  const corsPolicy = createCorsPolicy(options.allowedOrigins ?? process.env.GOODS_COMM_ALLOWED_ORIGINS, {
    environment: deploymentEnv,
    allowUnsafeWildcard: options.allowUnsafeCorsWildcard ||
      process.env.GOODS_COMM_ALLOW_WILDCARD_CORS_IN_PROTECTED_ENV === 'true'
  })
  const platformAuth = options.platformAuth || createPlatformAuthResolver({
    ...options,
    environment: deploymentEnv
  })
  const contentSafety = options.contentSafety || createContentSafetyClient({
    ...options,
    environment: deploymentEnv
  })
  const regionResolver = options.regionResolver || createRegionResolver({
    ...options,
    environment: deploymentEnv
  })
  const platformNotifier = options.platformNotifier || createPlatformNotifier({
    ...options,
    environment: deploymentEnv
  })
  const opsAuth = options.opsAuth || createOpsAuth({
    ...options,
    environment: deploymentEnv
  })

  return createServer(async (request, response) => {
    const startedAt = Date.now()
    const traceId = getTraceId(request)
    const corsContext = createCorsContext(request, corsPolicy)
    corsContext.securityHeaders = securityHeaders(deploymentEnv)

    if (!corsContext.allowed) {
      sendResponse(response, 403, {
        code: 'FORBIDDEN',
        message: 'CORS 来源不允许',
        trace: {
          traceId,
          durationMs: Date.now() - startedAt
        }
      }, traceId, corsContext)
      return
    }

    if (request.method === 'OPTIONS') {
      sendResponse(response, 204, null, traceId, corsContext)
      return
    }

    const rateLimit = rateLimiter.check(request)

    if (!rateLimit.allowed) {
      sendResponse(response, 429, {
        code: 'TOO_MANY_REQUESTS',
        message: '请求过于频繁，请稍后再试',
        trace: {
          traceId,
          durationMs: Date.now() - startedAt
        }
      }, traceId, corsContext, rateLimitHeaders(rateLimit))
      return
    }

    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)

      if (url.pathname.startsWith('/assets/')) {
        const asset = await objectStore.readAsset(url.pathname)
        sendBinaryResponse(response, 200, asset.bytes, asset.mimeType, traceId, corsContext)
        return
      }

      if (url.pathname === '/health') {
        sendResponse(response, 200, {
          data: {
            ok: true,
            service: 'goods-comm-backend',
            environment: deploymentEnv,
            stateStore: stateStore.type,
            objectStore: runtimeObjectStore.type,
            contentSafety: contentSafety.provider,
            mapProvider: regionResolver.provider,
            platformNotify: platformNotifier.provider,
            rateLimit: rateLimiter.describe(),
            uptimeSeconds: Math.round(process.uptime())
          },
          trace: {
            traceId,
            durationMs: Date.now() - startedAt
          }
        }, traceId, corsContext)
        return
      }

      if (url.pathname === '/health/ready') {
        try {
          const readiness = typeof store.check === 'function'
            ? await store.check()
            : { ok: true, type: stateStore.type }
          const platformNotifyReadiness = typeof platformNotifier.check === 'function'
            ? await platformNotifier.check()
            : { ok: true, provider: platformNotifier.provider }

          sendResponse(response, 200, {
            data: {
              ok: true,
              service: 'goods-comm-backend',
              environment: deploymentEnv,
              stateStore: stateStore.type,
              objectStore: runtimeObjectStore.type,
              contentSafety: contentSafety.provider,
              mapProvider: regionResolver.provider,
              platformNotify: platformNotifier.provider,
              rateLimit: rateLimiter.describe(),
              readiness,
              platformNotifyReadiness
            },
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
        } catch (error) {
          sendResponse(response, 503, {
            code: 'SERVICE_UNAVAILABLE',
            message: `后端依赖未就绪：${error?.message || '状态存储不可用'}`,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
        }

        return
      }

      const method = routeMethod(request)

      if (url.pathname.startsWith('/ops/')) {
        if (url.pathname === '/ops/notification-deliveries' && method === 'GET') {
          authenticateOpsRequest(opsAuth, request, url, ['notifications', 'support'])
          const result = await store.transact(async (state) => ({
            deliveries: listPlatformNotificationDeliveries(url.searchParams, state)
          }))
          sendResponse(response, 200, {
            data: result,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
          return
        }

        if (url.pathname === '/ops/notification-deliveries/retry' && ['POST', 'PATCH'].includes(method)) {
          const opsActor = authenticateOpsRequest(opsAuth, request, url, ['notifications', 'support'])
          const retryData = await parseRequestData(request, url, objectStore, contentSafety, maxRequestBytes)
          const result = await retryPlatformNotificationDeliveries(store, platformNotifier, retryData, {
            traceId,
            environment: deploymentEnv
          })
          await appendOpsAuditEventToStore(store, createOpsAuditEventData(opsActor, {
            action: 'ops.notification.retry',
            targetType: 'notification_delivery',
            targetId: normalizeIdList(retryData.ids || retryData.id || retryData.deliveryIds).join(',') || 'due',
            message: `retried ${result.retried || 0} notification deliveries`,
            context: {
              retried: result.retried || 0,
              force: retryData.force === true || retryData.force === 'true',
              limit: Number(retryData.limit || 20)
            }
          }), {
            traceId,
            environment: deploymentEnv
          })
          sendResponse(response, 200, {
            data: result,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
          return
        }

        if (url.pathname === '/ops/moderation-queue' && method === 'GET') {
          authenticateOpsRequest(opsAuth, request, url, ['moderation', 'support'])
          const result = await runBffTransactionWithNotifications(store, platformNotifier, url.pathname, {
            method,
            data: Object.fromEntries(url.searchParams.entries()),
            header: {
              'Idempotency-Key': request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || ''
            }
          }, {
            traceId,
            environment: deploymentEnv
          })
          sendResponse(response, 200, {
            data: result,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
          return
        }

        if (url.pathname === '/ops/client-events' && method === 'GET') {
          authenticateOpsRequest(opsAuth, request, url, ['telemetry', 'support'])
          const result = await runBffTransactionWithNotifications(store, platformNotifier, url.pathname, {
            method,
            data: Object.fromEntries(url.searchParams.entries()),
            header: {
              'Idempotency-Key': request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || ''
            }
          }, {
            traceId,
            environment: deploymentEnv
          })
          sendResponse(response, 200, {
            data: result,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
          return
        }

        if (url.pathname === '/ops/audit-events' && method === 'GET') {
          authenticateOpsRequest(opsAuth, request, url, ['telemetry', 'support'])
          const result = await runBffTransactionWithNotifications(store, platformNotifier, url.pathname, {
            method,
            data: Object.fromEntries(url.searchParams.entries()),
            header: {
              'Idempotency-Key': request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || ''
            }
          }, {
            traceId,
            environment: deploymentEnv
          })
          sendResponse(response, 200, {
            data: result,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
          return
        }

        if (url.pathname === '/ops/reports' && method === 'GET') {
          authenticateOpsRequest(opsAuth, request, url, ['moderation', 'support'])
          const result = await runBffTransactionWithNotifications(store, platformNotifier, url.pathname, {
            method,
            data: Object.fromEntries(url.searchParams.entries()),
            header: {
              'Idempotency-Key': request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || ''
            }
          }, {
            traceId,
            environment: deploymentEnv
          })
          sendResponse(response, 200, {
            data: result,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
          return
        }

        if (url.pathname === '/ops/users' && method === 'GET') {
          authenticateOpsRequest(opsAuth, request, url, ['risk', 'support'])
          const result = await runBffTransactionWithNotifications(store, platformNotifier, url.pathname, {
            method,
            data: Object.fromEntries(url.searchParams.entries()),
            header: {
              'Idempotency-Key': request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || ''
            }
          }, {
            traceId,
            environment: deploymentEnv
          })
          sendResponse(response, 200, {
            data: result,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
          return
        }

        const opsReportResolveMatch = url.pathname.match(/^\/ops\/reports\/([^/]+)\/resolve$/)
        if (opsReportResolveMatch && ['POST', 'PATCH'].includes(method)) {
          const opsActor = authenticateOpsRequest(opsAuth, request, url, ['moderation', 'support'])
          const reportData = await parseRequestData(request, url, objectStore, contentSafety, maxRequestBytes)
          const result = await runBffTransactionWithNotifications(store, platformNotifier, url.pathname, {
            method,
            data: injectOpsActor(reportData, opsActor),
            opsAudit: createOpsAuditEventData(opsActor, {
              action: 'ops.report.resolve',
              targetType: 'report',
              targetId: opsReportResolveMatch[1],
              context: {
                resolution: reportData.resolution || reportData.decision || '',
                idempotencyKey: getIdempotencyKeyFromRequest(request)
              }
            }),
            header: {
              'Idempotency-Key': request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || ''
            }
          }, {
            traceId,
            environment: deploymentEnv
          })
          sendResponse(response, 200, {
            data: result,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
          return
        }

        const opsUserStatusMatch = url.pathname.match(/^\/ops\/users\/([^/]+)\/status$/)
        if (opsUserStatusMatch && ['POST', 'PATCH'].includes(method)) {
          const opsActor = authenticateOpsRequest(opsAuth, request, url, ['risk', 'support'])
          const userStatusData = await parseRequestData(request, url, objectStore, contentSafety, maxRequestBytes)
          const result = await runBffTransactionWithNotifications(store, platformNotifier, url.pathname, {
            method,
            data: injectOpsActor(userStatusData, opsActor),
            opsAudit: createOpsAuditEventData(opsActor, {
              action: 'ops.user.status',
              targetType: 'user',
              targetId: opsUserStatusMatch[1],
              context: {
                status: userStatusData.status || '',
                reason: userStatusData.reason || userStatusData.note || '',
                idempotencyKey: getIdempotencyKeyFromRequest(request)
              }
            }),
            header: {
              'Idempotency-Key': request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || ''
            }
          }, {
            traceId,
            environment: deploymentEnv
          })
          sendResponse(response, 200, {
            data: result,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
          return
        }

        if (url.pathname === '/ops/login' && method === 'POST') {
          const loginData = await parseRequestData(request, url, objectStore, contentSafety, maxRequestBytes)
          const result = opsAuth.login(loginData)
          await appendOpsAuditEventToStore(store, createOpsAuditEventData({
            actorId: result.operator?.id || '',
            roles: result.operator?.roles || [],
            source: result.operator?.source || ''
          }, {
            action: 'ops.login',
            targetType: 'ops_session',
            targetId: result.operator?.id || '',
            context: {
              mode: result.operator?.source || ''
            }
          }), {
            traceId,
            environment: deploymentEnv
          })

          sendResponse(response, 200, {
            data: result,
            trace: {
              traceId,
              durationMs: Date.now() - startedAt
            }
          }, traceId, corsContext)
          return
        }

        throw new Error(`接口不存在: ${method} ${url.pathname}`)
      }

      let data = await parseRequestData(request, url, objectStore, contentSafety, maxRequestBytes)
      let opsAudit = null

      if (url.pathname.startsWith('/moderation/')) {
        const opsActor = authenticateOpsRequest(opsAuth, request, url, rolesForModerationPath(url.pathname))
        data = injectOpsActor(data, opsActor)
        opsAudit = createOpsAuditEventData(opsActor, {
          ...opsAuditTargetForModerationPath(url.pathname),
          context: {
            status: data.status || data.reviewStatus || '',
            resolution: data.resolution || '',
            idempotencyKey: getIdempotencyKeyFromRequest(request)
          }
        })
      }

      if (url.pathname === '/auth/login' && method === 'POST') {
        data = await platformAuth.resolveLoginData(data)
      }

      if (url.pathname === '/items' && method === 'GET' && hasCoordinateData(data)) {
        data = {
          ...data,
          serverRegion: await regionResolver.resolveRegion(data)
        }
      }

      if (url.pathname === '/lbs/resolve-region' && method === 'POST') {
        data = {
          ...data,
          serverRegion: await regionResolver.resolveRegion(data)
        }
      }

      if (url.pathname === '/items' && method === 'POST') {
        data = await contentSafety.reviewItemPayload({
          ...data,
          location: {
            ...data.location,
            serverRegion: await regionResolver.resolveRegion(data.location)
          }
        })
      }

      if (url.pathname === '/trades' && method === 'POST') {
        data = {
          ...data,
          buyerLocation: {
            ...data.buyerLocation,
            serverRegion: await regionResolver.resolveRegion(data.buyerLocation)
          }
        }
      }

      const result = await runBffTransactionWithNotifications(store, platformNotifier, url.pathname, {
        method,
        data,
        opsAudit,
        header: {
          Authorization: request.headers.authorization || '',
          'Idempotency-Key': request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || ''
        }
      }, {
        traceId,
        environment: deploymentEnv
      })

      sendResponse(response, 200, {
        data: result,
        trace: {
          traceId,
          durationMs: Date.now() - startedAt
        }
      }, traceId, corsContext)
    } catch (error) {
      const httpError = normalizeBffHttpError(error)

      sendResponse(response, httpError.status, {
        code: httpError.code,
        message: error?.message || '请求处理失败',
        trace: {
          traceId,
          durationMs: Date.now() - startedAt
        }
      }, traceId, corsContext)
    }
  })
}

async function runBffTransactionWithNotifications(store, platformNotifier, path, requestOptions = {}, context = {}) {
  let pendingNotifications = []
  let pendingDeliveryRecords = []
  let usersSnapshot = []
  const result = await store.transact(async (state) => {
    const beforeNotificationIds = new Set(normalizeNotifications(state.notifications).map((notification) => notification.id))
    const responseData = await handleBffRequest(path, requestOptions, state)
    appendOpsAuditEvent(state, requestOptions.opsAudit, context)

    usersSnapshot = Array.isArray(state.users) ? state.users.map((user) => ({ ...user })) : []
    pendingNotifications = normalizeNotifications(state.notifications)
      .filter((notification) => notification.id && !beforeNotificationIds.has(notification.id))
    pendingDeliveryRecords = createPlatformNotificationDeliveryRecords(state, pendingNotifications, {
      provider: platformNotifier.provider,
      traceId: context.traceId
    })

    return responseData
  })

  dispatchPlatformNotifications(platformNotifier, store, pendingDeliveryRecords, pendingNotifications, usersSnapshot, context)

  return result
}

function dispatchPlatformNotifications(platformNotifier, store, deliveryRecords = [], pendingNotifications = [], users = [], context = {}) {
  if (!deliveryRecords.length || !platformNotifier?.dispatchNotifications) {
    return
  }

  Promise.resolve()
    .then(() => dispatchAndRecordPlatformNotifications(platformNotifier, store, deliveryRecords, pendingNotifications, users, context))
    .then((deliveries = []) => {
      const failed = deliveries.filter((delivery) => delivery.status === 'failed')

      if (failed.length) {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'platform_notification_failed',
          traceId: context.traceId,
          failed
        }))
      }
    })
    .catch((error) => {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'platform_notification_dispatch_error',
        traceId: context.traceId,
        message: error?.message || '平台通知投递失败'
      }))
    })
}

async function retryPlatformNotificationDeliveries(store, platformNotifier, data = {}, context = {}) {
  let deliveryRecords = []
  let notifications = []
  let users = []
  const now = Date.now()

  await store.transact(async (state) => {
    const deliveries = normalizeNotificationDeliveries(state.notificationDeliveries)
    const notificationById = new Map(normalizeNotifications(state.notifications).map((notification) => [notification.id, notification]))
    const ids = normalizeIdList(data.ids || data.id || data.deliveryIds)
    const statuses = new Set(normalizeIdList(data.status || data.statuses || ['failed', 'pending']))
    const force = data.force === true || data.force === 'true'
    const limit = Math.min(Math.max(Number(data.limit || 20), 1), 100)

    deliveryRecords = deliveries
      .filter((delivery) => {
        if (ids.length) {
          return ids.includes(delivery.id)
        }

        return statuses.has(delivery.status) && (force || !delivery.nextRetryAt || Number(delivery.nextRetryAt) <= now)
      })
      .slice(0, limit)
      .map((delivery) => ({ ...delivery }))

    notifications = deliveryRecords
      .map((delivery) => notificationById.get(delivery.notificationId))
      .filter(Boolean)
      .map((notification) => ({ ...notification }))
    users = Array.isArray(state.users) ? state.users.map((user) => ({ ...user })) : []

    return null
  })

  if (!deliveryRecords.length) {
    return {
      retried: 0,
      deliveries: []
    }
  }

  const deliveries = await dispatchAndRecordPlatformNotifications(platformNotifier, store, deliveryRecords, notifications, users, {
    ...context,
    retry: true
  })

  return {
    retried: deliveryRecords.length,
    deliveries
  }
}

async function dispatchAndRecordPlatformNotifications(platformNotifier, store, deliveryRecords = [], notifications = [], users = [], context = {}) {
  let deliveries

  try {
    deliveries = await platformNotifier.dispatchNotifications(notifications, users, context)
  } catch (error) {
    deliveries = notifications.map((notification) => ({
      notificationId: notification.id || '',
      userId: notification.userId || '',
      type: notification.type || '',
      provider: platformNotifier.provider || 'unknown',
      status: 'failed',
      message: error?.message || '平台通知投递失败',
      createdAt: Date.now()
    }))
  }

  return recordPlatformNotificationDeliveryResults(store, deliveryRecords, deliveries, {
    provider: platformNotifier.provider,
    traceId: context.traceId
  })
}

async function recordPlatformNotificationDeliveryResults(store, deliveryRecords = [], deliveries = [], context = {}) {
  const deliveryByNotificationId = new Map(deliveries.map((delivery) => [delivery.notificationId, delivery]))
  let updated = []

  await store.transact(async (state) => {
    const now = Date.now()
    const deliveryRecordIds = new Set(deliveryRecords.map((delivery) => delivery.id))

    state.notificationDeliveries = normalizeNotificationDeliveries(state.notificationDeliveries)
      .map((record) => {
        if (!deliveryRecordIds.has(record.id)) {
          return record
        }

        const delivery = deliveryByNotificationId.get(record.notificationId) || {
          notificationId: record.notificationId,
          userId: record.userId,
          type: record.type,
          provider: context.provider || record.provider,
          status: 'failed',
          message: '平台通知适配器未返回投递结果'
        }
        const attemptCount = Number(record.attemptCount || 0) + 1
        const next = {
          ...record,
          provider: delivery.provider || context.provider || record.provider,
          status: delivery.status || 'failed',
          message: delivery.message || '',
          attemptCount,
          traceId: context.traceId || record.traceId || '',
          lastAttemptAt: now,
          nextRetryAt: nextRetryAtForDelivery(delivery.status, attemptCount, now),
          updatedAt: now
        }

        updated.push(next)
        return next
      })

    return null
  })

  return updated
}

function createPlatformNotificationDeliveryRecords(state, notifications = [], options = {}) {
  if (!notifications.length) {
    return []
  }

  const now = Date.now()
  const existingNotificationIds = new Set(
    normalizeNotificationDeliveries(state.notificationDeliveries).map((delivery) => delivery.notificationId)
  )
  const records = notifications
    .filter((notification) => notification.id && !existingNotificationIds.has(notification.id))
    .map((notification) => ({
      id: createDeliveryId(),
      notificationId: notification.id,
      userId: notification.userId || '',
      type: notification.type || '',
      provider: options.provider || 'unknown',
      status: 'pending',
      message: '',
      targetType: notification.targetType || '',
      targetId: notification.targetId || '',
      attemptCount: 0,
      traceId: options.traceId || '',
      lastAttemptAt: null,
      nextRetryAt: now,
      createdAt: now,
      updatedAt: now
    }))

  state.notificationDeliveries = [
    ...records,
    ...normalizeNotificationDeliveries(state.notificationDeliveries)
  ]

  return records
}

function listPlatformNotificationDeliveries(searchParams, state) {
  const status = String(searchParams.get('status') || '').trim()
  const notificationId = String(searchParams.get('notificationId') || '').trim()
  const userId = String(searchParams.get('userId') || '').trim()
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 100)

  return normalizeNotificationDeliveries(state.notificationDeliveries)
    .filter((delivery) => !status || delivery.status === status)
    .filter((delivery) => !notificationId || delivery.notificationId === notificationId)
    .filter((delivery) => !userId || delivery.userId === userId)
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .slice(0, limit)
}

function normalizeNotificationDeliveries(deliveries = []) {
  return Array.isArray(deliveries) ? deliveries : []
}

function normalizeNotifications(notifications = []) {
  return Array.isArray(notifications) ? notifications : []
}

function normalizeIdList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean)
  }

  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function nextRetryAtForDelivery(status, attemptCount, now) {
  if (['sent', 'mock_sent', 'skipped'].includes(status)) {
    return null
  }

  const delayMs = Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(Math.max(attemptCount - 1, 0), 5)))
  return now + delayMs
}

function createDeliveryId() {
  return `notification_delivery_${Date.now()}_${randomBytes(4).toString('hex')}`
}

async function appendOpsAuditEventToStore(store, auditEvent, context = {}) {
  await store.transact(async (state) => {
    appendOpsAuditEvent(state, auditEvent, context)
    return null
  })
}

function appendOpsAuditEvent(state = {}, auditEvent = null, context = {}) {
  if (!auditEvent?.action) {
    return null
  }

  const now = Date.now()
  const normalizedContext = {
    ...(auditEvent.context && typeof auditEvent.context === 'object' ? auditEvent.context : {})
  }
  const idempotencyKey = String(normalizedContext.idempotencyKey || '').trim()
  const existingEvents = normalizeOpsAuditEvents(state.opsAuditEvents)

  if (idempotencyKey && existingEvents.some((event) =>
    event.action === auditEvent.action &&
    event.targetType === (auditEvent.targetType || '') &&
    event.targetId === (auditEvent.targetId || '') &&
    event.context?.idempotencyKey === idempotencyKey
  )) {
    state.opsAuditEvents = existingEvents
    return null
  }

  const next = {
    id: auditEvent.id || createOpsAuditId(),
    actorId: auditEvent.actorId || '',
    action: auditEvent.action,
    targetType: auditEvent.targetType || '',
    targetId: auditEvent.targetId || '',
    result: auditEvent.result || 'success',
    message: String(auditEvent.message || '').slice(0, 500),
    traceId: auditEvent.traceId || context.traceId || '',
    source: auditEvent.source || '',
    context: normalizedContext,
    createdAt: Number(auditEvent.createdAt || now)
  }

  state.opsAuditEvents = [
    next,
    ...existingEvents
  ].slice(0, 2000)

  return next
}

function createOpsAuditEventData(opsActor = {}, event = {}) {
  return {
    actorId: opsActor.actorId || opsActor.id || '',
    action: event.action || '',
    targetType: event.targetType || '',
    targetId: event.targetId || '',
    result: event.result || 'success',
    message: event.message || '',
    source: event.source || opsActor.source || '',
    context: {
      ...(event.context && typeof event.context === 'object' ? event.context : {}),
      actorRoles: Array.isArray(opsActor.roles) ? opsActor.roles : []
    }
  }
}

function createOpsAuditId() {
  return `ops_audit_${Date.now()}_${randomBytes(4).toString('hex')}`
}

function normalizeOpsAuditEvents(events = []) {
  return Array.isArray(events)
    ? events.filter((event) => event?.id && event?.action)
    : []
}

function authenticateOpsRequest(opsAuth, request, url, roles = []) {
  const opsActor = opsAuth.authenticateRequest(request, url)
  assertOpsRole(opsActor, roles)
  return opsActor
}

function assertOpsRole(opsActor = {}, roles = []) {
  const requiredRoles = Array.isArray(roles) ? roles.filter(Boolean) : []

  if (!requiredRoles.length) {
    return
  }

  const actorRoles = new Set(Array.isArray(opsActor.roles) ? opsActor.roles : [])

  if (!requiredRoles.some((role) => actorRoles.has(role))) {
    throw new Error('当前账号不能执行该运营操作')
  }
}

function rolesForModerationPath(path = '') {
  if (/^\/moderation\/disputes\/[^/]+\/resolve$/.test(path)) {
    return ['support']
  }

  return ['moderation']
}

function opsAuditTargetForModerationPath(path = '') {
  const itemMatch = path.match(/^\/moderation\/items\/([^/]+)\/review$/)
  if (itemMatch) {
    return {
      action: 'ops.item.review',
      targetType: 'item',
      targetId: itemMatch[1]
    }
  }

  const mediaMatch = path.match(/^\/moderation\/media\/([^/]+)\/review$/)
  if (mediaMatch) {
    return {
      action: 'ops.media.review',
      targetType: 'media',
      targetId: mediaMatch[1]
    }
  }

  const disputeMatch = path.match(/^\/moderation\/disputes\/([^/]+)\/resolve$/)
  if (disputeMatch) {
    return {
      action: 'ops.dispute.resolve',
      targetType: 'dispute',
      targetId: disputeMatch[1]
    }
  }

  return {
    action: 'ops.moderation.write',
    targetType: 'moderation',
    targetId: path
  }
}

function getIdempotencyKeyFromRequest(request = {}) {
  return String(request.headers?.['idempotency-key'] || request.headers?.['x-idempotency-key'] || '').trim()
}

function hasCoordinateData(data = {}) {
  return Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude))
}

export async function startGoodsCommServer(options = {}) {
  const server = createGoodsCommServer(options)
  const port = Number(options.port ?? process.env.PORT ?? DEFAULT_PORT)
  const host = options.host ?? process.env.HOST ?? '127.0.0.1'

  await new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart)
    server.listen(port, host, () => {
      server.off('error', rejectStart)
      resolveStart()
    })
  })
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port

  return {
    server,
    port: actualPort,
    host,
    url: `http://${host}:${actualPort}`
  }
}

function routeMethod(request) {
  if (request.url?.startsWith('/uploads/items') && request.method === 'POST') {
    return 'UPLOAD'
  }

  return request.method || 'GET'
}

function assertModerationSecret(request, url, environment, options = {}) {
  const expected = options.moderationSecret || process.env.GOODS_COMM_MODERATION_WEBHOOK_SECRET || ''
  const actual = request.headers['x-moderation-secret'] || url.searchParams.get('secret') || ''

  if (!expected || /REPLACE_WITH|placeholder|example\./i.test(String(expected))) {
    throw new Error(`${environment} 环境审核回调密钥未配置`)
  }

  if (actual !== expected) {
    throw new Error('审核回调密钥无效')
  }
}

function injectOpsActor(data = {}, opsActor = {}) {
  if (!opsActor?.actorId) {
    return data
  }

  return {
    ...data,
    actorId: opsActor.actorId,
    opsActor: {
      id: opsActor.actorId,
      roles: Array.isArray(opsActor.roles) ? opsActor.roles : [],
      source: opsActor.source || ''
    }
  }
}

async function parseRequestData(request, url, objectStore, contentSafety, maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES) {
  if (request.method === 'GET') {
    return Object.fromEntries(url.searchParams.entries())
  }

  const contentType = request.headers['content-type'] || ''

  if (contentType.includes('application/json')) {
    const raw = await readRequestBody(request, maxRequestBytes)
    const text = raw.toString('utf8')
    return text ? JSON.parse(text) : {}
  }

  if (contentType.includes('multipart/form-data')) {
    const raw = await readRequestBody(request, maxRequestBytes)
    const form = parseMultipartForm(raw, contentType)

    if (url.pathname === '/uploads/items' && form.file) {
      return {
        ...form.fields,
        file: await contentSafety.reviewUploadedImage(await objectStore.saveItemImage(form.file))
      }
    }

    if (url.pathname === '/uploads/items') {
      throw new Error('请上传有效图片文件')
    }

    return form.fields
  }

  const raw = await readRequestBody(request, maxRequestBytes)
  const text = raw.toString('utf8')
  return text ? JSON.parse(text) : {}
}

function readRequestBody(request, maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES) {
  const limit = normalizeMaxRequestBytes(maxRequestBytes)
  const contentLength = Number(request.headers['content-length'] || 0)

  if (Number.isFinite(contentLength) && contentLength > limit) {
    return Promise.reject(createHttpError(413, 'PAYLOAD_TOO_LARGE', `请求体不能超过 ${formatBytes(limit)}`))
  }

  return new Promise((resolveRead, rejectRead) => {
    const chunks = []
    let totalBytes = 0
    let settled = false

    function fail(error) {
      if (settled) {
        return
      }

      settled = true
      request.off('data', onData)
      request.off('error', onError)
      request.off('end', onEnd)
      request.resume()
      rejectRead(error)
    }

    function onData(chunk) {
      totalBytes += chunk.length

      if (totalBytes > limit) {
        fail(createHttpError(413, 'PAYLOAD_TOO_LARGE', `请求体不能超过 ${formatBytes(limit)}`))
        return
      }

      chunks.push(chunk)
    }

    function onError(error) {
      fail(error)
    }

    function onEnd() {
      if (settled) {
        return
      }

      settled = true
      resolveRead(Buffer.concat(chunks, totalBytes))
    }

    request.on('data', onData)
    request.on('error', onError)
    request.on('end', onEnd)
  })
}

function createHttpError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function normalizeMaxRequestBytes(value = DEFAULT_MAX_REQUEST_BYTES) {
  const normalized = Number(value || DEFAULT_MAX_REQUEST_BYTES)

  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`GOODS_COMM_MAX_REQUEST_BYTES must be a positive integer, got ${value}`)
  }

  return normalized
}

function createRateLimiter(options = {}) {
  const maxRequests = normalizePositiveInteger(
    options.maxRequests ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    'GOODS_COMM_RATE_LIMIT_MAX_REQUESTS'
  )
  const windowMs = normalizePositiveInteger(
    options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    'GOODS_COMM_RATE_LIMIT_WINDOW_MS'
  )
  const trustedProxyRules = parseTrustedProxyRules(options.trustedProxyIps)
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const clients = new Map()

  return {
    check(request) {
      if (isRateLimitExemptRequest(request)) {
        return {
          allowed: true,
          maxRequests,
          windowMs,
          remaining: maxRequests,
          resetAt: now()
        }
      }

      const currentTime = now()
      const clientId = getRateLimitClientId(request, trustedProxyRules)
      const existing = clients.get(clientId)
      const entry = existing && existing.resetAt > currentTime
        ? existing
        : {
            count: 0,
            resetAt: currentTime + windowMs
          }

      if (entry.count >= maxRequests) {
        clients.set(clientId, entry)
        return {
          allowed: false,
          clientId,
          maxRequests,
          windowMs,
          remaining: 0,
          resetAt: entry.resetAt,
          retryAfterMs: Math.max(entry.resetAt - currentTime, 0)
        }
      }

      entry.count += 1
      clients.set(clientId, entry)
      cleanupExpiredRateLimitEntries(clients, currentTime)

      return {
        allowed: true,
        clientId,
        maxRequests,
        windowMs,
        remaining: Math.max(maxRequests - entry.count, 0),
        resetAt: entry.resetAt,
        retryAfterMs: Math.max(entry.resetAt - currentTime, 0)
      }
    },
    describe() {
      return {
        maxRequests,
        windowMs,
        trustedProxyCount: trustedProxyRules.length
      }
    }
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

function normalizePositiveInteger(value, name) {
  const normalized = Number(value)

  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}`)
  }

  return normalized
}

function rateLimitHeaders(rateLimit = {}) {
  return {
    'retry-after': String(Math.max(Math.ceil((rateLimit.retryAfterMs || 0) / 1000), 1)),
    'x-rate-limit-limit': String(rateLimit.maxRequests || ''),
    'x-rate-limit-remaining': String(rateLimit.remaining || 0),
    'x-rate-limit-reset': String(Math.ceil((rateLimit.resetAt || Date.now()) / 1000))
  }
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${Math.floor(bytes / 1024 / 1024)}MB`
  }

  if (bytes >= 1024) {
    return `${Math.floor(bytes / 1024)}KB`
  }

  return `${bytes}B`
}

function getTraceId(request) {
  const incoming = request.headers['x-trace-id']
  const value = Array.isArray(incoming) ? incoming[0] : incoming

  if (typeof value === 'string' && /^[a-zA-Z0-9_.:-]{8,80}$/.test(value)) {
    return value
  }

  return `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function createCorsPolicy(allowedOrigins = '', options = {}) {
  const origins = Array.isArray(allowedOrigins)
    ? allowedOrigins
    : String(allowedOrigins || '').split(',')
  const normalizedOrigins = origins
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean)
  const wildcard = normalizedOrigins.length === 0 || normalizedOrigins.includes('*')
  const environment = normalizeDeploymentEnv(options.environment || process.env.GOODS_COMM_ENV || 'dev')

  if (PROTECTED_ENVIRONMENTS.includes(environment) && wildcard && !options.allowUnsafeWildcard) {
    throw new Error(`${environment} 环境不能使用 CORS wildcard，请配置 GOODS_COMM_ALLOWED_ORIGINS`)
  }

  return {
    wildcard,
    allowedOrigins: new Set(normalizedOrigins.filter((origin) => origin !== '*'))
  }
}

function createCorsContext(request, corsPolicy) {
  const origin = normalizeOrigin(request.headers.origin || '')

  if (corsPolicy.wildcard) {
    return {
      allowed: true,
      headers: {
        'access-control-allow-origin': '*'
      }
    }
  }

  if (!origin) {
    return {
      allowed: true,
      headers: {
        vary: 'Origin'
      }
    }
  }

  if (corsPolicy.allowedOrigins.has(origin)) {
    return {
      allowed: true,
      headers: {
        'access-control-allow-origin': origin,
        vary: 'Origin'
      }
    }
  }

  return {
    allowed: false,
    headers: {
      vary: 'Origin'
    }
  }
}

function normalizeOrigin(value = '') {
  const origin = String(value || '').trim()

  if (origin === '*') {
    return origin
  }

  return origin.replace(/\/$/, '')
}

function normalizeDeploymentEnv(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  if (['dev', 'test', 'pre', 'prod'].includes(normalized)) {
    return normalized
  }

  throw new Error(`GOODS_COMM_ENV 只能是 dev/test/pre/prod，当前为 ${value || '空'}`)
}

function corsHeaders(corsContext = {}) {
  return {
    ...(corsContext.headers || {}),
    'access-control-allow-methods': DEFAULT_CORS_METHODS,
    'access-control-allow-headers': DEFAULT_CORS_HEADERS,
    'access-control-max-age': '600'
  }
}

function sendResponse(response, statusCode, payload, traceId = '', corsContext = {}, extraHeaders = {}) {
  response.writeHead(statusCode, {
    ...(corsContext.securityHeaders || securityHeaders()),
    ...corsHeaders(corsContext),
    ...extraHeaders,
    'content-type': 'application/json; charset=utf-8',
    ...(traceId ? { 'x-trace-id': traceId } : {})
  })

  response.end(payload ? JSON.stringify(payload) : '')
}

function sendBinaryResponse(response, statusCode, bytes, mimeType, traceId = '', corsContext = {}) {
  response.writeHead(statusCode, {
    ...(corsContext.securityHeaders || securityHeaders()),
    ...corsHeaders(corsContext),
    'content-type': mimeType,
    'content-length': bytes.length,
    ...(traceId ? { 'x-trace-id': traceId } : {})
  })
  response.end(bytes)
}

function securityHeaders(environment = '') {
  const normalizedEnvironment = String(environment || process.env.GOODS_COMM_ENV || '').trim().toLowerCase()

  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), camera=(), microphone=()',
    ...(PROTECTED_ENVIRONMENTS.includes(normalizedEnvironment)
      ? { 'strict-transport-security': 'max-age=15552000; includeSubDomains' }
      : {})
  }
}

function parseMultipartForm(raw, contentType = '') {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i)

  if (!boundaryMatch) {
    throw new Error('上传表单缺少 boundary')
  }

  const boundary = Buffer.from(`--${boundaryMatch[1].replace(/^"|"$/g, '')}`)
  const boundaryMarker = Buffer.concat([Buffer.from('\r\n'), boundary])
  const headerSeparator = Buffer.from('\r\n\r\n')
  const fields = {}
  let file = null
  let cursor = 0

  while (cursor < raw.length) {
    const boundaryStart = raw.indexOf(boundary, cursor)

    if (boundaryStart < 0) {
      break
    }

    let partStart = boundaryStart + boundary.length

    if (raw.slice(partStart, partStart + 2).toString() === '--') {
      break
    }

    if (raw.slice(partStart, partStart + 2).toString() === '\r\n') {
      partStart += 2
    }

    const separatorIndex = raw.indexOf(headerSeparator, partStart)

    if (separatorIndex < 0) {
      break
    }

    const rawHeaders = raw.slice(partStart, separatorIndex).toString('utf8')
    const valueStart = separatorIndex + headerSeparator.length
    const nextBoundaryMarkerStart = raw.indexOf(boundaryMarker, valueStart)
    const nextBoundaryStart = nextBoundaryMarkerStart >= 0
      ? nextBoundaryMarkerStart + 2
      : raw.indexOf(boundary, valueStart)

    if (nextBoundaryStart < 0) {
      break
    }

    const valueEnd = nextBoundaryMarkerStart >= 0 ? nextBoundaryMarkerStart : nextBoundaryStart

    const value = raw.slice(valueStart, valueEnd)
    const name = rawHeaders.match(/name="([^"]+)"/)?.[1] || ''
    const filename = rawHeaders.match(/filename="([^"]*)"/)?.[1] || ''
    const mimeType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1] || ''
    cursor = nextBoundaryStart

    if (!name) {
      continue
    }

    if (filename) {
      file = {
        fieldName: name,
        filename,
        mimeType,
        bytes: value
      }
      continue
    }

    fields[name] = value.toString('utf8')
  }

  return {
    fields,
    file
  }
}

const isCliEntry = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isCliEntry) {
  const runtime = await startGoodsCommServer()
  console.log(`goods-comm backend listening on ${runtime.url}`)
}
