import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const pagesConfig = JSON.parse(await readFile(join(root, 'src/pages.json'), 'utf8'))

const requiredPages = [
  'pages/home/home',
  'pages/publish/publish',
  'pages/orders/orders',
  'pages/mine/mine',
  'pages/detail/detail',
  'pages/ops/ops',
  'pages/legal/legal'
]

const requiredTabBarPages = [
  'pages/home/home',
  'pages/publish/publish',
  'pages/orders/orders',
  'pages/mine/mine'
]

const pagePaths = new Set((pagesConfig.pages || []).map((page) => page.path))
const tabBarPaths = new Set((pagesConfig.tabBar?.list || []).map((page) => page.pagePath))

for (const pagePath of requiredPages) {
  assert.ok(pagePaths.has(pagePath), `${pagePath} must be registered in src/pages.json`)
  await access(pageFile(pagePath))
}

for (const tabPath of requiredTabBarPages) {
  assert.ok(tabBarPaths.has(tabPath), `${tabPath} must be listed in tabBar`)
  assert.ok(pagePaths.has(tabPath), `${tabPath} tabBar entry must point to a registered page`)
}

const pageSources = new Map()

for (const pagePath of pagePaths) {
  const source = await readFile(pageFile(pagePath), 'utf8')
  pageSources.set(pagePath, source)
  verifyTemplateHandlers(pagePath, source)
  verifyDeclaredNavigations(pagePath, source)
}

verifyPageContracts()

console.log(`Page contract smoke checks passed for ${pagePaths.size} pages`)

function verifyPageContracts() {
  const contracts = [
    {
      pagePath: 'pages/home/home',
      label: 'marketplace discovery',
      tokens: [
        'GoodCard',
        'LocationGuard',
        'fetchGoodsList',
        'getLocationProfile',
        'chooseLocationProfile',
        'this.refreshLocation({ silent: true })',
        '@confirm="loadItems"',
        '@tap="goPublish"',
        '@open="openItem"'
      ]
    },
    {
      pagePath: 'pages/publish/publish',
      label: 'authenticated item publishing',
      tokens: [
        'LocationGuard',
        'requireStoredAuthUser',
        'requireUserAgreement',
        'uploadItemImages',
        'submitGoods',
        'getLocationProfile',
        'chooseLocationProfile',
        "trackClientEvent('publish_submit_failed'",
        'ITEM_STATUS.PENDING_REVIEW',
        '请至少添加 1 张物品照片'
      ]
    },
    {
      pagePath: 'pages/detail/detail',
      label: 'item detail and trade intent',
      tokens: [
        'EligibilityTag',
        'requireStoredAuthUser',
        'requireUserAgreement',
        'submitTradeIntent',
        'verifyTradeEligibility',
        'isFinalTradeLocationProfile',
        'submitReport',
        'REPORT_REASONS',
        '发起交易会重新使用实时 GPS 定位做最终校验'
      ]
    },
    {
      pagePath: 'pages/orders/orders',
      label: 'trade sale lifecycle',
      tokens: [
        'fetchTradeIntents',
        'fetchNotifications',
        'changeTradeStatus',
        'TRADE_STATUS.PENDING_MEETUP',
        'TRADE_STATUS.COMPLETED',
        'submitTradeReview',
        'markNotificationRead',
        'getTradeContactText'
      ]
    },
    {
      pagePath: 'pages/mine/mine',
      label: 'login, profile, and account controls',
      tokens: [
        'LocationGuard',
        'loginWithPlatformProfile',
        'loginWithUserInfo',
        'logoutAuthSession',
        'deleteAuthAccount',
        'fetchMyGoods',
        'changeGoodsStatus',
        'hasAcceptedUserAgreement',
        'goOpsConsole'
      ]
    },
    {
      pagePath: 'pages/ops/ops',
      label: 'operations moderation and risk console',
      tokens: [
        'loginOpsSession',
        'fetchOpsModerationQueue',
        'let moderationQueue = null',
        'moderationQueue?.notificationDeliveries',
        'fetchOpsUsers',
        'reviewOpsItem',
        'resolveOpsReport',
        'resolveOpsDispute',
        'retryNotificationDeliveries',
        'updateOpsUserStatus',
        'fetchOpsAuditEvents'
      ]
    },
    {
      pagePath: 'pages/legal/legal',
      label: 'agreement and privacy acceptance',
      tokens: [
        'USER_AGREEMENT_VERSION',
        'acceptUserAgreement',
        'terms',
        'privacy',
        '我已阅读并同意'
      ]
    }
  ]

  for (const contract of contracts) {
    const source = pageSources.get(contract.pagePath)
    assert.ok(source, `${contract.pagePath} source must be loaded`)

    for (const token of contract.tokens) {
      assert.ok(
        source.includes(token),
        `${contract.pagePath} must keep ${contract.label} contract token: ${token}`
      )
    }
  }

  const opsSource = pageSources.get('pages/ops/ops')
  assert.ok(
    !opsSource.includes('Array.isArray(queue.notificationDeliveries)'),
    'pages/ops/ops notification fallback must not reference queue outside its block scope'
  )
}

function verifyTemplateHandlers(pagePath, source) {
  const handlers = extractTemplateHandlers(source)

  for (const handler of handlers) {
    assert.ok(
      isHandlerDefined(source, handler),
      `${pagePath} template references missing handler: ${handler}`
    )
  }
}

function verifyDeclaredNavigations(pagePath, source) {
  const declaredNavigations = source.match(/\/pages\/[A-Za-z0-9_/-]+/g) || []

  for (const navigation of declaredNavigations) {
    const targetPath = navigation.replace(/^\//, '')

    assert.ok(
      pagePaths.has(targetPath),
      `${pagePath} navigates to undeclared page: ${navigation}`
    )
  }
}

function extractTemplateHandlers(source) {
  const handlers = new Set()
  const eventPattern = /@[\w:-]+(?:\.[\w-]+)*\s*=\s*"([^"]+)"/g
  let match

  while ((match = eventPattern.exec(source))) {
    const expression = match[1].trim()
    const name = expression.match(/^([A-Za-z_$][\w$]*)/)?.[1]

    if (name) {
      handlers.add(name)
    }
  }

  return handlers
}

function isHandlerDefined(source, handler) {
  const escaped = escapeRegex(handler)
  return [
    new RegExp(`\\n\\s*(?:async\\s+)?${escaped}\\s*\\(`),
    new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`),
    new RegExp(`\\bconst\\s+${escaped}\\b`)
  ].some((pattern) => pattern.test(source))
}

function pageFile(pagePath) {
  return join(root, 'src', `${pagePath}.vue`)
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
