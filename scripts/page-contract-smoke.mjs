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
const componentSources = new Map([
  ['components/GoodCard.vue', await readFile(join(root, 'src/components/GoodCard.vue'), 'utf8')],
  ['components/LocationGuard.vue', await readFile(join(root, 'src/components/LocationGuard.vue'), 'utf8')]
])

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
        'fetchOpsAuditEvents',
        ':data-user-id="user.id"',
        ':data-item-id="item.id"',
        ':data-report-id="report.id"',
        ':data-dispute-id="dispute.id"',
        ':data-delivery-id="delivery.id"',
        ':data-event-id="event.id"',
        ':data-audit-id="event.id"',
        ':data-action="event.action"'
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

  const detailSource = pageSources.get('pages/detail/detail')
  assert.ok(
    detailSource.includes('function hasCoordinateLocation(location)'),
    'src/pages/detail/detail.vue must keep an explicit coordinate guard helper'
  )
  assert.ok(
    detailSource.includes("if (!location || typeof location !== 'object')"),
    'src/pages/detail/detail.vue coordinate checks must tolerate null or non-object locations'
  )

  verifyDisplayStateContracts()
  verifyRenderedTestIdContracts()

  for (const [path, source] of [
    ['src/components/GoodCard.vue', componentSources.get('components/GoodCard.vue')],
    ['src/pages/detail/detail.vue', pageSources.get('pages/detail/detail')]
  ]) {
    assert.ok(
      source.includes('typeof candidate === \'string\' ? candidate : candidate?.url'),
      `${path} must ignore anonymized image objects with empty URLs and fall back to the tone cover`
    )
    assert.ok(
      !source.includes('images?.[0]?.url || this.item') && !source.includes('images?.[0]?.url || this.item?.images?.[0]'),
      `${path} must not use the first image object itself as an image src`
    )
  }
}

function verifyRenderedTestIdContracts() {
  const renderedContracts = [
    {
      path: 'src/pages/home/home.vue',
      source: pageSources.get('pages/home/home'),
      testIds: [
        'home-page',
        'home-topbar',
        'home-publish-entry',
        'home-search',
        'home-search-input',
        'home-search-button',
        'home-good-list',
        'home-empty-state'
      ]
    },
    {
      path: 'src/pages/publish/publish.vue',
      source: pageSources.get('pages/publish/publish'),
      testIds: [
        'publish-page',
        'publish-form',
        'publish-title-input',
        'publish-price-input',
        'publish-scope-field',
        'publish-description-input',
        'publish-images-field',
        'publish-image-add',
        'publish-location-summary',
        'publish-submit'
      ]
    },
    {
      path: 'src/pages/detail/detail.vue',
      source: pageSources.get('pages/detail/detail'),
      testIds: [
        'detail-page',
        'detail-title-block',
        'detail-eligibility-panel',
        'detail-refresh-eligibility',
        'detail-choose-location',
        'detail-description-panel',
        'detail-seller-panel',
        'detail-bottom-bar',
        'detail-report-button',
        'detail-start-trade',
        'detail-not-found'
      ]
    },
    {
      path: 'src/pages/orders/orders.vue',
      source: pageSources.get('pages/orders/orders'),
      testIds: [
        'orders-page',
        'orders-summary',
        'orders-notification-list',
        'orders-notification-read',
        'orders-login-required',
        'orders-login-entry',
        'orders-trade-list',
        'orders-trade-card',
        'orders-trade-status',
        'orders-trade-contact',
        'orders-trade-dispute',
        'orders-trade-audit',
        'orders-trade-action',
        'orders-review-panel',
        'orders-review-rating',
        'orders-review-tag',
        'orders-review-content',
        'orders-review-submit',
        'orders-reviewed-label',
        'orders-empty-state'
      ]
    },
    {
      path: 'src/pages/mine/mine.vue',
      source: pageSources.get('pages/mine/mine'),
      testIds: [
        'mine-page',
        'mine-profile',
        'mine-auth-actions',
        'mine-login-button',
        'mine-logout-button',
        'mine-agreement-panel',
        'mine-agreement-toggle',
        'mine-goods-list',
        'mine-goods-empty',
        'mine-ops-entry-panel',
        'mine-account-danger-panel'
      ]
    },
    {
      path: 'src/pages/ops/ops.vue',
      source: pageSources.get('pages/ops/ops'),
      testIds: [
        'ops-page',
        'ops-auth-panel',
        'ops-auth-state',
        'ops-actor-input',
        'ops-secret-input',
        'ops-login-submit',
        'ops-refresh',
        'ops-clear-session',
        'ops-current-operator',
        'ops-stats-grid',
        'ops-stat-card',
        'ops-user-risk-panel',
        'ops-user-risk-target',
        'ops-user-risk-reason',
        'ops-user-block-submit',
        'ops-user-unblock-submit',
        'ops-user-status-filter',
        'ops-user-list',
        'ops-user-card',
        'ops-user-prefill',
        'ops-user-list-unblock',
        'ops-user-list-block',
        'ops-user-empty',
        'ops-items-panel',
        'ops-item-list',
        'ops-item-card',
        'ops-item-note',
        'ops-item-approve',
        'ops-item-reject',
        'ops-item-empty',
        'ops-reports-panel',
        'ops-report-list',
        'ops-report-card',
        'ops-report-note',
        'ops-report-dismiss',
        'ops-report-uphold',
        'ops-report-block-reporter',
        'ops-report-empty',
        'ops-disputes-panel',
        'ops-dispute-list',
        'ops-dispute-card',
        'ops-dispute-resolution',
        'ops-dispute-note',
        'ops-dispute-submit',
        'ops-dispute-empty',
        'ops-deliveries-panel',
        'ops-delivery-status-filter',
        'ops-delivery-retry-due',
        'ops-delivery-list',
        'ops-delivery-card',
        'ops-delivery-retry-one',
        'ops-delivery-empty',
        'ops-client-events-panel',
        'ops-event-level-filter',
        'ops-client-event-list',
        'ops-client-event-card',
        'ops-client-event-empty',
        'ops-audit-panel',
        'ops-audit-list',
        'ops-audit-card',
        'ops-audit-empty'
      ]
    },
    {
      path: 'src/components/LocationGuard.vue',
      source: componentSources.get('components/LocationGuard.vue'),
      testIds: [
        'location-guard',
        'location-refresh',
        'location-choose',
        'location-error'
      ]
    },
    {
      path: 'src/components/GoodCard.vue',
      source: componentSources.get('components/GoodCard.vue'),
      testIds: [
        'good-card'
      ]
    }
  ]

  for (const contract of renderedContracts) {
    assert.ok(contract.source, `${contract.path} source must be loaded`)

    for (const testId of contract.testIds) {
      assert.ok(
        contract.source.includes(`data-testid="${testId}"`),
        `${contract.path} must expose stable rendered test id: ${testId}`
      )
    }
  }
}

function verifyDisplayStateContracts() {
  const displayContracts = [
    {
      path: 'src/components/LocationGuard.vue',
      source: componentSources.get('components/LocationGuard.vue'),
      label: 'location display and error states',
      tokens: [
        'profile?.error',
        'profile.error.message',
        'errorView.actionText',
        'qualityText',
        '未确认当前位置',
        '授权后可查看距离并发起符合范围的交易',
        '选择',
        '定位中'
      ]
    },
    {
      path: 'src/components/GoodCard.vue',
      source: componentSources.get('components/GoodCard.vue'),
      label: 'market item card display states',
      tokens: [
        'coverImage',
        'coverClass',
        'coverText',
        '授权后看距离',
        'reserved: \'已锁定\'',
        'sold: \'已售出\'',
        'formatDistance(this.item.distanceMeters)'
      ]
    },
    {
      path: 'src/pages/home/home.vue',
      source: pageSources.get('pages/home/home'),
      label: 'market list display states',
      tokens: [
        '{{ items.length }} 件',
        '暂无匹配物品',
        '换个关键词',
        ':item="item"',
        '@open="openItem"',
        'currentLocation: this.locationProfile?.location'
      ]
    },
    {
      path: 'src/pages/publish/publish.vue',
      source: pageSources.get('pages/publish/publish'),
      label: 'publish form display states',
      tokens: [
        '物品照片',
        '添加照片',
        '请至少添加 1 张物品照片',
        '发布位置',
        'regionLabel',
        '请先刷新定位',
        '发布到邻里集市',
        '发布中'
      ]
    },
    {
      path: 'src/pages/detail/detail.vue',
      source: pageSources.get('pages/detail/detail'),
      label: 'item detail sale-state display',
      tokens: [
        '物品不存在或已下架',
        'itemStatusText',
        'canStartTrade',
        'tradeButtonText',
        '自己的物品',
        '交易处理中',
        '已售出',
        '发起交易会重新使用实时 GPS 定位做最终校验',
        '选择位置预估'
      ]
    },
    {
      path: 'src/pages/orders/orders.vue',
      source: pageSources.get('pages/orders/orders'),
      label: 'trade list and notification display states',
      tokens: [
        'notifications.length',
        'notification.readAt ? \'is-read\' : \'\'',
        '请先登录',
        '还没有交易意向',
        'contactText(trade)',
        'disputeText(trade)',
        'auditText(trade)',
        '交易评价',
        '已评价',
        ':data-trade-id="trade.id"',
        ':data-status="action.status"',
        ':data-rating="rating"',
        ':data-tag="tag"'
      ]
    },
    {
      path: 'src/pages/mine/mine.vue',
      source: pageSources.get('pages/mine/mine'),
      label: 'profile, account, and owned item display states',
      tokens: [
        '未登录用户',
        '我已阅读并同意',
        '我的发布',
        'itemStatusText(item.status)',
        'canRelistItem(item)',
        '内部运营',
        '账号与数据',
        '注销账号'
      ]
    }
  ]

  for (const contract of displayContracts) {
    assert.ok(contract.source, `${contract.path} source must be loaded`)

    for (const token of contract.tokens) {
      assert.ok(
        contract.source.includes(token),
        `${contract.path} must keep ${contract.label} display token: ${token}`
      )
    }
  }
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
