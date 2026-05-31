import { createSign } from 'node:crypto'

const PROTECTED_ENVIRONMENTS = new Set(['pre', 'prod'])
const WEIXIN_CODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session'
const ALIPAY_GATEWAY_URL = 'https://openapi.alipay.com/gateway.do'

export function createPlatformAuthResolver(options = {}) {
  const environment = options.environment || process.env.GOODS_COMM_ENV || 'dev'
  const mode = normalizeAuthMode(options.authMode || process.env.GOODS_COMM_PLATFORM_AUTH_MODE || defaultAuthMode(environment))
  const allowDemoAuth = options.allowDemoAuth || process.env.GOODS_COMM_ALLOW_DEMO_AUTH_IN_PROTECTED_ENV === 'true'

  if (PROTECTED_ENVIRONMENTS.has(environment) && mode === 'demo' && !allowDemoAuth) {
    throw new Error(`${environment} 环境不能使用演示登录，请配置 GOODS_COMM_PLATFORM_AUTH_MODE=platform`)
  }

  return {
    mode,
    async resolveLoginData(payload = {}) {
      if (mode === 'demo') {
        return {
          ...payload,
          platformIdentity: createDemoIdentity(payload)
        }
      }

      return {
        ...payload,
        platformIdentity: await resolvePlatformIdentity(payload, {
          fetcher: options.fetcher || globalThis.fetch,
          signAlipayParams: options.signAlipayParams || signAlipayParams,
          weixin: {
            appId: options.weixinAppId || process.env.GOODS_COMM_WECHAT_APP_ID,
            appSecret: options.weixinAppSecret || process.env.GOODS_COMM_WECHAT_APP_SECRET,
            endpoint: options.weixinEndpoint || process.env.GOODS_COMM_WECHAT_CODE2SESSION_URL || WEIXIN_CODE2SESSION_URL
          },
          alipay: {
            appId: options.alipayAppId || process.env.GOODS_COMM_ALIPAY_APP_ID,
            privateKey: options.alipayPrivateKey || process.env.GOODS_COMM_ALIPAY_PRIVATE_KEY,
            gateway: options.alipayGateway || process.env.GOODS_COMM_ALIPAY_GATEWAY || ALIPAY_GATEWAY_URL
          }
        })
      }
    }
  }
}

export function normalizeAuthMode(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  if (['demo', 'platform'].includes(normalized)) {
    return normalized
  }

  throw new Error(`GOODS_COMM_PLATFORM_AUTH_MODE 只能是 demo/platform，当前为 ${value || '空'}`)
}

async function resolvePlatformIdentity(payload, config) {
  const provider = payload.provider || ''
  const code = String(payload.code || '').trim()

  if (!code) {
    throw new Error('登录 code 无效，请重新授权登录')
  }

  if (!config.fetcher) {
    throw new Error('平台登录配置未完成：当前运行时缺少 fetch')
  }

  if (provider === 'weixin') {
    return resolveWeixinIdentity(code, config)
  }

  if (provider === 'alipay') {
    return resolveAlipayIdentity(code, config)
  }

  throw new Error(`不支持的平台登录类型: ${provider || '空'}`)
}

async function resolveWeixinIdentity(code, config) {
  const { appId, appSecret, endpoint } = config.weixin

  assertConfigured('微信 AppID', appId)
  assertConfigured('微信 AppSecret', appSecret)

  const url = new URL(endpoint)
  url.searchParams.set('appid', appId)
  url.searchParams.set('secret', appSecret)
  url.searchParams.set('js_code', code)
  url.searchParams.set('grant_type', 'authorization_code')

  const response = await config.fetcher(url, {
    method: 'GET'
  })
  const body = await parseJsonResponse(response)

  if (!response.ok || body.errcode) {
    throw new Error(`微信平台登录失败：${body.errmsg || body.errcode || response.status}`)
  }

  if (!body.openid) {
    throw new Error('微信平台登录失败：未返回 openid')
  }

  return {
    provider: 'weixin',
    platformId: body.openid,
    unionId: body.unionid || '',
    authSource: 'weixin_jscode2session'
  }
}

async function resolveAlipayIdentity(code, config) {
  const { appId, privateKey, gateway } = config.alipay

  assertConfigured('支付宝 AppID', appId)
  assertConfigured('支付宝应用私钥', privateKey)

  const params = {
    app_id: appId,
    method: 'alipay.system.oauth.token',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: formatAlipayTimestamp(new Date()),
    version: '1.0',
    grant_type: 'authorization_code',
    code
  }
  params.sign = config.signAlipayParams(params, privateKey)

  const response = await config.fetcher(gateway, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=utf-8'
    },
    body: new URLSearchParams(params)
  })
  const body = await parseJsonResponse(response)
  const tokenResponse = body.alipay_system_oauth_token_response || {}

  if (!response.ok || tokenResponse.code && tokenResponse.code !== '10000') {
    throw new Error(`支付宝平台登录失败：${tokenResponse.sub_msg || tokenResponse.msg || response.status}`)
  }

  const userId = tokenResponse.user_id || tokenResponse.open_id || tokenResponse.uid

  if (!userId) {
    throw new Error('支付宝平台登录失败：未返回 user_id')
  }

  return {
    provider: 'alipay',
    platformId: userId,
    unionId: '',
    authSource: 'alipay_system_oauth_token'
  }
}

function createDemoIdentity(payload = {}) {
  const provider = payload.provider || 'unknown'
  const code = payload.code || `${provider}_${Date.now()}`
  const identitySeed = normalizeDemoIdentitySeed(code)

  return {
    provider,
    platformId: `demo_${provider}_${hashText(identitySeed)}`,
    unionId: '',
    authSource: 'demo'
  }
}

function normalizeDemoIdentitySeed(code = '') {
  const normalized = String(code || '')
  const oneTimeCodeMatch = normalized.match(/^(.*):one-time:[^:]+$/)

  return oneTimeCodeMatch ? oneTimeCodeMatch[1] : normalized
}

function assertConfigured(label, value) {
  if (!value || /REPLACE_WITH|placeholder|example\./i.test(String(value))) {
    throw new Error(`平台登录配置未完成：${label}`)
  }
}

async function parseJsonResponse(response) {
  const text = await response.text()

  try {
    return text ? JSON.parse(text) : {}
  } catch (error) {
    throw new Error('平台登录失败：响应不是有效 JSON')
  }
}

function signAlipayParams(params, privateKey) {
  const content = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== '' && key !== 'sign')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  const normalizedKey = normalizePrivateKey(privateKey)

  return createSign('RSA-SHA256').update(content, 'utf8').sign(normalizedKey, 'base64')
}

function normalizePrivateKey(value = '') {
  const key = String(value).replace(/\\n/g, '\n').trim()

  if (key.includes('BEGIN')) {
    return key
  }

  return `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`
}

function formatAlipayTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function defaultAuthMode(environment) {
  return PROTECTED_ENVIRONMENTS.has(environment) ? 'platform' : 'demo'
}

function hashText(value) {
  let hash = 0
  const input = String(value || '')

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}
