import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { containsPlaceholder } from './env-files.mjs'

const MINI_PROGRAM_CONFIGS = {
  'mp-weixin': {
    envKey: 'GOODS_COMM_WECHAT_APP_ID',
    fileName: 'project.config.json',
    label: 'WeChat Mini Program'
  },
  'mp-alipay': {
    envKey: 'GOODS_COMM_ALIPAY_APP_ID',
    fileName: 'mini.project.json',
    label: 'Alipay Mini Program'
  }
}

export function miniProgramAppIdEnvKey(platform) {
  return getMiniProgramConfig(platform).envKey
}

export function isRealMiniProgramAppId(value = '') {
  const normalized = String(value || '').trim()

  return Boolean(normalized) &&
    !containsPlaceholder(normalized) &&
    !/^touristappid$/i.test(normalized)
}

export function resolveMiniProgramAppId(values = {}, platform) {
  const key = miniProgramAppIdEnvKey(platform)
  const value = String(values[key] || '').trim()

  return isRealMiniProgramAppId(value) ? value : ''
}

export async function readMiniProgramAppId({ platform, directory }) {
  const config = getMiniProgramConfig(platform)
  const configPath = resolve(directory, config.fileName)
  const json = JSON.parse(await readFile(configPath, 'utf8'))

  return String(json.appid || '').trim()
}

export async function patchMiniProgramAppId({ platform, directory, values = {}, appId = '' }) {
  const config = getMiniProgramConfig(platform)
  const targetAppId = String(appId || resolveMiniProgramAppId(values, platform) || '').trim()

  if (!targetAppId) {
    return {
      patched: false,
      appid: '',
      reason: 'missing-real-appid'
    }
  }

  if (!isRealMiniProgramAppId(targetAppId)) {
    return {
      patched: false,
      appid: targetAppId,
      reason: 'appid-is-not-real'
    }
  }

  const configPath = resolve(directory, config.fileName)
  const json = JSON.parse(await readFile(configPath, 'utf8'))

  if (String(json.appid || '').trim() === targetAppId) {
    return {
      patched: false,
      appid: targetAppId,
      configPath,
      reason: 'already-matched'
    }
  }

  json.appid = targetAppId
  await writeFile(configPath, `${JSON.stringify(json, null, 2)}\n`)

  return {
    patched: true,
    appid: targetAppId,
    configPath,
    reason: 'patched'
  }
}

function getMiniProgramConfig(platform) {
  const config = MINI_PROGRAM_CONFIGS[platform]

  if (!config) {
    throw new Error(`Unsupported mini program platform: ${platform}`)
  }

  return config
}
