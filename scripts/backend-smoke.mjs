import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startGoodsCommServer } from '../backend/src/server.mjs'
import { createContentSafetyClient } from '../backend/src/content-safety.mjs'
import { ITEM_STATUS, TRADE_STATUS } from '../src/services/goods.js'

const statePath = resolve('/private/tmp/goods-comm-backend-smoke.json')
const objectRootDir = resolve('/private/tmp/goods-comm-object-store-smoke')
const allowedOrigin = 'https://mini.example.com'
const deliveredPlatformNotifications = []
const failedPlatformNotificationTypes = new Set(['trade_reviewed'])
const reviewedItemPayloads = []
const mockContentSafety = createContentSafetyClient({
  environment: 'test',
  contentSafetyProvider: 'mock'
})

await assertHttpRateLimit()
await assertTrustedProxyForwardedRateLimit()
await assertProtectedSecurityHeaders()

await rm(statePath, {
  force: true
})
await rm(objectRootDir, {
  recursive: true,
  force: true
})

const runtime = await startGoodsCommServer({
  port: 0,
  environment: 'test',
  statePath,
  objectRootDir,
  allowedOrigins: [allowedOrigin],
  moderationSecret: 'backend-smoke-secret',
  opsSessionSecret: 'backend-smoke-ops-session-secret',
  opsAccounts: 'backend-support-smoke:backend-smoke-secret:moderation|support|notifications|telemetry|risk,backend-observer-smoke:backend-observer-secret:telemetry,backend-locked-smoke:backend-locked-secret:telemetry',
  opsLoginMaxFailures: 2,
  opsLoginWindowMs: 60_000,
  opsLoginLockMs: 60_000,
  maxRequestBytes: 16 * 1024,
  contentSafety: {
    provider: mockContentSafety.provider,
    reviewItemPayload: async (payload = {}) => {
      reviewedItemPayloads.push(payload)
      return mockContentSafety.reviewItemPayload(payload)
    },
    reviewUploadedImage: async (file = {}) => mockContentSafety.reviewUploadedImage(file)
  },
  platformNotifier: {
    provider: 'mock',
    dispatchNotifications: async (notifications = [], users = [], context = {}) => {
      deliveredPlatformNotifications.push(...notifications.map((notification) => ({
        id: notification.id,
        userId: notification.userId,
        type: notification.type,
        targetId: notification.targetId,
        traceId: context.traceId,
        recipientProvider: users.find((user) => user.id === notification.userId)?.provider || '',
        status: failedPlatformNotificationTypes.has(notification.type) ? 'failed' : 'mock_sent'
      })))

      return notifications.map((notification) => ({
        notificationId: notification.id,
        userId: notification.userId,
        type: notification.type,
        provider: 'mock',
        status: failedPlatformNotificationTypes.has(notification.type) ? 'failed' : 'mock_sent',
        message: failedPlatformNotificationTypes.has(notification.type) ? 'smoke forced notification failure' : 'mock sent',
        createdAt: Date.now()
      }))
    }
  }
})

try {
  const baseUrl = runtime.url
  const health = await getEnvelope(`${baseUrl}/health`, {
    traceId: 'trace_backend_smoke',
    origin: allowedOrigin
  })
  assert.equal(health.status, 200)
  assert.equal(health.payload.data.ok, true)
  assert.equal(health.payload.data.environment, 'test')
  assert.equal(health.payload.data.stateStore, 'file')
  assert.equal(health.payload.data.objectStore, 'local')
  assert.equal(health.payload.data.contentSafety, 'mock')
  assert.equal(health.payload.data.mapProvider, 'mock')
  assert.equal(health.payload.data.platformNotify, 'mock')
  assert.equal(health.payload.trace.traceId, 'trace_backend_smoke')
  assert.equal(health.traceId, 'trace_backend_smoke')
  assert.equal(health.corsOrigin, allowedOrigin)
  assert.equal(health.vary, 'Origin')
  assertSecurityHeaders(health.securityHeaders, {
    hsts: false
  })

  const ready = await getEnvelope(`${baseUrl}/health/ready`, {
    traceId: 'trace_backend_ready',
    origin: allowedOrigin
  })
  assert.equal(ready.status, 200)
  assert.equal(ready.payload.data.ok, true)
  assert.equal(ready.payload.data.environment, 'test')
  assert.equal(ready.payload.data.stateStore, 'file')
  assert.equal(ready.payload.data.objectStore, 'local')
  assert.equal(ready.payload.data.contentSafety, 'mock')
  assert.equal(ready.payload.data.mapProvider, 'mock')
  assert.equal(ready.payload.data.platformNotify, 'mock')
  assert.equal(ready.payload.data.readiness.type, 'file')

  const allowedPreflight = await optionsEnvelope(`${baseUrl}/items`, allowedOrigin)
  assert.equal(allowedPreflight.status, 204)
  assert.equal(allowedPreflight.payload, null)
  assert.equal(allowedPreflight.corsOrigin, allowedOrigin)
  assertSecurityHeaders(allowedPreflight.securityHeaders, {
    hsts: false
  })

  const rejectedPreflight = await optionsEnvelope(`${baseUrl}/items`, 'https://evil.example.com')
  assert.equal(rejectedPreflight.status, 403)
  assert.equal(rejectedPreflight.payload.code, 'FORBIDDEN')
  assert.match(rejectedPreflight.payload.message, /CORS 来源不允许/)
  assert.equal(rejectedPreflight.corsOrigin, null)
  assert.equal(rejectedPreflight.vary, 'Origin')

  const oversizedRequest = await postExpectError(`${baseUrl}/auth/login`, {
    provider: 'weixin',
    code: 'oversized-login-code',
    userInfo: {
      nickname: '请求体过大',
      avatarUrl: 'x'.repeat(20 * 1024)
    }
  })
  assert.equal(oversizedRequest.status, 413)
  assert.equal(oversizedRequest.code, 'PAYLOAD_TOO_LARGE')
  assert.match(oversizedRequest.message, /请求体不能超过 16KB/)

  const seller = await post(`${baseUrl}/auth/login`, {
    provider: 'weixin',
    code: 'backend-seller-code',
    userInfo: {
      nickname: '后端卖家',
      avatarUrl: ''
    }
  })
  const buyer = await post(`${baseUrl}/auth/login`, {
    provider: 'weixin',
    code: 'backend-buyer-code',
    userInfo: {
      nickname: '后端买家',
      avatarUrl: ''
    }
  })

  assert.equal(seller.user.nickname, '后端卖家')
  assert.equal(Boolean(seller.token), true)

  const sellerLocation = {
    latitude: 31.22945,
    longitude: 121.45494,
    accuracy: 50,
    capturedAt: Date.now(),
    communityId: 'client-spoofed',
    streetId: 'client-spoofed'
  }
  const resolved = await post(`${baseUrl}/lbs/resolve-region`, sellerLocation)

  assert.equal(resolved.communityId, 'sh-jingan-shimen')
  assert.equal(resolved.streetId, 'sh-jingan-nanjingxi')

  const uploadBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
  const upload = await uploadFile(`${baseUrl}/uploads/items`, uploadBytes, seller.token)
  assert.equal(upload.status, 'uploaded')
  assert.equal(upload.storageKey.startsWith('items/'), true)
  assert.equal(upload.mimeType, 'image/png')
  assert.equal(upload.originalName, 'smoke-item.png')
  assert.equal(upload.size, uploadBytes.length)
  assert.equal(upload.checksum.length, 64)
  assert.equal(upload.url.startsWith('/assets/items/'), true)

  const asset = await fetch(`${baseUrl}${upload.url}`, {
    headers: {
      origin: allowedOrigin
    }
  })
  assert.equal(asset.status, 200)
  assert.equal(asset.headers.get('content-type'), 'image/png')
  assert.equal(asset.headers.get('access-control-allow-origin'), allowedOrigin)
  assert.equal(asset.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(asset.headers.get('x-frame-options'), 'DENY')
  assert.equal(asset.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(asset.headers.get('permissions-policy'), 'geolocation=(), camera=(), microphone=()')
  assert.deepEqual(new Uint8Array(await asset.arrayBuffer()), uploadBytes)

  const missingAsset = await requestExpectError(`${baseUrl}/assets/items/missing.png`, {
    method: 'GET',
    origin: allowedOrigin
  })
  assert.equal(missingAsset.status, 404)
  assert.equal(missingAsset.code, 'NOT_FOUND')

  const forgedUploadedImageItem = await postExpectError(`${baseUrl}/items`, {
    title: '后端伪造已上传图片商品',
    price: 59,
    category: 'home',
    condition: 'good',
    description: '客户端不能伪造 uploaded 图片状态',
    images: [{
      url: 'https://cdn.example.com/backend-forged-uploaded-image.jpg',
      status: 'uploaded'
    }],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }, seller.token)
  assert.equal(forgedUploadedImageItem.status, 422)
  assert.equal(forgedUploadedImageItem.code, 'VALIDATION_ERROR')
  assert.match(forgedUploadedImageItem.message, /图片未通过当前账号上传或审核/)

  const buyerOwnedUpload = await uploadFile(`${baseUrl}/uploads/items`, uploadBytes, buyer.token)
  const crossOwnerUploadedImageItem = await postExpectError(`${baseUrl}/items`, {
    title: '后端跨账号图片商品',
    price: 59,
    category: 'home',
    condition: 'good',
    description: '卖家不能复用买家上传的图片',
    images: [buyerOwnedUpload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }, seller.token)
  assert.equal(crossOwnerUploadedImageItem.status, 422)
  assert.equal(crossOwnerUploadedImageItem.code, 'VALIDATION_ERROR')
  assert.match(crossOwnerUploadedImageItem.message, /图片未通过当前账号上传或审核/)

  const stalePublishLocation = await postExpectError(`${baseUrl}/items`, {
    title: '后端过期定位商品',
    price: 59,
    category: 'home',
    condition: 'good',
    description: '发布位置必须是新鲜实时定位',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      ...sellerLocation,
      capturedAt: Date.now() - 6 * 60 * 1000
    }
  }, seller.token)
  assert.equal(stalePublishLocation.status, 422)
  assert.equal(stalePublishLocation.code, 'VALIDATION_ERROR')
  assert.match(stalePublishLocation.message, /当前位置已过期/)

  const lowAccuracyPublishLocation = await postExpectError(`${baseUrl}/items`, {
    title: '后端低精度定位商品',
    price: 59,
    category: 'home',
    condition: 'good',
    description: '发布位置必须有足够精度',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: {
      ...sellerLocation,
      accuracy: 260,
      capturedAt: Date.now()
    }
  }, seller.token)
  assert.equal(lowAccuracyPublishLocation.status, 422)
  assert.equal(lowAccuracyPublishLocation.code, 'VALIDATION_ERROR')
  assert.match(lowAccuracyPublishLocation.message, /定位精度约 260m/)

  const item = await post(`${baseUrl}/items`, {
    title: '后端烟测商品',
    price: 99,
    category: 'home',
    condition: 'good',
    description: '通过真实 HTTP 后端发布',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }, seller.token)

  assert.equal(item.status, 'online')
  assert.equal(item.seller.contactCode, undefined)
  assert.equal(item.location.latitude, undefined)
  assert.equal(item.location.communityId, resolved.communityId)

  const noLocationList = await get(`${baseUrl}/items`)
  assert.equal(noLocationList.items.some((candidate) => candidate.id === item.id), false)

  const listWithoutLocationQuality = await requestExpectError(`${baseUrl}/items?latitude=31.2301&longitude=121.4556`, {
    method: 'GET'
  })
  assert.equal(listWithoutLocationQuality.status, 422)
  assert.equal(listWithoutLocationQuality.code, 'VALIDATION_ERROR')
  assert.match(listWithoutLocationQuality.message, /需要提交实时 GPS 定位时间/)

  const visibleNearList = await get(`${baseUrl}/items?latitude=31.2301&longitude=121.4556&accuracy=60&capturedAt=${Date.now()}`)
  assert.equal(visibleNearList.items.some((candidate) => candidate.id === item.id), true)

  const outsideScopeList = await get(`${baseUrl}/items?latitude=31.23648&longitude=121.44373&accuracy=60&capturedAt=${Date.now()}`)
  assert.equal(outsideScopeList.items.some((candidate) => candidate.id === item.id), false)

  const duplicate = await postExpectError(`${baseUrl}/items`, {
    title: '后端烟测商品',
    price: 109,
    category: 'home',
    condition: 'good',
    description: '同一卖家不能重复发布同名活跃商品',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }, seller.token)

  assert.match(duplicate.message, /已存在同名在售或审核中的商品/)
  assert.equal(duplicate.code, 'CONFLICT')
  assert.equal(duplicate.status, 409)
  assert.equal(Boolean(duplicate.trace?.traceId), true)
  assert.equal(duplicate.traceId, duplicate.trace.traceId)

  const idempotentItemPayload = {
    title: '后端幂等发布商品',
    price: 118,
    category: 'electronics',
    condition: 'good',
    description: '相同幂等键重复提交必须返回同一商品',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }
  const itemReviewCallsBeforeIdempotentCreate = reviewedItemPayloads.length
  const idempotentItem = await post(`${baseUrl}/items`, idempotentItemPayload, seller.token, {
    header: {
      'Idempotency-Key': 'backend_item_create_key_001'
    }
  })
  const replayedItem = await post(`${baseUrl}/items`, idempotentItemPayload, seller.token, {
    header: {
      'Idempotency-Key': 'backend_item_create_key_001'
    }
  })
  assert.equal(replayedItem.id, idempotentItem.id)
  assert.equal(reviewedItemPayloads.length - itemReviewCallsBeforeIdempotentCreate, 1)
  const reusedIdempotencyKey = await requestExpectError(`${baseUrl}/items`, {
    method: 'POST',
    token: seller.token,
    data: {
      ...idempotentItemPayload,
      price: 119
    },
    header: {
      'Idempotency-Key': 'backend_item_create_key_001'
    }
  })
  assert.equal(reusedIdempotencyKey.status, 409)
  assert.equal(reusedIdempotencyKey.code, 'CONFLICT')
  assert.match(reusedIdempotencyKey.message, /幂等键已被不同请求使用/)
  assert.equal(reviewedItemPayloads.length - itemReviewCallsBeforeIdempotentCreate, 1)

  const rejectedContentItemPayload = {
    title: '后端违禁烟测商品',
    price: 29,
    category: 'home',
    condition: 'good',
    description: '命中违禁内容',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }
  const itemReviewCallsBeforeRejectedContent = reviewedItemPayloads.length
  const rejectedContentItem = await requestExpectError(`${baseUrl}/items`, {
    method: 'POST',
    token: seller.token,
    data: rejectedContentItemPayload,
    header: {
      'Idempotency-Key': 'backend_rejected_item_key_001'
    }
  })
  const replayedRejectedContentItem = await requestExpectError(`${baseUrl}/items`, {
    method: 'POST',
    token: seller.token,
    data: rejectedContentItemPayload,
    header: {
      'Idempotency-Key': 'backend_rejected_item_key_001'
    }
  })
  assert.equal(rejectedContentItem.status, 422)
  assert.equal(rejectedContentItem.code, 'VALIDATION_ERROR')
  assert.match(rejectedContentItem.message, /商品未通过审核/)
  assert.equal(replayedRejectedContentItem.status, 422)
  assert.equal(replayedRejectedContentItem.code, 'VALIDATION_ERROR')
  assert.match(replayedRejectedContentItem.message, /商品未通过审核/)
  assert.equal(reviewedItemPayloads.length - itemReviewCallsBeforeRejectedContent, 1)

  const stateAfterRejectedContent = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(stateAfterRejectedContent.moderationEvents.filter((event) =>
    event.targetType === 'item_submission' &&
    event.title === '后端违禁烟测商品' &&
    event.status === 'rejected'
  ).length, 1)
  assert.equal(stateAfterRejectedContent.idempotencyRecords.some((record) =>
    record.key === 'backend_rejected_item_key_001' &&
    record.status === 'committed_error' &&
    /商品未通过审核/.test(record.response?.message || '')
  ), true)
  assert.equal(stateAfterRejectedContent.items.some((candidate) =>
    candidate.title === '后端违禁烟测商品'
  ), false)

  const pendingItem = await post(`${baseUrl}/items`, {
    title: '后端待审烟测商品',
    price: 66,
    category: 'home',
    condition: 'good',
    description: '用于验证审核回调上架',
    images: [{
      id: 'pending-image-smoke',
      url: 'https://cdn.example.com/pending-image-smoke.jpg',
      status: 'pending_review',
      traceId: 'backend-pending-image-trace'
    }],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }, seller.token)
  assert.equal(pendingItem.status, 'pending_review')

  const rejectedModeration = await postExpectError(`${baseUrl}/moderation/media/backend-pending-image-trace/review`, {
    status: 'approved'
  })
  assert.equal(rejectedModeration.status, 401)
  assert.equal(rejectedModeration.code, 'UNAUTHENTICATED')

  const approvedModeration = await request(`${baseUrl}/moderation/media/backend-pending-image-trace/review`, {
    method: 'POST',
    data: {
      status: 'approved',
      actorId: 'backend-smoke'
    },
    header: {
      'x-moderation-secret': 'backend-smoke-secret'
    }
  })
  assert.equal(approvedModeration.status, 'online')

  const visibleModeratedItem = await get(`${baseUrl}/items/${pendingItem.id}`)
  assert.equal(visibleModeratedItem.id, pendingItem.id)

  const moderationRaceItem = await post(`${baseUrl}/items`, {
    title: '后端审核竞态商品',
    price: 88,
    category: 'home',
    condition: 'good',
    description: '被高风险举报下架后，迟到的审核通过回调不能重新上架',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }, seller.token)
  const moderationRaceReport = await post(`${baseUrl}/reports`, {
    targetType: 'item',
    targetId: moderationRaceItem.id,
    reason: 'fraud',
    description: '高风险举报先下架'
  }, buyer.token)
  assert.equal(moderationRaceReport.status, 'pending_review')
  const lateModerationApproval = await requestExpectError(`${baseUrl}/moderation/items/${moderationRaceItem.id}/review`, {
    method: 'POST',
    data: {
      status: 'approved',
      actorId: 'late-backend-smoke'
    },
    header: {
      'x-moderation-secret': 'backend-smoke-secret'
    }
  })
  assert.equal(lateModerationApproval.status, 409)
  assert.equal(lateModerationApproval.code, 'CONFLICT')
  assert.match(lateModerationApproval.message, /审核回调不能重新上架已下架商品/)
  const hiddenRaceItem = await getExpectError(`${baseUrl}/items/${moderationRaceItem.id}`)
  assert.equal(hiddenRaceItem.status, 404)
  assert.equal(hiddenRaceItem.code, 'NOT_FOUND')
  const firstOpsLoginFailure = await requestExpectError(`${baseUrl}/ops/login`, {
    method: 'POST',
    data: {
      accountId: 'backend-locked-smoke',
      password: 'bad-secret-1'
    }
  })
  assert.equal(firstOpsLoginFailure.status, 401)
  assert.equal(firstOpsLoginFailure.code, 'UNAUTHENTICATED')
  const lockedOpsLogin = await requestExpectError(`${baseUrl}/ops/login`, {
    method: 'POST',
    data: {
      accountId: 'backend-locked-smoke',
      password: 'bad-secret-2'
    }
  })
  assert.equal(lockedOpsLogin.status, 429)
  assert.equal(lockedOpsLogin.code, 'TOO_MANY_REQUESTS')
  assert.match(lockedOpsLogin.message, /运营登录失败次数过多/)
  const lockedOpsLoginWithCorrectPassword = await requestExpectError(`${baseUrl}/ops/login`, {
    method: 'POST',
    data: {
      accountId: 'backend-locked-smoke',
      password: 'backend-locked-secret'
    }
  })
  assert.equal(lockedOpsLoginWithCorrectPassword.status, 429)
  const opsLogin = await request(`${baseUrl}/ops/login`, {
    method: 'POST',
    data: {
      accountId: 'backend-support-smoke',
      password: 'backend-smoke-secret'
    }
  })
  assert.equal(opsLogin.operator.id, 'backend-support-smoke')
  assert.equal(Boolean(opsLogin.token), true)
  const observerLogin = await request(`${baseUrl}/ops/login`, {
    method: 'POST',
    data: {
      accountId: 'backend-observer-smoke',
      password: 'backend-observer-secret'
    }
  })
  const rejectedObserverModeration = await requestExpectError(`${baseUrl}/ops/moderation-queue`, {
    method: 'GET',
    header: {
      'x-ops-session-token': observerLogin.token
    }
  })
  assert.equal(rejectedObserverModeration.status, 403)
  assert.equal(rejectedObserverModeration.code, 'FORBIDDEN')
  const rejectedObserverUsers = await requestExpectError(`${baseUrl}/ops/users`, {
    method: 'GET',
    header: {
      'x-ops-session-token': observerLogin.token
    }
  })
  assert.equal(rejectedObserverUsers.status, 403)
  assert.equal(rejectedObserverUsers.code, 'FORBIDDEN')
  const opsLoginAudit = await request(`${baseUrl}/ops/audit-events?action=ops.login&actorId=backend-support-smoke`, {
    method: 'GET',
    header: {
      'x-ops-session-token': opsLogin.token
    }
  })
  assert.equal(opsLoginAudit.events.some((event) =>
    event.action === 'ops.login' &&
    event.actorId === 'backend-support-smoke' &&
    event.targetType === 'ops_session'
  ), true)
  const opsModerationQueue = await request(`${baseUrl}/ops/moderation-queue`, {
    method: 'GET',
    header: {
      'x-ops-session-token': opsLogin.token
    }
  })
  assert.equal(opsModerationQueue.reports.some((candidate) => candidate.id === moderationRaceReport.id), true)
  const resolvedRaceReport = await request(`${baseUrl}/ops/reports/${moderationRaceReport.id}/resolve`, {
    method: 'POST',
    data: {
      resolution: 'dismiss_report',
      note: 'HTTP smoke 恢复误报商品'
    },
    header: {
      'x-ops-session-token': opsLogin.token,
      'Idempotency-Key': 'backend_report_resolve_key_001'
    }
  })
  assert.equal(resolvedRaceReport.status, 'rejected')
  assert.equal(resolvedRaceReport.resolution, 'dismiss_report')
  assert.equal(resolvedRaceReport.resolverId, 'backend-support-smoke')
  const replayedRaceReport = await request(`${baseUrl}/ops/reports/${moderationRaceReport.id}/resolve`, {
    method: 'POST',
    data: {
      resolution: 'dismiss_report',
      note: 'HTTP smoke 恢复误报商品'
    },
    header: {
      'x-ops-session-token': opsLogin.token,
      'Idempotency-Key': 'backend_report_resolve_key_001'
    }
  })
  assert.equal(replayedRaceReport.id, resolvedRaceReport.id)
  const reportResolveAudit = await request(`${baseUrl}/ops/audit-events?action=ops.report.resolve&targetId=${encodeURIComponent(moderationRaceReport.id)}`, {
    method: 'GET',
    header: {
      'x-ops-session-token': opsLogin.token
    }
  })
  const reportResolveAuditEvents = reportResolveAudit.events.filter((event) =>
    event.action === 'ops.report.resolve' &&
    event.targetId === moderationRaceReport.id
  )
  assert.equal(reportResolveAuditEvents.length, 1)
  assert.equal(reportResolveAuditEvents[0].actorId, 'backend-support-smoke')
  assert.equal(reportResolveAuditEvents[0].context.resolution, 'dismiss_report')
  const restoredRaceItem = await get(`${baseUrl}/items/${moderationRaceItem.id}`)
  assert.equal(restoredRaceItem.status, 'online')

  const riskSeller = await post(`${baseUrl}/auth/login`, {
    provider: 'weixin',
    code: 'backend-risk-seller-code',
    userInfo: {
      nickname: '后端风控卖家',
      avatarUrl: ''
    }
  })
  const riskBuyer = await post(`${baseUrl}/auth/login`, {
    provider: 'weixin',
    code: 'backend-risk-buyer-code',
    userInfo: {
      nickname: '后端风控买家',
      avatarUrl: ''
    }
  })
  const riskUpload = await uploadFile(`${baseUrl}/uploads/items`, uploadBytes, riskSeller.token)
  const riskItem = await post(`${baseUrl}/items`, {
    title: '后端风控封禁商品',
    price: 58,
    category: 'home',
    condition: 'good',
    description: '封禁卖家时应下架并冻结交易',
    images: [riskUpload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }, riskSeller.token)
  const riskTrade = await post(`${baseUrl}/trades`, {
    itemId: riskItem.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 60,
      capturedAt: Date.now()
    }
  }, riskBuyer.token)
  assert.equal(riskTrade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)
  const blockedRiskSeller = await request(`${baseUrl}/ops/users/${riskSeller.user.id}/status`, {
    method: 'POST',
    data: {
      status: 'blocked',
      reason: 'HTTP smoke 风控封禁'
    },
    header: {
      'x-ops-session-token': opsLogin.token,
      'Idempotency-Key': 'backend_user_block_key_001'
    }
  })
  assert.equal(blockedRiskSeller.user.status, 'blocked')
  assert.equal(blockedRiskSeller.affected.revokedSessions, 1)
  assert.equal(blockedRiskSeller.affected.removedItems, 1)
  assert.equal(blockedRiskSeller.affected.disputedTrades, 1)
  const replayedBlockedRiskSeller = await request(`${baseUrl}/ops/users/${riskSeller.user.id}/status`, {
    method: 'POST',
    data: {
      status: 'blocked',
      reason: 'HTTP smoke 风控封禁'
    },
    header: {
      'x-ops-session-token': opsLogin.token,
      'Idempotency-Key': 'backend_user_block_key_001'
    }
  })
  assert.equal(replayedBlockedRiskSeller.affected.removedItems, 1)
  const blockedUsers = await request(`${baseUrl}/ops/users?status=blocked`, {
    method: 'GET',
    header: {
      'x-ops-session-token': opsLogin.token
    }
  })
  assert.equal(blockedUsers.users.some((user) => user.id === riskSeller.user.id), true)
  const rejectedBlockedUserToken = await getExpectError(`${baseUrl}/items/mine`, riskSeller.token)
  assert.equal(rejectedBlockedUserToken.status, 401)
  const riskItemAfterBlock = await getExpectError(`${baseUrl}/items/${riskItem.id}`)
  assert.equal(riskItemAfterBlock.status, 404)
  const riskBuyerTrades = await get(`${baseUrl}/trades`, riskBuyer.token)
  assert.equal(riskBuyerTrades.trades.find((candidate) => candidate.id === riskTrade.id).status, TRADE_STATUS.DISPUTED)
  const userStatusAudit = await request(`${baseUrl}/ops/audit-events?action=ops.user.status&targetId=${encodeURIComponent(riskSeller.user.id)}`, {
    method: 'GET',
    header: {
      'x-ops-session-token': opsLogin.token
    }
  })
  assert.equal(userStatusAudit.events.filter((event) => event.action === 'ops.user.status').length, 1)
  const unblockedRiskSeller = await request(`${baseUrl}/ops/users/${riskSeller.user.id}/status`, {
    method: 'POST',
    data: {
      status: 'active',
      reason: 'HTTP smoke 误封恢复'
    },
    header: {
      'x-ops-session-token': opsLogin.token
    }
  })
  assert.equal(unblockedRiskSeller.user.status, 'active')
  assert.equal(unblockedRiskSeller.user.unblockedBy, 'backend-support-smoke')

  const clientEventResult = await post(`${baseUrl}/telemetry/client-events`, {
    type: 'publish_submit_failed',
    level: 'error',
    code: 'CONTENT_REJECTED',
    message: 'backend smoke client telemetry',
    route: 'pages/publish/publish',
    context: {
      step: 'submit',
      longitude: 121.45,
      safeField: 'kept'
    }
  }, buyer.token)
  assert.equal(clientEventResult.accepted, 1)
  const rejectedClientEvents = await requestExpectError(`${baseUrl}/ops/client-events?level=error`, {
    method: 'GET'
  })
  assert.equal(rejectedClientEvents.status, 401)
  assert.equal(rejectedClientEvents.code, 'UNAUTHENTICATED')
  const rejectedAuditEvents = await requestExpectError(`${baseUrl}/ops/audit-events`, {
    method: 'GET'
  })
  assert.equal(rejectedAuditEvents.status, 401)
  assert.equal(rejectedAuditEvents.code, 'UNAUTHENTICATED')
  const opsClientEvents = await request(`${baseUrl}/ops/client-events?level=error`, {
    method: 'GET',
    header: {
      'x-moderation-secret': 'backend-smoke-secret'
    }
  })
  assert.equal(opsClientEvents.events.some((event) =>
    event.type === 'publish_submit_failed' &&
    event.userId === buyer.user.id &&
    event.context.safeField === 'kept' &&
    event.context.longitude === undefined
  ), true)

  const list = await get(`${baseUrl}/items?latitude=31.2301&longitude=121.4556&accuracy=60&capturedAt=${Date.now()}`)
  assert.equal(list.items.some((candidate) => candidate.id === item.id), true)
  assert.equal(Number.isFinite(Number(list.items.find((candidate) => candidate.id === item.id).distanceMeters)), true)

  const trade = await post(`${baseUrl}/trades`, {
    itemId: item.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 60,
      capturedAt: Date.now()
    }
  }, buyer.token)

  assert.equal(trade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)
  assert.equal(trade.contactCode, '')
  const sellerNotifications = await get(`${baseUrl}/notifications`, seller.token)
  assert.equal(sellerNotifications.notifications[0].type, 'trade_created')
  assert.equal(sellerNotifications.notifications[0].targetId, trade.id)
  await waitFor(() => deliveredPlatformNotifications.some((notification) =>
    notification.type === 'trade_created' &&
    notification.targetId === trade.id &&
    notification.userId === seller.user.id
  ))
  const readSellerNotification = await patch(`${baseUrl}/notifications/${sellerNotifications.notifications[0].id}/read`, {}, seller.token)
  assert.equal(Boolean(readSellerNotification.readAt), true)

  const confirmed = await patch(`${baseUrl}/trades/${trade.id}/status`, {
    status: TRADE_STATUS.PENDING_MEETUP
  }, seller.token, {
    header: {
      'Idempotency-Key': 'backend_trade_confirm_key_001'
    }
  })
  const replayedConfirmed = await patch(`${baseUrl}/trades/${trade.id}/status`, {
    status: TRADE_STATUS.PENDING_MEETUP
  }, seller.token, {
    header: {
      'Idempotency-Key': 'backend_trade_confirm_key_001'
    }
  })

  assert.equal(confirmed.status, TRADE_STATUS.PENDING_MEETUP)
  assert.equal(replayedConfirmed.contactCode, confirmed.contactCode)
  assert.match(confirmed.contactCode, /^GC-[A-F0-9]{6}-[A-Z0-9]{4}$/)
  assert.notEqual(confirmed.contactCode, seller.user.contactCode)
  assert.equal(confirmed.contactCodeExpiresAt > Date.now(), true)
  await expireTradeContactCodeInStateFile(statePath, trade.id)
  const duplicateTradeAfterContactExpiry = await post(`${baseUrl}/trades`, {
    itemId: item.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 60,
      capturedAt: Date.now()
    }
  }, buyer.token)
  assert.equal(duplicateTradeAfterContactExpiry.id, trade.id)
  assert.equal(duplicateTradeAfterContactExpiry.contactCode, '')
  assert.equal(duplicateTradeAfterContactExpiry.contactCodeExpiresAt, null)
  const replayedConfirmedAfterContactExpiry = await patch(`${baseUrl}/trades/${trade.id}/status`, {
    status: TRADE_STATUS.PENDING_MEETUP
  }, seller.token, {
    header: {
      'Idempotency-Key': 'backend_trade_confirm_key_001'
    }
  })
  assert.equal(replayedConfirmedAfterContactExpiry.contactCode, '')
  assert.equal(replayedConfirmedAfterContactExpiry.contactCodeExpiresAt, null)
  const buyerNotifications = await get(`${baseUrl}/notifications`, buyer.token)
  assert.equal(buyerNotifications.notifications[0].type, 'trade_confirmed')
  assert.equal(buyerNotifications.notifications[0].targetId, trade.id)
  assert.equal(buyerNotifications.notifications.filter((notification) => notification.type === 'trade_confirmed' && notification.targetId === trade.id).length, 1)
  await waitFor(() => deliveredPlatformNotifications.some((notification) =>
    notification.type === 'trade_confirmed' &&
    notification.targetId === trade.id &&
    notification.userId === buyer.user.id
  ))
  const prematureReview = await postExpectError(`${baseUrl}/trades/${trade.id}/review`, {
    rating: 5,
    content: '未完成前不能评价'
  }, buyer.token)
  assert.equal(prematureReview.status, 409)
  assert.equal(prematureReview.code, 'CONFLICT')
  assert.match(prematureReview.message, /交易完成后才能评价/)

  const completed = await patch(`${baseUrl}/trades/${trade.id}/status`, {
    status: TRADE_STATUS.COMPLETED
  }, buyer.token)

  assert.equal(completed.status, TRADE_STATUS.COMPLETED)
  assert.equal(completed.contactCode, '')
  assert.equal(completed.contactCodeExpiresAt, null)
  const sellerNotificationsAfterComplete = await get(`${baseUrl}/notifications`, seller.token)
  assert.equal(sellerNotificationsAfterComplete.notifications.some((notification) => notification.type === 'trade_completed'), true)
  const reviewPayload = {
    rating: 5,
    content: 'HTTP 交易顺利',
    tags: ['准时', '物品一致']
  }
  const review = await post(`${baseUrl}/trades/${trade.id}/review`, reviewPayload, buyer.token, {
    header: {
      'Idempotency-Key': 'backend_trade_review_key_001'
    }
  })
  const replayedReview = await post(`${baseUrl}/trades/${trade.id}/review`, reviewPayload, buyer.token, {
    header: {
      'Idempotency-Key': 'backend_trade_review_key_001'
    }
  })
  assert.equal(review.tradeId, trade.id)
  assert.equal(replayedReview.id, review.id)
  assert.equal(review.itemId, item.id)
  assert.equal(review.reviewee.id, seller.user.id)
  const itemReviews = await get(`${baseUrl}/reviews?itemId=${encodeURIComponent(item.id)}`)
  assert.equal(itemReviews.reviews[0].id, review.id)
  const duplicateReview = await postExpectError(`${baseUrl}/trades/${trade.id}/review`, {
    rating: 4,
    content: 'HTTP 重复评价'
  }, buyer.token)
  assert.equal(duplicateReview.status, 409)
  assert.equal(duplicateReview.code, 'CONFLICT')
  assert.match(duplicateReview.message, /不能重复评价/)
  const buyerTradesAfterReview = await get(`${baseUrl}/trades`, buyer.token)
  assert.equal(buyerTradesAfterReview.trades.find((candidate) => candidate.id === trade.id).reviewedByMe, true)
  const sellerNotificationsAfterReview = await get(`${baseUrl}/notifications`, seller.token)
  assert.equal(sellerNotificationsAfterReview.notifications.some((notification) => notification.type === 'trade_reviewed'), true)
  await waitFor(() => deliveredPlatformNotifications.some((notification) =>
    notification.type === 'trade_reviewed' &&
    notification.targetId === trade.id &&
    notification.status === 'failed'
  ))
  const failedDeliveryList = await request(`${baseUrl}/ops/notification-deliveries?status=failed`, {
    method: 'GET',
    header: {
      'x-moderation-secret': 'backend-smoke-secret'
    }
  })
  const failedReviewDelivery = failedDeliveryList.deliveries.find((delivery) => delivery.type === 'trade_reviewed')
  assert.equal(Boolean(failedReviewDelivery), true)
  assert.equal(failedReviewDelivery.status, 'failed')
  assert.equal(failedReviewDelivery.attemptCount, 1)
  failedPlatformNotificationTypes.delete('trade_reviewed')
  const retryDeliveries = await request(`${baseUrl}/ops/notification-deliveries/retry`, {
    method: 'POST',
    data: {
      ids: [failedReviewDelivery.id],
      force: true
    },
    header: {
      'x-moderation-secret': 'backend-smoke-secret'
    }
  })
  assert.equal(retryDeliveries.retried, 1)
  assert.equal(retryDeliveries.deliveries[0].id, failedReviewDelivery.id)
  assert.equal(retryDeliveries.deliveries[0].status, 'mock_sent')
  assert.equal(retryDeliveries.deliveries[0].attemptCount, 2)
  const retryAudit = await request(`${baseUrl}/ops/audit-events?action=ops.notification.retry&targetId=${encodeURIComponent(failedReviewDelivery.id)}`, {
    method: 'GET',
    header: {
      'x-moderation-secret': 'backend-smoke-secret'
    }
  })
  assert.equal(retryAudit.events.some((event) =>
    event.action === 'ops.notification.retry' &&
    event.targetId === failedReviewDelivery.id &&
    String(event.context.retried) === '1'
  ), true)

  const disputeItem = await post(`${baseUrl}/items`, {
    title: '后端争议商品',
    price: 76,
    category: 'home',
    condition: 'good',
    description: '通过真实 HTTP 后端验证争议处理',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }, seller.token)
  const disputeTrade = await post(`${baseUrl}/trades`, {
    itemId: disputeItem.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 60,
      capturedAt: Date.now()
    }
  }, buyer.token)
  await patch(`${baseUrl}/trades/${disputeTrade.id}/status`, {
    status: TRADE_STATUS.PENDING_MEETUP
  }, seller.token)
  const disputedTrade = await patch(`${baseUrl}/trades/${disputeTrade.id}/status`, {
    status: TRADE_STATUS.DISPUTED
  }, buyer.token)
  assert.equal(disputedTrade.status, TRADE_STATUS.DISPUTED)
  assert.equal(disputedTrade.disputeCase.status, 'open')
  const backendDisputes = await get(`${baseUrl}/disputes`, seller.token)
  const backendDispute = backendDisputes.disputes.find((candidate) => candidate.tradeId === disputeTrade.id)
  assert.equal(backendDispute.status, 'open')
  const resolvedBackendDispute = await request(`${baseUrl}/moderation/disputes/${backendDispute.id}/resolve`, {
    method: 'POST',
    data: {
      resolution: 'release_item',
      actorId: 'backend-support-smoke',
      note: 'HTTP smoke 释放商品'
    },
    header: {
      'x-moderation-secret': 'backend-smoke-secret'
    }
  })
  assert.equal(resolvedBackendDispute.status, 'resolved')
  assert.equal(resolvedBackendDispute.resolution, 'release_item')
  const disputeAudit = await request(`${baseUrl}/ops/audit-events?action=ops.dispute.resolve&targetId=${encodeURIComponent(backendDispute.id)}`, {
    method: 'GET',
    header: {
      'x-moderation-secret': 'backend-smoke-secret'
    }
  })
  assert.equal(disputeAudit.events.some((event) =>
    event.action === 'ops.dispute.resolve' &&
    event.targetId === backendDispute.id &&
    event.context.resolution === 'release_item'
  ), true)
  const buyerTradesAfterDispute = await get(`${baseUrl}/trades`, buyer.token)
  const releasedBackendTrade = buyerTradesAfterDispute.trades.find((candidate) => candidate.id === disputeTrade.id)
  assert.equal(releasedBackendTrade.status, TRADE_STATUS.CANCELLED)
  assert.equal(releasedBackendTrade.disputeCase.status, 'resolved')
  const sellerNotificationsAfterDispute = await get(`${baseUrl}/notifications`, seller.token)
  assert.equal(sellerNotificationsAfterDispute.notifications.some((notification) => notification.type === 'trade_dispute_resolved'), true)
  await waitFor(() => deliveredPlatformNotifications.some((notification) =>
    notification.type === 'trade_dispute_resolved' &&
    notification.targetId === disputeTrade.id
  ))
  const publicAfterSold = await get(`${baseUrl}/items?latitude=31.2301&longitude=121.4556&accuracy=60&capturedAt=${Date.now()}`)
  assert.equal(publicAfterSold.items.some((candidate) => candidate.id === item.id), false)

  const deleteSeller = await post(`${baseUrl}/auth/login`, {
    provider: 'weixin',
    code: 'backend-delete-seller-code',
    userInfo: {
      nickname: '后端待注销卖家',
      avatarUrl: ''
    }
  })
  const deleteUpload = await uploadFile(`${baseUrl}/uploads/items`, uploadBytes, deleteSeller.token)
  const deleteItem = await post(`${baseUrl}/items`, {
    title: '后端注销卖家商品',
    price: 51,
    category: 'home',
    condition: 'good',
    description: '卖家注销后应下架商品并吊销登录态',
    images: [deleteUpload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }, deleteSeller.token)
  assert.equal(deleteItem.status, ITEM_STATUS.ONLINE)
  const deletedSellerAccount = await post(`${baseUrl}/auth/delete-account`, {
    reason: 'backend_smoke_seller_requested'
  }, deleteSeller.token)
  assert.equal(deletedSellerAccount.ok, true)
  assert.equal(Boolean(deletedSellerAccount.deletedAt), true)
  const rejectedDeletedSellerToken = await getExpectError(`${baseUrl}/items/mine`, deleteSeller.token)
  assert.equal(rejectedDeletedSellerToken.status, 401)
  assert.equal(rejectedDeletedSellerToken.code, 'UNAUTHENTICATED')
  const hiddenDeletedSellerItem = await getExpectError(`${baseUrl}/items/${deleteItem.id}`)
  assert.equal(hiddenDeletedSellerItem.status, 404)
  assert.equal(hiddenDeletedSellerItem.code, 'NOT_FOUND')

  const deleteBuyer = await post(`${baseUrl}/auth/login`, {
    provider: 'weixin',
    code: 'backend-delete-buyer-code',
    userInfo: {
      nickname: '后端待注销买家',
      avatarUrl: ''
    }
  })
  const buyerDeletionItem = await post(`${baseUrl}/items`, {
    title: '后端买家注销释放商品',
    price: 52,
    category: 'home',
    condition: 'good',
    description: '买家注销后应取消交易并释放锁定商品',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: sellerLocation
  }, seller.token)
  assert.equal(buyerDeletionItem.status, ITEM_STATUS.ONLINE)
  const buyerDeletionTrade = await post(`${baseUrl}/trades`, {
    itemId: buyerDeletionItem.id,
    buyerLocation: {
      latitude: 31.2301,
      longitude: 121.4556,
      accuracy: 60,
      capturedAt: Date.now()
    }
  }, deleteBuyer.token)
  assert.equal(buyerDeletionTrade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)
  const deletedBuyerAccount = await post(`${baseUrl}/auth/delete-account`, {
    reason: 'backend_smoke_buyer_requested'
  }, deleteBuyer.token)
  assert.equal(deletedBuyerAccount.ok, true)
  const rejectedDeletedBuyerToken = await getExpectError(`${baseUrl}/trades`, deleteBuyer.token)
  assert.equal(rejectedDeletedBuyerToken.status, 401)
  assert.equal(rejectedDeletedBuyerToken.code, 'UNAUTHENTICATED')
  const sellerTradesAfterBuyerDeletion = await get(`${baseUrl}/trades`, seller.token)
  const cancelledBuyerDeletionTrade = sellerTradesAfterBuyerDeletion.trades.find((candidate) => candidate.id === buyerDeletionTrade.id)
  assert.equal(cancelledBuyerDeletionTrade.status, TRADE_STATUS.CANCELLED)
  assert.equal(cancelledBuyerDeletionTrade.contactCode, '')
  const releasedBuyerDeletionItem = await get(`${baseUrl}/items/${buyerDeletionItem.id}`)
  assert.equal(releasedBuyerDeletionItem.status, ITEM_STATUS.ONLINE)
  const sellerNotificationsAfterBuyerDeletion = await get(`${baseUrl}/notifications`, seller.token)
  assert.equal(sellerNotificationsAfterBuyerDeletion.notifications.some((notification) =>
    notification.type === 'trade_cancelled' &&
    notification.targetId === buyerDeletionTrade.id
  ), true)

  const logout = await post(`${baseUrl}/auth/logout`, {}, buyer.token)
  assert.equal(logout.ok, true)
  const rejected = await getExpectError(`${baseUrl}/trades`, buyer.token)
  assert.match(rejected.message, /登录态无效/)
  assert.equal(rejected.code, 'UNAUTHENTICATED')
  assert.equal(rejected.status, 401)
  assert.equal(Boolean(rejected.trace?.traceId), true)
  assert.equal(rejected.traceId, rejected.trace.traceId)

  console.log('Backend HTTP smoke checks passed')
} finally {
  await new Promise((resolveClose) => runtime.server.close(resolveClose))
}

async function assertHttpRateLimit() {
  const rateLimitStatePath = resolve('/private/tmp/goods-comm-backend-rate-limit-smoke.json')
  const rateLimitObjectRootDir = resolve('/private/tmp/goods-comm-backend-rate-limit-object-store-smoke')

  await rm(rateLimitStatePath, {
    force: true
  })
  await rm(rateLimitObjectRootDir, {
    recursive: true,
    force: true
  })

  const limitedRuntime = await startGoodsCommServer({
    port: 0,
    environment: 'test',
    statePath: rateLimitStatePath,
    objectRootDir: rateLimitObjectRootDir,
    allowedOrigins: [allowedOrigin],
    rateLimitMaxRequests: 2,
    rateLimitWindowMs: 60_000
  })

  try {
    const health = await getEnvelope(`${limitedRuntime.url}/health`, {
      origin: allowedOrigin
    })
    assert.equal(health.status, 200)
    assert.equal(health.payload.data.rateLimit.maxRequests, 2)
    assert.equal(health.payload.data.rateLimit.windowMs, 60_000)

    const first = await getEnvelope(`${limitedRuntime.url}/items`, {
      origin: allowedOrigin,
      header: {
        'x-forwarded-for': '203.0.113.10'
      }
    })
    assert.equal(first.status, 200)

    const second = await getEnvelope(`${limitedRuntime.url}/items`, {
      origin: allowedOrigin,
      header: {
        'x-forwarded-for': '203.0.113.11'
      }
    })
    assert.equal(second.status, 200)

    const limited = await requestExpectError(`${limitedRuntime.url}/items`, {
      method: 'GET',
      origin: allowedOrigin,
      header: {
        'x-forwarded-for': '203.0.113.12'
      }
    })
    assert.equal(limited.status, 429)
    assert.equal(limited.code, 'TOO_MANY_REQUESTS')
    assert.match(limited.message, /请求过于频繁/)
  } finally {
    await new Promise((resolveClose) => limitedRuntime.server.close(resolveClose))
    await rm(rateLimitStatePath, {
      force: true
    })
    await rm(rateLimitObjectRootDir, {
      recursive: true,
      force: true
    })
  }
}

async function assertTrustedProxyForwardedRateLimit() {
  const trustedProxyStatePath = resolve('/private/tmp/goods-comm-backend-trusted-proxy-rate-limit-smoke.json')
  const trustedProxyObjectRootDir = resolve('/private/tmp/goods-comm-backend-trusted-proxy-rate-limit-object-store-smoke')

  await rm(trustedProxyStatePath, {
    force: true
  })
  await rm(trustedProxyObjectRootDir, {
    recursive: true,
    force: true
  })

  const trustedRuntime = await startGoodsCommServer({
    port: 0,
    environment: 'test',
    statePath: trustedProxyStatePath,
    objectRootDir: trustedProxyObjectRootDir,
    allowedOrigins: [allowedOrigin],
    rateLimitMaxRequests: 1,
    rateLimitWindowMs: 60_000,
    trustedProxyIps: '127.0.0.1,::1'
  })

  try {
    const health = await getEnvelope(`${trustedRuntime.url}/health`, {
      origin: allowedOrigin
    })
    assert.equal(health.status, 200)
    assert.equal(health.payload.data.rateLimit.maxRequests, 1)
    assert.equal(health.payload.data.rateLimit.trustedProxyCount, 2)

    const firstClient = await getEnvelope(`${trustedRuntime.url}/items`, {
      origin: allowedOrigin,
      header: {
        'x-forwarded-for': '203.0.113.20'
      }
    })
    assert.equal(firstClient.status, 200)

    const secondClient = await getEnvelope(`${trustedRuntime.url}/items`, {
      origin: allowedOrigin,
      header: {
        'x-forwarded-for': '203.0.113.21'
      }
    })
    assert.equal(secondClient.status, 200)

    const limitedFirstClient = await requestExpectError(`${trustedRuntime.url}/items`, {
      method: 'GET',
      origin: allowedOrigin,
      header: {
        'x-forwarded-for': '203.0.113.20'
      }
    })
    assert.equal(limitedFirstClient.status, 429)
    assert.equal(limitedFirstClient.code, 'TOO_MANY_REQUESTS')
  } finally {
    await new Promise((resolveClose) => trustedRuntime.server.close(resolveClose))
    await rm(trustedProxyStatePath, {
      force: true
    })
    await rm(trustedProxyObjectRootDir, {
      recursive: true,
      force: true
    })
  }
}

async function assertProtectedSecurityHeaders() {
  const protectedStatePath = resolve('/private/tmp/goods-comm-backend-protected-security-smoke.json')
  const protectedObjectRootDir = resolve('/private/tmp/goods-comm-backend-protected-security-object-store-smoke')

  await rm(protectedStatePath, {
    force: true
  })
  await rm(protectedObjectRootDir, {
    recursive: true,
    force: true
  })

  const protectedRuntime = await startGoodsCommServer({
    port: 0,
    environment: 'pre',
    allowedOrigins: ['https://pre.goods-comm.example.com'],
    storeType: 'file',
    statePath: protectedStatePath,
    allowUnsafeFileStore: true,
    objectStoreType: 'local',
    objectRootDir: protectedObjectRootDir,
    allowUnsafeLocalStore: true,
    authMode: 'demo',
    allowDemoAuth: true,
    contentSafetyProvider: 'mock',
    allowMockContentSafety: true,
    mapProvider: 'mock',
    allowSampleRegion: true,
    notifyProvider: 'mock',
    allowMockPlatformNotify: true
  })

  try {
    const health = await getEnvelope(`${protectedRuntime.url}/health`, {
      traceId: 'trace_backend_protected_security_smoke'
    })
    assert.equal(health.status, 200)
    assert.equal(health.payload.data.environment, 'pre')
    assertSecurityHeaders(health.securityHeaders, {
      hsts: true
    })
  } finally {
    protectedRuntime.server.close()
    await rm(protectedStatePath, {
      force: true
    })
    await rm(protectedObjectRootDir, {
      recursive: true,
      force: true
    })
  }
}

async function get(url, token = '') {
  return request(url, {
    method: 'GET',
    token
  })
}

async function post(url, data, token = '', options = {}) {
  return request(url, {
    method: 'POST',
    data,
    token,
    ...options
  })
}

async function patch(url, data, token = '', options = {}) {
  return request(url, {
    method: 'PATCH',
    data,
    token,
    ...options
  })
}

async function getExpectError(url, token = '') {
  return requestExpectError(url, {
    method: 'GET',
    token
  })
}

async function postExpectError(url, data, token = '') {
  return requestExpectError(url, {
    method: 'POST',
    data,
    token
  })
}

async function uploadFile(url, bytes, token = '') {
  const parsedUrl = new URL(url)
  const boundary = `goods-comm-boundary-${Date.now()}`
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="usage"\r\n\r\nitem_image\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="smoke-item.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])

  return new Promise((resolveUpload, rejectUpload) => {
    const request = httpRequest({
      method: 'POST',
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': body.length,
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))

        if (response.statusCode < 200 || response.statusCode >= 300) {
          rejectUpload(new Error(payload.message || `HTTP ${response.statusCode}`))
          return
        }

        resolveUpload(payload.data)
      })
    })

    request.on('error', rejectUpload)
    request.end(body)
  })
}

async function request(url, options = {}) {
  const envelope = await requestEnvelope(url, options)

  if (envelope.response.ok) {
    return envelope.payload.data
  }

  throw new Error(envelope.payload.message || `HTTP ${envelope.status}`)
}

async function expireTradeContactCodeInStateFile(path, tradeId) {
  const state = JSON.parse(await readFile(path, 'utf8'))
  const trade = state.trades.find((candidate) => candidate.id === tradeId)

  assert.ok(trade, `missing trade ${tradeId} in file state`)
  trade.contactCodeExpiresAt = Date.now() - 1

  await writeFile(path, JSON.stringify(state, null, 2))
}

async function requestExpectError(url, options = {}) {
  const envelope = await requestEnvelope(url, options)

  assert.equal(envelope.response.ok, false)

  return {
    ...envelope.payload,
    status: envelope.status,
    traceId: envelope.traceId
  }
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }

  assert.equal(predicate(), true)
}

async function getEnvelope(url, options = {}) {
  const envelope = await requestEnvelope(url, {
    ...options,
    method: 'GET'
  })

  return {
    ...envelope,
    response: undefined
  }
}

async function optionsEnvelope(url, origin) {
  const envelope = await requestEnvelope(url, {
    method: 'OPTIONS',
    origin,
    preflightMethod: 'POST'
  })

  return {
    ...envelope,
    response: undefined
  }
}

async function requestEnvelope(url, options = {}) {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.traceId ? { 'x-trace-id': options.traceId } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.preflightMethod ? { 'access-control-request-method': options.preflightMethod } : {}),
      ...options.header
    },
    body: ['GET', 'OPTIONS'].includes(options.method) ? undefined : JSON.stringify(options.data || {})
  })
  const body = await response.text()
  const payload = body ? JSON.parse(body) : null

  return {
    response,
    status: response.status,
    payload,
    traceId: response.headers.get('x-trace-id'),
    corsOrigin: response.headers.get('access-control-allow-origin'),
    vary: response.headers.get('vary'),
    securityHeaders: {
      xContentTypeOptions: response.headers.get('x-content-type-options'),
      xFrameOptions: response.headers.get('x-frame-options'),
      referrerPolicy: response.headers.get('referrer-policy'),
      permissionsPolicy: response.headers.get('permissions-policy'),
      strictTransportSecurity: response.headers.get('strict-transport-security')
    }
  }
}

function assertSecurityHeaders(headers = {}, options = {}) {
  assert.equal(headers.xContentTypeOptions, 'nosniff')
  assert.equal(headers.xFrameOptions, 'DENY')
  assert.equal(headers.referrerPolicy, 'no-referrer')
  assert.equal(headers.permissionsPolicy, 'geolocation=(), camera=(), microphone=()')

  if (options.hsts === false) {
    assert.equal(headers.strictTransportSecurity, null)
  } else if (options.hsts === true) {
    assert.equal(headers.strictTransportSecurity, 'max-age=15552000; includeSubDomains')
  }
}
