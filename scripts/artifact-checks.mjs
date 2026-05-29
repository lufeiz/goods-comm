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
    requiredComponents: ['GoodCard', 'LocationGuard', 'EligibilityTag']
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
