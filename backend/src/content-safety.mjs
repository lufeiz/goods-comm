const PROTECTED_ENVIRONMENTS = new Set(['pre', 'prod'])
const BLOCKED_CONTENT_WORDS = ['违禁', '假货', '诈骗', '管制']
const WECHAT_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token'
const WECHAT_MSG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check'
const WECHAT_MEDIA_CHECK_ASYNC_URL = 'https://api.weixin.qq.com/wxa/media_check_async'

export function createContentSafetyClient(options = {}) {
  const environment = options.environment || process.env.GOODS_COMM_ENV || 'dev'
  const provider = normalizeContentSafetyProvider(options.contentSafetyProvider || process.env.GOODS_COMM_CONTENT_SECURITY_PROVIDER || defaultProvider(environment))
  const allowMock = options.allowMockContentSafety || process.env.GOODS_COMM_ALLOW_MOCK_CONTENT_SAFETY_IN_PROTECTED_ENV === 'true'

  if (PROTECTED_ENVIRONMENTS.has(environment) && provider === 'mock' && !allowMock) {
    throw new Error(`${environment} 环境不能使用 mock 内容安全，请配置 GOODS_COMM_CONTENT_SECURITY_PROVIDER=wechat`)
  }

  return {
    provider,
    async reviewItemPayload(payload = {}) {
      if (provider === 'mock') {
        return reviewTextWithMock(payload)
      }

      return reviewTextWithWeChat(payload, createWeChatConfig(options))
    },
    async reviewUploadedImage(file = {}) {
      if (provider === 'mock') {
        return {
          ...file,
          moderationStatus: 'approved_auto',
          moderationReasons: []
        }
      }

      return reviewImageWithWeChat(file, createWeChatConfig(options))
    }
  }
}

export function normalizeContentSafetyProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  if (['mock', 'wechat'].includes(normalized)) {
    return normalized
  }

  throw new Error(`GOODS_COMM_CONTENT_SECURITY_PROVIDER 只能是 mock/wechat，当前为 ${value || '空'}`)
}

function reviewTextWithMock(payload = {}) {
  const content = `${payload.title || ''} ${payload.description || ''}`.toLowerCase()
  const blocked = BLOCKED_CONTENT_WORDS.filter((word) => content.includes(word))

  if (blocked.length) {
    return {
      ...payload,
      moderation: {
        status: 'rejected',
        reasons: blocked.map((word) => `命中违禁词:${word}`)
      }
    }
  }

  return {
    ...payload,
    moderation: {
      status: 'approved_auto',
      reasons: []
    }
  }
}

async function reviewTextWithWeChat(payload = {}, config) {
  assertWeChatConfigured(config)
  const content = `${payload.title || ''} ${payload.description || ''}`.trim()

  if (!content) {
    return {
      ...payload,
      moderation: {
        status: 'approved_auto',
        reasons: []
      }
    }
  }

  const accessToken = await getWeChatAccessToken(config)
  const url = `${config.msgSecCheckUrl}?access_token=${encodeURIComponent(accessToken)}`
  const response = await config.fetcher(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      content,
      version: 2,
      scene: 2,
      openid: payload.sellerOpenid || payload.platformId || ''
    })
  })
  const body = await parseJsonResponse(response)

  if (!response.ok || body.errcode && body.errcode !== 0) {
    throw new Error(`微信内容安全文本审核失败：${body.errmsg || body.errcode || response.status}`)
  }

  const suggest = body.result?.suggest || 'pass'

  if (suggest === 'risky') {
    return {
      ...payload,
      moderation: {
        status: 'rejected',
        reasons: [body.result?.label ? `微信内容安全:${body.result.label}` : '微信内容安全拒绝']
      }
    }
  }

  if (suggest !== 'pass') {
    return {
      ...payload,
      moderation: {
        status: 'pending_media_review',
        reasons: ['微信内容安全待复核']
      }
    }
  }

  return {
    ...payload,
    moderation: {
      status: 'approved_auto',
      reasons: []
    }
  }
}

async function reviewImageWithWeChat(file = {}, config) {
  assertWeChatConfigured(config)

  if (!file.url || !String(file.url).startsWith('https://')) {
    return {
      ...file,
      status: 'pending_review',
      moderationStatus: 'pending_media_review',
      moderationReasons: ['图片缺少可审核 HTTPS 地址']
    }
  }

  const accessToken = await getWeChatAccessToken(config)
  const url = `${config.mediaCheckAsyncUrl}?access_token=${encodeURIComponent(accessToken)}`
  const response = await config.fetcher(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      media_url: file.url,
      media_type: 2,
      version: 2,
      scene: 2,
      openid: file.ownerOpenid || ''
    })
  })
  const body = await parseJsonResponse(response)

  if (!response.ok || body.errcode && body.errcode !== 0) {
    throw new Error(`微信内容安全图片审核失败：${body.errmsg || body.errcode || response.status}`)
  }

  return {
    ...file,
    status: 'pending_review',
    moderationStatus: 'pending_media_review',
    moderationReasons: ['微信图片异步审核中'],
    traceId: body.trace_id || file.traceId || ''
  }
}

async function getWeChatAccessToken(config) {
  const url = new URL(config.tokenUrl)
  url.searchParams.set('grant_type', 'client_credential')
  url.searchParams.set('appid', config.appId)
  url.searchParams.set('secret', config.appSecret)

  const response = await config.fetcher(url, {
    method: 'GET'
  })
  const body = await parseJsonResponse(response)

  if (!response.ok || body.errcode) {
    throw new Error(`微信 access_token 获取失败：${body.errmsg || body.errcode || response.status}`)
  }

  if (!body.access_token) {
    throw new Error('微信 access_token 获取失败：未返回 access_token')
  }

  return body.access_token
}

function createWeChatConfig(options = {}) {
  return {
    appId: options.weixinAppId || process.env.GOODS_COMM_WECHAT_APP_ID,
    appSecret: options.weixinAppSecret || process.env.GOODS_COMM_WECHAT_APP_SECRET,
    tokenUrl: options.wechatTokenUrl || process.env.GOODS_COMM_WECHAT_TOKEN_URL || WECHAT_TOKEN_URL,
    msgSecCheckUrl: options.wechatMsgSecCheckUrl || process.env.GOODS_COMM_WECHAT_MSG_SEC_CHECK_URL || WECHAT_MSG_SEC_CHECK_URL,
    mediaCheckAsyncUrl: options.wechatMediaCheckAsyncUrl || process.env.GOODS_COMM_WECHAT_MEDIA_CHECK_ASYNC_URL || WECHAT_MEDIA_CHECK_ASYNC_URL,
    fetcher: options.fetcher || globalThis.fetch
  }
}

function assertWeChatConfigured(config) {
  if (!config.fetcher) {
    throw new Error('内容安全配置未完成：当前运行时缺少 fetch')
  }

  for (const [label, value] of [
    ['微信 AppID', config.appId],
    ['微信 AppSecret', config.appSecret]
  ]) {
    if (!value || /REPLACE_WITH|placeholder|example\./i.test(String(value))) {
      throw new Error(`内容安全配置未完成：${label}`)
    }
  }
}

async function parseJsonResponse(response) {
  const text = await response.text()

  try {
    return text ? JSON.parse(text) : {}
  } catch (error) {
    throw new Error('内容安全服务响应不是有效 JSON')
  }
}

function defaultProvider(environment) {
  return PROTECTED_ENVIRONMENTS.has(environment) ? 'wechat' : 'mock'
}
