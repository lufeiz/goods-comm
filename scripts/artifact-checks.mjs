import { access, readdir, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { readEnvironmentFile } from './env-files.mjs'

export async function createArtifactChecks(options = {}) {
  const root = options.root || process.cwd()
  const profile = options.profile || 'quick'
  const environments = options.environments || ['dev', 'test', 'pre', 'prod']
  const pageConfig = JSON.parse(await readFile(resolve(root, 'src/pages.json'), 'utf8'))
  const expectedPages = pageConfig.pages.map((page) => page.path)
  const expectedTabPages = pageConfig.tabBar.list.map((item) => item.pagePath)
  const expectedTabLabels = new Map(pageConfig.tabBar.list.map((item) => [item.pagePath, item.text]))
  const expectedEnvironmentConfigs = await readExpectedEnvironmentConfigs(environments)
  const context = {
    root,
    expectedPages,
    expectedTabPages,
    expectedTabLabels,
    expectedEnvironmentConfigs,
    requiredComponents: ['GoodCard', 'LocationGuard', 'EligibilityTag'],
    requiredRenderedTestIds: createRequiredRenderedTestIds(),
    requiredRenderedAttributes: createRequiredRenderedAttributes()
  }
  const targets = profile === 'quick'
    ? quickTargets(root)
    : environmentTargets(root, environments)

  return {
    targets,
    async verifyTarget(target) {
      return verifyArtifactTarget(target, context)
    }
  }
}

function quickTargets(root) {
  return [
    {
      label: 'default h5',
      platform: 'h5',
      directory: resolve(root, 'dist/build/h5')
    },
    {
      label: 'default mp-weixin',
      platform: 'mp-weixin',
      directory: resolve(root, 'dist/build/mp-weixin')
    },
    {
      label: 'default mp-alipay',
      platform: 'mp-alipay',
      directory: resolve(root, 'dist/build/mp-alipay')
    }
  ]
}

function environmentTargets(root, environments) {
  const targets = []

  for (const environment of environments) {
    for (const platform of ['h5', 'mp-weixin', 'mp-alipay']) {
      targets.push({
        label: `${environment} ${platform}`,
        environment,
        platform,
        directory: resolve(root, 'dist/build', environment, platform)
      })
    }
  }

  return targets
}

async function verifyArtifactTarget(target, context) {
  if (target.platform === 'h5') {
    await verifyH5Target(target, context)
    return
  }

  await verifyMiniProgramTarget(target, context)
}

async function verifyH5Target(target, context) {
  const htmlPath = join(target.directory, 'index.html')
  const html = await readExistingFile(htmlPath, target.label)
  const assetRefs = Array.from(html.matchAll(/(?:src|href)="\/([^"]+)"/g), (match) => match[1])

  assertCondition(html.includes('<div id="app"></div>'), `${target.label}: H5 app mount node is missing`)
  assertCondition(assetRefs.some((asset) => asset.endsWith('.js')), `${target.label}: H5 entry script is missing`)
  assertCondition(assetRefs.some((asset) => asset.endsWith('.css')), `${target.label}: H5 stylesheet is missing`)

  for (const asset of assetRefs) {
    await assertFileExists(join(target.directory, asset), `${target.label}: referenced asset ${asset} is missing`)
  }

  const assetNames = await listFileNames(join(target.directory, 'assets'))

  for (const page of context.expectedPages) {
    const chunkPrefix = `${page.replace(/\//g, '-')}.`
    assertCondition(
      assetNames.some((name) => name.startsWith(chunkPrefix) && name.endsWith('.js')),
      `${target.label}: H5 route chunk for ${page} is missing`
    )
  }

  if (target.environment) {
    await verifyH5RuntimeConfig(target, context, assetNames)
  }

  await verifyH5RenderedTestIds(target, context, assetNames)
}

async function verifyMiniProgramTarget(target, context) {
  const appConfig = JSON.parse(await readExistingFile(join(target.directory, 'app.json'), target.label))
  const tabEntries = target.platform === 'mp-alipay'
    ? appConfig.tabBar?.items || []
    : appConfig.tabBar?.list || []
  const markupExtension = target.platform === 'mp-alipay' ? 'axml' : 'wxml'
  const styleExtension = target.platform === 'mp-alipay' ? 'acss' : 'wxss'

  assertDeepEqual(appConfig.pages, context.expectedPages, `${target.label}: app.json pages do not match src/pages.json`)
  assertDeepEqual(
    tabEntries.map((item) => item.pagePath),
    context.expectedTabPages,
    `${target.label}: tabBar pages do not match src/pages.json`
  )

  for (const tab of tabEntries) {
    const actualLabel = target.platform === 'mp-alipay' ? tab.name : tab.text
    assertCondition(
      actualLabel === context.expectedTabLabels.get(tab.pagePath),
      `${target.label}: tab label mismatch for ${tab.pagePath}`
    )
  }

  for (const page of context.expectedPages) {
    for (const extension of ['js', 'json', markupExtension, styleExtension]) {
      await assertFileExists(join(target.directory, `${page}.${extension}`), `${target.label}: ${page}.${extension} is missing`)
    }
  }

  for (const component of context.requiredComponents) {
    for (const extension of ['js', 'json', markupExtension, styleExtension]) {
      await assertFileExists(join(target.directory, `components/${component}.${extension}`), `${target.label}: ${component}.${extension} is missing`)
    }
  }

  const appRuntimeConfig = await readExistingFile(join(target.directory, 'config/app.js'), target.label)

  if (target.environment) {
    const expectedConfig = getExpectedEnvironmentConfig(target, context)

    assertCondition(
      includesJsString(appRuntimeConfig, expectedConfig.appEnv),
      `${target.label}: runtime app config does not contain the expected environment`
    )
    assertCondition(
      appRuntimeConfig.includes(expectedConfig.apiBaseUrl),
      `${target.label}: runtime app config does not contain the expected API base URL`
    )
  }

  await verifyMiniProgramRenderedTestIds(target, context, markupExtension)
}

function createRequiredRenderedTestIds() {
  return {
    pages: {
      'pages/home/home': [
        'home-page',
        'home-publish-entry',
        'home-search-input',
        'home-search-button',
        'home-good-list',
        'home-empty-state'
      ],
      'pages/publish/publish': [
        'publish-page',
        'publish-form',
        'publish-title-input',
        'publish-price-input',
        'publish-description-input',
        'publish-image-add',
        'publish-location-summary',
        'publish-submit'
      ],
      'pages/detail/detail': [
        'detail-page',
        'detail-eligibility-panel',
        'detail-refresh-eligibility',
        'detail-choose-location',
        'detail-report-button',
        'detail-start-trade',
        'detail-not-found'
      ],
      'pages/orders/orders': [
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
      ],
      'pages/mine/mine': [
        'mine-page',
        'mine-profile',
        'mine-login-button',
        'mine-agreement-toggle',
        'mine-goods-list',
        'mine-goods-empty'
      ],
      'pages/ops/ops': [
        'ops-page',
        'ops-auth-panel',
        'ops-auth-state',
        'ops-actor-input',
        'ops-secret-input',
        'ops-login-submit',
        'ops-refresh',
        'ops-clear-session',
        'ops-stats-grid',
        'ops-stat-card',
        'ops-user-risk-panel',
        'ops-user-status-filter',
        'ops-user-card',
        'ops-user-block-submit',
        'ops-user-unblock-submit',
        'ops-items-panel',
        'ops-item-card',
        'ops-item-approve',
        'ops-item-reject',
        'ops-reports-panel',
        'ops-report-card',
        'ops-report-dismiss',
        'ops-report-uphold',
        'ops-report-block-reporter',
        'ops-disputes-panel',
        'ops-dispute-card',
        'ops-dispute-resolution',
        'ops-dispute-submit',
        'ops-deliveries-panel',
        'ops-delivery-status-filter',
        'ops-delivery-card',
        'ops-delivery-retry-one',
        'ops-client-events-panel',
        'ops-client-event-card',
        'ops-audit-panel',
        'ops-audit-card'
      ]
    },
    components: {
      GoodCard: [
        'good-card'
      ],
      LocationGuard: [
        'location-guard',
        'location-refresh',
        'location-choose',
        'location-error'
      ]
    }
  }
}

function createRequiredRenderedAttributes() {
  return {
    pages: {
      'pages/orders/orders': [
        'data-notification-id',
        'data-trade-id',
        'data-status',
        'data-rating',
        'data-tag'
      ],
      'pages/ops/ops': [
        'data-stat',
        'data-status',
        'data-user-id',
        'data-item-id',
        'data-report-id',
        'data-dispute-id',
        'data-resolution',
        'data-delivery-id',
        'data-level',
        'data-event-id',
        'data-audit-id',
        'data-action'
      ]
    }
  }
}

async function verifyH5RenderedTestIds(target, context, assetNames) {
  const jsAssetNames = assetNames.filter((name) => name.endsWith('.js'))
  let jsBundleText = ''

  for (const assetName of jsAssetNames) {
    jsBundleText += await readExistingFile(join(target.directory, 'assets', assetName), target.label)
    jsBundleText += '\n'
  }

  for (const testId of allRequiredRenderedTestIds(context)) {
    assertCondition(
      jsBundleText.includes(testId),
      `${target.label}: H5 artifact is missing rendered test id ${testId}`
    )
  }

  for (const attribute of allRequiredRenderedAttributes(context)) {
    assertCondition(
      jsBundleText.includes(attribute),
      `${target.label}: H5 artifact is missing rendered selector attribute ${attribute}`
    )
  }
}

async function verifyMiniProgramRenderedTestIds(target, context, markupExtension) {
  for (const [page, testIds] of Object.entries(context.requiredRenderedTestIds.pages)) {
    const markup = await readExistingFile(join(target.directory, `${page}.${markupExtension}`), target.label)

    for (const testId of testIds) {
      assertCondition(
        markup.includes(`data-testid="${testId}"`),
        `${target.label}: ${page}.${markupExtension} is missing rendered test id ${testId}`
      )
    }

    for (const attribute of context.requiredRenderedAttributes.pages[page] || []) {
      assertCondition(
        markup.includes(attribute),
        `${target.label}: ${page}.${markupExtension} is missing rendered selector attribute ${attribute}`
      )
    }
  }

  for (const [component, testIds] of Object.entries(context.requiredRenderedTestIds.components)) {
    const markup = await readExistingFile(join(target.directory, `components/${component}.${markupExtension}`), target.label)

    for (const testId of testIds) {
      assertCondition(
        markup.includes(`data-testid="${testId}"`),
        `${target.label}: components/${component}.${markupExtension} is missing rendered test id ${testId}`
      )
    }
  }
}

function allRequiredRenderedTestIds(context) {
  return [
    ...Object.values(context.requiredRenderedTestIds.pages).flat(),
    ...Object.values(context.requiredRenderedTestIds.components).flat()
  ]
}

function allRequiredRenderedAttributes(context) {
  return [
    ...Object.values(context.requiredRenderedAttributes.pages).flat()
  ]
}

async function verifyH5RuntimeConfig(target, context, assetNames) {
  const expectedConfig = getExpectedEnvironmentConfig(target, context)
  const jsAssetNames = assetNames.filter((name) => name.endsWith('.js'))
  const runtimeAssets = []

  for (const assetName of jsAssetNames) {
    const content = await readExistingFile(join(target.directory, 'assets', assetName), target.label)

    if (content.includes(expectedConfig.apiBaseUrl)) {
      runtimeAssets.push({
        name: assetName,
        content
      })
    }
  }

  assertCondition(
    runtimeAssets.length > 0,
    `${target.label}: H5 runtime assets do not contain the expected API base URL`
  )

  assertCondition(
    runtimeAssets.some((asset) => includesJsString(asset.content, expectedConfig.appEnv)),
    `${target.label}: H5 runtime assets do not contain the expected app environment`
  )
}

async function readExpectedEnvironmentConfigs(environments) {
  const configs = new Map()

  for (const environment of environments) {
    const values = await readEnvironmentFile(environment)
    configs.set(environment, {
      appEnv: values.VITE_APP_ENV,
      apiBaseUrl: normalizeApiBaseUrl(values.VITE_API_BASE_URL)
    })
  }

  return configs
}

function getExpectedEnvironmentConfig(target, context) {
  const expectedConfig = context.expectedEnvironmentConfigs.get(target.environment)

  if (!expectedConfig) {
    throw new Error(`${target.label}: cannot resolve expected environment config for ${target.environment}`)
  }

  return expectedConfig
}

function includesJsString(content, value) {
  return content.includes(`"${value}"`) || content.includes(`'${value}'`)
}

function normalizeApiBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

async function readExistingFile(path, label) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`${label}: cannot read ${path}: ${error.message}`)
  }
}

async function assertFileExists(path, message) {
  try {
    await access(path)
  } catch {
    throw new Error(message)
  }
}

async function listFileNames(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true
  })
  return entries.filter((entry) => entry.isFile()).map((entry) => basename(entry.name))
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message)
  }
}
