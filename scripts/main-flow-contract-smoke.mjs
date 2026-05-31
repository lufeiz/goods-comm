import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const files = await readFiles([
  'package.json',
  'scripts/verify-release-gate.mjs',
  'scripts/bff-smoke.mjs',
  'scripts/bff-fetch-smoke.mjs',
  'scripts/backend-smoke.mjs',
  'scripts/deployed-main-flow-smoke.mjs',
  'src/bff/handler.js',
  'src/components/GoodCard.vue',
  'src/components/LocationGuard.vue',
  'src/pages/detail/detail.vue',
  'src/pages/home/home.vue',
  'src/pages/mine/mine.vue',
  'src/pages/orders/orders.vue',
  'src/pages/ops/ops.vue',
  'src/pages/publish/publish.vue',
  'src/services/auth.js',
  'src/services/compliance.js',
  'src/services/goods.js',
  'src/services/location.js',
  'src/services/media.js',
  'src/services/ops.js'
])

const flows = [
  {
    name: 'login agreement and account lifecycle',
    evidence: [
      {
        file: 'src/pages/mine/mine.vue',
        tokens: [
          'data-testid="mine-login-button"',
          'data-testid="mine-logout-button"',
          'data-testid="mine-agreement-toggle"',
          'loginWithPlatformProfile',
          'loginWithUserInfo',
          'logoutAuthSession',
          'deleteAuthAccount'
        ]
      },
      {
        file: 'src/services/auth.js',
        tokens: [
          "requestApi('/auth/login'",
          "requestApi('/auth/logout'",
          "requestApi('/auth/delete-account'",
          'contactCode',
          'sessionExpiresAt'
        ]
      },
      {
        file: 'src/services/compliance.js',
        tokens: [
          'USER_AGREEMENT_VERSION',
          'acceptUserAgreement',
          'hasAcceptedUserAgreement',
          'requireUserAgreement'
        ]
      },
      {
        file: 'src/bff/handler.js',
        tokens: [
          "path === '/auth/login' && method === 'POST'",
          "path === '/auth/logout' && method === 'POST'",
          "path === '/auth/delete-account' && method === 'POST'",
          'tokenHash',
          'lastSeenAt',
          'revokedAt'
        ]
      },
      {
        file: 'scripts/deployed-main-flow-smoke.mjs',
        tokens: [
          "post('/auth/login'",
          "post('/auth/logout'",
          "post('/auth/delete-account'",
          'revokedDeletedToken',
          'revoked buyer token'
        ]
      }
    ]
  },
  {
    name: 'location resolution and display trust boundary',
    evidence: [
      {
        file: 'src/components/LocationGuard.vue',
        tokens: [
          'data-testid="location-guard"',
          'data-testid="location-refresh"',
          'data-testid="location-choose"',
          'data-testid="location-error"',
          'qualityText'
        ]
      },
      {
        file: 'src/pages/home/home.vue',
        tokens: [
          'LocationGuard',
          'getLocationProfile',
          'chooseLocationProfile',
          'currentLocation: this.locationProfile?.location'
        ]
      },
      {
        file: 'src/pages/detail/detail.vue',
        tokens: [
          'isFinalTradeLocationProfile',
          'verifyTradeEligibility',
          '发起交易会重新使用实时 GPS 定位做最终校验'
        ]
      },
      {
        file: 'src/services/location.js',
        tokens: [
          "requestApi('/lbs/resolve-region'",
          'assertLocationQuality',
          'isLocationExpired',
          'isLocationAccuracyUsable',
          'LOCATION_DENIED',
          'LOCATION_TIMEOUT',
          'LOCATION_REGION_FAILED'
        ]
      },
      {
        file: 'scripts/deployed-main-flow-smoke.mjs',
        tokens: [
          'GOODS_COMM_SMOKE_LATITUDE',
          'GOODS_COMM_SMOKE_LONGITUDE',
          "post('/lbs/resolve-region'",
          'capturedAt: smokeCapturedAt.value',
          'accuracy.value'
        ]
      },
      {
        file: 'src/bff/handler.js',
        tokens: [
          'locationRiskEvents',
          'IMPOSSIBLE_TRAVEL',
          "type: 'location_risk'",
          'recordTrustedLocationUse'
        ]
      },
      {
        file: 'scripts/bff-smoke.mjs',
        tokens: [
          'location_risk_prior_seller',
          "event.type === 'location_risk'",
          "event.code === 'IMPOSSIBLE_TRAVEL'",
          "'/ops/location-risk-events'",
          'opsLocationRiskEvents'
        ]
      },
      {
        file: 'src/services/ops.js',
        tokens: [
          'fetchLocationRiskEvents',
          "'/ops/location-risk-events'",
          'normalizeLocationRiskFilters',
          'reviewLocationRiskEvent',
          'normalizeLocationRiskReviewPayload'
        ]
      },
      {
        file: 'src/pages/ops/ops.vue',
        tokens: [
          'fetchLocationRiskEvents',
          'reviewLocationRiskEvent',
          'ops-location-risk-panel',
          'ops-location-risk-card',
          'prefillLocationRisk',
          'reviewLocationRisk',
          'ops-location-risk-confirm'
        ]
      }
    ]
  },
  {
    name: 'authenticated publish and media upload',
    evidence: [
      {
        file: 'src/pages/publish/publish.vue',
        tokens: [
          'data-testid="publish-submit"',
          'requireStoredAuthUser',
          'requireUserAgreement',
          'uploadItemImages',
          'submitGoods',
          '请至少添加 1 张物品照片'
        ]
      },
      {
        file: 'src/services/media.js',
        tokens: [
          "uploadApiFile('/uploads/items'",
          "usage: 'item_image'",
          'isTrustedUploadedImageReference'
        ]
      },
      {
        file: 'src/services/goods.js',
        tokens: [
          "requestApi('/items'",
          "createIdempotencyKey('item_create'",
          'normalizePublishIdempotencyPayload',
          'reviewLocalItemContent'
        ]
      },
      {
        file: 'src/bff/handler.js',
        tokens: [
          "path === '/uploads/items' && method === 'UPLOAD'",
          "path === '/items' && method === 'POST'",
          'sellerOpenid',
          'contentSafetyOpenid',
          'pending_media_review'
        ]
      },
      {
        file: 'scripts/deployed-main-flow-smoke.mjs',
        tokens: [
          'uploadSmokeImageExpectError',
          'uploadSmokeImage(seller.token)',
          "post('/items'",
          'idempotencyKeys.itemCreate',
          'assertNoReviewIdentityFields'
        ]
      }
    ]
  },
  {
    name: 'trade selling lifecycle and privacy',
    evidence: [
      {
        file: 'src/pages/detail/detail.vue',
        tokens: [
          'data-testid="detail-start-trade"',
          'submitTradeIntent',
          'canStartTrade',
          'tradeButtonText'
        ]
      },
      {
        file: 'src/pages/orders/orders.vue',
        tokens: [
          'data-testid="orders-trade-action"',
          'data-testid="orders-trade-contact"',
          'data-testid="orders-review-submit"',
          'changeTradeStatus',
          'getTradeContactText',
          'submitTradeReview'
        ]
      },
      {
        file: 'src/services/goods.js',
        tokens: [
          "requestApi('/trades'",
          'requestApi(`/trades/${tradeId}/status`',
          'requestApi(`/trades/${tradeId}/review`',
          "createIdempotencyKey('trade_create'",
          "createIdempotencyKey('trade_status'",
          "createIdempotencyKey('trade_review'",
          'TRADE_STATUS.COMPLETED',
          'createTradeContactCode'
        ]
      },
      {
        file: 'scripts/bff-smoke.mjs',
        tokens: [
          'assert.match(confirmed.contactCode',
          'assert.notEqual(confirmed.contactCode, sellerSession.user.contactCode)',
          'duplicateTradeAfterContactExpiry',
          'contactCodeExpiresAt',
          'TRADE_STATUS.COMPLETED'
        ]
      },
      {
        file: 'scripts/deployed-main-flow-smoke.mjs',
        tokens: [
          "post('/trades'",
          'selfPurchaseTradeError',
          'duplicateActiveTrade',
          'assertOneTimeContactCode',
          'assertTradeContactHidden',
          'postSoldTradeError',
          "post(`/trades/${trade.id}/review`",
          'sold item still appears in public list'
        ]
      }
    ]
  },
  {
    name: 'release gate main-flow verification wiring',
    evidence: [
      {
        file: 'package.json',
        tokens: [
          '"smoke:location-permissions": "node scripts/location-permission-smoke.mjs"',
          '"smoke:main-flow-contract": "node scripts/main-flow-contract-smoke.mjs"',
          '"smoke:deployed:local-main": "node scripts/deployed-main-flow-local-smoke.mjs"',
          '"smoke:deployed:pre:main": "node scripts/deployed-main-flow-smoke.mjs --env pre"',
          '"smoke:deployed:prod:main": "node scripts/deployed-main-flow-smoke.mjs --env prod"'
        ]
      },
      {
        file: 'scripts/verify-release-gate.mjs',
        tokens: [
          "'smoke:location-permissions'",
          "'smoke:main-flow-contract'",
          "'smoke:pages'",
          "'smoke:bff'",
          "'smoke:bff:fetch'",
          "steps.push(npmStep('smoke:deployed:local-main'))",
          "name: 'smoke:artifacts'"
        ]
      },
      {
        file: 'scripts/backend-smoke.mjs',
        tokens: [
          "post(`${baseUrl}/auth/login`",
          "post(`${baseUrl}/lbs/resolve-region`",
          "uploadFile(`${baseUrl}/uploads/items`",
          'assert.equal(upload.status,',
          'assert.equal(resolved.communityId'
        ]
      }
    ]
  }
]

let evidenceCount = 0

for (const flow of flows) {
  for (const item of flow.evidence) {
    assertIncludesAll(item.file, flow.name, files.get(item.file), item.tokens)
    evidenceCount += item.tokens.length
  }
}

console.log(`Main flow contract smoke checks passed for ${flows.length} flows and ${evidenceCount} evidence points`)

async function readFiles(paths) {
  const entries = await Promise.all(paths.map(async (path) => [
    path,
    await readFile(resolve(root, path), 'utf8')
  ]))

  return new Map(entries)
}

function assertIncludesAll(file, flowName, content, tokens) {
  assert.equal(typeof content, 'string', `${file}: source must be loaded for ${flowName}`)

  for (const token of tokens) {
    assert.ok(
      content.includes(token),
      `${file}: missing ${flowName} evidence token: ${token}`
    )
  }
}
