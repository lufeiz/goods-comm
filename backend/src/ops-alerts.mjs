const PROTECTED_ENVIRONMENTS = new Set(['pre', 'prod'])
const SUPPORTED_ALERT_PROVIDERS = new Set(['none', 'webhook'])
const DEFAULT_ALERT_TIMEOUT_MS = 3000

export function createOpsAlertClient(options = {}) {
  const environment = normalizeEnvironment(options.environment || process.env.GOODS_COMM_ENV || 'dev')
  const provider = normalizeAlertProvider(
    options.alertProvider ||
    process.env.GOODS_COMM_ALERT_PROVIDER ||
    'none'
  )
  const config = {
    environment,
    provider,
    webhookUrl: String(options.alertWebhookUrl || process.env.GOODS_COMM_ALERT_WEBHOOK_URL || '').trim(),
    webhookToken: String(options.alertWebhookToken || process.env.GOODS_COMM_ALERT_WEBHOOK_TOKEN || '').trim(),
    timeoutMs: normalizeTimeoutMs(options.alertTimeoutMs || process.env.GOODS_COMM_ALERT_TIMEOUT_MS || DEFAULT_ALERT_TIMEOUT_MS),
    fetcher: options.fetcher || globalThis.fetch
  }

  return {
    provider,
    describe() {
      return describeAlertConfig(config)
    },
    async check() {
      if (PROTECTED_ENVIRONMENTS.has(environment) && provider !== 'webhook') {
        throw new Error(`${environment} 环境必须配置 GOODS_COMM_ALERT_PROVIDER=webhook`)
      }

      if (provider === 'webhook') {
        assertWebhookConfigured(config)
      }

      return {
        ok: true,
        ...describeAlertConfig(config)
      }
    },
    async alert(event = {}) {
      if (provider === 'none') {
        return {
          sent: false,
          provider,
          status: 'skipped',
          reason: 'ops alerting disabled'
        }
      }

      assertWebhookConfigured(config)

      const payload = sanitizeAlertPayload({
        service: 'goods-comm-backend',
        environment,
        emittedAt: new Date().toISOString(),
        ...event
      })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

      try {
        const response = await config.fetcher(config.webhookUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.webhookToken ? { authorization: `Bearer ${config.webhookToken}` } : {})
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        })

        if (!response?.ok) {
          const detail = await safeResponseText(response)
          throw new Error(`生产告警 Webhook 返回 HTTP ${response?.status || 'unknown'}${detail ? `: ${detail}` : ''}`)
        }

        return {
          sent: true,
          provider,
          status: 'sent',
          statusCode: response.status || 200
        }
      } finally {
        clearTimeout(timeout)
      }
    }
  }
}

export function normalizeAlertProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  if (SUPPORTED_ALERT_PROVIDERS.has(normalized)) {
    return normalized
  }

  throw new Error(`GOODS_COMM_ALERT_PROVIDER 只能是 none/webhook，当前为 ${value || '空'}`)
}

function describeAlertConfig(config) {
  return {
    provider: config.provider,
    configured: config.provider === 'webhook' &&
      Boolean(config.webhookUrl) &&
      !containsPlaceholder(config.webhookUrl) &&
      (!PROTECTED_ENVIRONMENTS.has(config.environment) || Boolean(config.webhookToken && !containsPlaceholder(config.webhookToken))),
    timeoutMs: config.timeoutMs
  }
}

function assertWebhookConfigured(config) {
  if (!config.fetcher) {
    throw new Error('生产告警配置未完成：当前运行时缺少 fetch')
  }

  assertConfigured('生产告警 Webhook URL', config.webhookUrl)

  let parsedUrl
  try {
    parsedUrl = new URL(config.webhookUrl)
  } catch {
    throw new Error('生产告警配置未完成：生产告警 Webhook URL 不是合法 URL')
  }

  if (PROTECTED_ENVIRONMENTS.has(config.environment) && parsedUrl.protocol !== 'https:') {
    throw new Error('生产告警配置未完成：pre/prod 告警 Webhook 必须使用 HTTPS')
  }

  if (PROTECTED_ENVIRONMENTS.has(config.environment)) {
    assertConfigured('生产告警 Webhook Token', config.webhookToken)
  }
}

function assertConfigured(label, value) {
  const normalized = String(value || '').trim()

  if (!normalized || containsPlaceholder(normalized)) {
    throw new Error(`生产告警配置未完成：${label}`)
  }
}

function normalizeEnvironment(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  return normalized || 'dev'
}

function normalizeTimeoutMs(value) {
  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`GOODS_COMM_ALERT_TIMEOUT_MS must be a positive integer, got ${value}`)
  }

  return parsed
}

function containsPlaceholder(value = '') {
  const normalized = String(value || '').trim()

  return /REPLACE_WITH|placeholder|example\.com/i.test(normalized)
}

function sanitizeAlertPayload(value, depth = 0) {
  if (value === null || value === undefined) {
    return undefined
  }

  if (depth > 4) {
    return '[truncated]'
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeAlertPayload(entry, depth + 1))
  }

  if (typeof value === 'object') {
    const sanitized = {}

    for (const [key, childValue] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        continue
      }

      const sanitizedValue = sanitizeAlertPayload(childValue, depth + 1)
      if (sanitizedValue !== undefined) {
        sanitized[key] = sanitizedValue
      }
    }

    return sanitized
  }

  if (typeof value === 'string') {
    return value.length > 1000 ? `${value.slice(0, 1000)}...` : value
  }

  return value
}

function isSensitiveKey(key = '') {
  return /token|secret|password|authorization|private[_-]?key/i.test(key)
}

async function safeResponseText(response) {
  if (!response || typeof response.text !== 'function') {
    return ''
  }

  try {
    const text = await response.text()
    return String(text || '').slice(0, 200)
  } catch {
    return ''
  }
}
