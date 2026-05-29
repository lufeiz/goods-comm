const PROTECTED_ENVIRONMENTS = new Set(['pre', 'prod'])
const WECHAT_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token'
const WECHAT_SUBSCRIBE_SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send'

export function createPlatformNotifier(options = {}) {
  const environment = options.environment || process.env.GOODS_COMM_ENV || 'dev'
  const provider = normalizeNotifyProvider(
    options.notifyProvider ||
    process.env.GOODS_COMM_PLATFORM_NOTIFY_PROVIDER ||
    defaultProvider(environment)
  )
  const allowMock = options.allowMockPlatformNotify ||
    process.env.GOODS_COMM_ALLOW_MOCK_PLATFORM_NOTIFY_IN_PROTECTED_ENV === 'true'

  if (PROTECTED_ENVIRONMENTS.has(environment) && provider === 'mock' && !allowMock) {
    throw new Error(`${environment} 环境不能使用 mock 平台通知，请配置 GOODS_COMM_PLATFORM_NOTIFY_PROVIDER=wechat`)
  }

  return {
    provider,
    async check() {
      if (provider === 'wechat') {
        assertWeChatConfigured(createWeChatConfig(options, environment))
      }

      return {
        ok: true,
        provider
      }
    },
    async dispatchNotifications(notifications = [], users = [], context = {}) {
      if (!Array.isArray(notifications) || notifications.length === 0) {
        return []
      }

      if (provider === 'mock') {
        return notifications.map((notification) => createDeliveryResult(notification, {
          provider,
          status: 'mock_sent',
          message: 'mock platform notification sent'
        }))
      }

      return dispatchWeChatNotifications(notifications, users, createWeChatConfig(options, environment, context))
    }
  }
}

export function normalizeNotifyProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  if (['mock', 'wechat'].includes(normalized)) {
    return normalized
  }

  throw new Error(`GOODS_COMM_PLATFORM_NOTIFY_PROVIDER 只能是 mock/wechat，当前为 ${value || '空'}`)
}

async function dispatchWeChatNotifications(notifications = [], users = [], config) {
  assertWeChatConfigured(config)

  const usersById = new Map(users.map((user) => [user.id, user]))
  const accessToken = await getWeChatAccessToken(config)
  const results = []

  for (const notification of notifications) {
    const user = usersById.get(notification.userId)

    if (!user) {
      results.push(createDeliveryResult(notification, {
        provider: 'wechat',
        status: 'skipped',
        message: 'recipient user not found'
      }))
      continue
    }

    if (user.provider !== 'weixin') {
      results.push(createDeliveryResult(notification, {
        provider: 'wechat',
        status: 'skipped',
        message: `unsupported recipient provider: ${user.provider || 'unknown'}`
      }))
      continue
    }

    const templateId = config.templateIds[notification.type] || config.defaultTemplateId

    if (!templateId) {
      results.push(createDeliveryResult(notification, {
        provider: 'wechat',
        status: 'skipped',
        message: `missing template id for ${notification.type}`
      }))
      continue
    }

    const delivery = await sendWeChatSubscribeMessage(notification, user, {
      ...config,
      accessToken,
      templateId
    })
    results.push(delivery)
  }

  return results
}

async function sendWeChatSubscribeMessage(notification, user, config) {
  const url = `${config.subscribeSendUrl}?access_token=${encodeURIComponent(config.accessToken)}`
  const payload = {
    touser: user.platformId,
    template_id: config.templateId,
    page: notification.targetType === 'trade' ? 'pages/orders/orders' : 'pages/home/home',
    miniprogram_state: config.environment === 'prod' ? 'formal' : 'trial',
    data: buildTemplateData(notification, config.templateFields)
  }

  const response = await config.fetcher(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  const body = await parseJsonResponse(response)

  if (!response.ok || body.errcode && body.errcode !== 0) {
    return createDeliveryResult(notification, {
      provider: 'wechat',
      status: 'failed',
      message: body.errmsg || String(body.errcode || response.status)
    })
  }

  return createDeliveryResult(notification, {
    provider: 'wechat',
    status: 'sent',
    message: 'wechat subscribe message sent'
  })
}

async function getWeChatAccessToken(config) {
  if (config.accessToken) {
    return config.accessToken
  }

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

function buildTemplateData(notification = {}, fields = {}) {
  const titleValue = truncateTemplateValue(notification.title || '交易提醒', 20)
  const bodyValue = truncateTemplateValue(notification.body || notification.type || '请查看交易进展', 20)
  const timeValue = formatTemplateTime(notification.createdAt || Date.now())

  return {
    [fields.title || 'thing1']: {
      value: titleValue
    },
    [fields.body || 'thing2']: {
      value: bodyValue
    },
    [fields.time || 'time3']: {
      value: timeValue
    }
  }
}

function createWeChatConfig(options = {}, environment, context = {}) {
  return {
    environment,
    appId: options.weixinAppId || process.env.GOODS_COMM_WECHAT_APP_ID,
    appSecret: options.weixinAppSecret || process.env.GOODS_COMM_WECHAT_APP_SECRET,
    accessToken: options.wechatAccessToken || process.env.GOODS_COMM_WECHAT_ACCESS_TOKEN || '',
    tokenUrl: options.wechatTokenUrl || process.env.GOODS_COMM_WECHAT_TOKEN_URL || WECHAT_TOKEN_URL,
    subscribeSendUrl: options.wechatSubscribeSendUrl ||
      process.env.GOODS_COMM_WECHAT_SUBSCRIBE_SEND_URL ||
      WECHAT_SUBSCRIBE_SEND_URL,
    templateIds: parseTemplateIds(
      options.wechatSubscribeTemplateIds ||
      process.env.GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS ||
      ''
    ),
    defaultTemplateId: options.wechatSubscribeTemplateId ||
      process.env.GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_ID ||
      '',
    templateFields: parseTemplateFields(
      options.wechatSubscribeTemplateFields ||
      process.env.GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_FIELDS ||
      ''
    ),
    fetcher: options.fetcher || context.fetcher || globalThis.fetch
  }
}

function assertWeChatConfigured(config) {
  if (!config.fetcher) {
    throw new Error('平台通知配置未完成：当前运行时缺少 fetch')
  }

  if (!config.accessToken) {
    assertConfigured('微信 AppID', config.appId)
    assertConfigured('微信 AppSecret', config.appSecret)
  }

  if (!config.defaultTemplateId && Object.keys(config.templateIds).length === 0) {
    throw new Error('平台通知配置未完成：微信订阅消息模板 ID')
  }

  for (const templateId of [config.defaultTemplateId, ...Object.values(config.templateIds)].filter(Boolean)) {
    assertConfigured('微信订阅消息模板 ID', templateId)
  }
}

function parseTemplateIds(value = '') {
  const text = String(value || '').trim()

  if (!text) {
    return {}
  }

  if (text.startsWith('{')) {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new Error('GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS 必须是 JSON 或 type:templateId 列表')
    }
  }

  return Object.fromEntries(text.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [type, ...templateParts] = entry.split(':')
      return [type.trim(), templateParts.join(':').trim()]
    })
    .filter(([type, templateId]) => type && templateId))
}

function parseTemplateFields(value = '') {
  const text = String(value || '').trim()

  if (!text) {
    return {}
  }

  if (text.startsWith('{')) {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new Error('GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_FIELDS 必须是 JSON 或 title:thing1 列表')
    }
  }

  return Object.fromEntries(text.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, ...fieldParts] = entry.split(':')
      return [name.trim(), fieldParts.join(':').trim()]
    })
    .filter(([name, field]) => name && field))
}

function createDeliveryResult(notification = {}, details = {}) {
  return {
    notificationId: notification.id || '',
    userId: notification.userId || '',
    type: notification.type || '',
    provider: details.provider || 'unknown',
    status: details.status || 'skipped',
    message: details.message || '',
    createdAt: Date.now()
  }
}

function assertConfigured(label, value) {
  if (!value || /REPLACE_WITH|placeholder|example\./i.test(String(value))) {
    throw new Error(`平台通知配置未完成：${label}`)
  }
}

function truncateTemplateValue(value = '', maxLength = 20) {
  const text = String(value || '').trim()
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function formatTemplateTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())
  const pad = (value) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function parseJsonResponse(response) {
  const text = await response.text()

  try {
    return text ? JSON.parse(text) : {}
  } catch (error) {
    throw new Error('平台通知服务响应不是有效 JSON')
  }
}

function defaultProvider(environment) {
  return PROTECTED_ENVIRONMENTS.has(environment) ? 'wechat' : 'mock'
}
