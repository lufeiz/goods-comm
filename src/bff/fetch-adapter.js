import { createBffState, handleBffRequest } from './handler.js'
import { normalizeBffHttpError } from './http-error.js'

export const defaultBffState = createBffState()

export function createBffFetchHandler(state = createBffState(), options = {}) {
  const runtimeOptions = {
    ...options,
    allowedOrigins: options.allowedOrigins ?? getEnvironmentValue('GOODS_COMM_ALLOWED_ORIGINS')
  }

  return (request) => handleBffFetchRequest(request, state, runtimeOptions)
}

export async function handleBffFetchRequest(request, state = defaultBffState, options = {}) {
  const corsContext = createCorsContext(request, options.allowedOrigins)
  const environment = normalizeEnvironmentName(options.environment || getEnvironmentValue('GOODS_COMM_ENV') || getEnvironmentValue('VITE_APP_ENV') || 'dev')

  if (!corsContext.allowed) {
    return jsonResponse({
      code: 'FORBIDDEN',
      message: 'CORS 来源不允许'
    }, 403, corsContext)
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(corsContext)
    })
  }

  if (isProtectedRuntime(environment)) {
    return jsonResponse({
      code: 'SERVICE_UNAVAILABLE',
      message: `${environment} 环境不能使用轻量 Fetch adapter 直接承载生产流量，请部署 backend/src/server.mjs 这条完整后端链路`
    }, 503, corsContext)
  }

  try {
    const url = new URL(request.url)
    const isUpload = url.pathname === '/uploads/items' && request.method === 'POST'

    if (url.pathname.startsWith('/ops/') || url.pathname.startsWith('/moderation/')) {
      assertModerationSecret(request, url, options)
    }

    const result = await handleBffRequest(url.pathname, {
      method: isUpload ? 'UPLOAD' : request.method,
      data: await parseRequestData(request, url),
      header: {
        Authorization: request.headers.get('authorization') || '',
        'Idempotency-Key': request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key') || ''
      }
    }, state)

    return jsonResponse({
      data: result
    }, 200, corsContext)
  } catch (error) {
    const httpError = normalizeBffHttpError(error)

    return jsonResponse({
      code: httpError.code,
      message: error.message || '请求处理失败'
    }, httpError.status, corsContext)
  }
}

async function parseRequestData(request, url) {
  if (request.method === 'GET') {
    return Object.fromEntries(url.searchParams.entries())
  }

  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return request.json()
  }

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    return Object.fromEntries(form.entries())
  }

  return {}
}

function jsonResponse(payload, status = 200, corsContext = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(corsContext),
      'content-type': 'application/json; charset=utf-8'
    }
  })
}

function corsHeaders(corsContext = {}) {
  return {
    ...(corsContext.headers || { 'access-control-allow-origin': '*' }),
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-trace-id,idempotency-key,x-idempotency-key,x-moderation-secret,x-ops-session-token,x-ops-actor-id'
  }
}

function assertModerationSecret(request, url, options = {}) {
  const environment = normalizeEnvironmentName(options.environment || getEnvironmentValue('GOODS_COMM_ENV') || getEnvironmentValue('VITE_APP_ENV') || 'dev')
  const expected = options.moderationSecret || getEnvironmentValue('GOODS_COMM_MODERATION_WEBHOOK_SECRET') || ''
  const actual = request.headers.get('x-moderation-secret') || url.searchParams.get('secret') || ''

  if (!expected || /REPLACE_WITH|placeholder|example\./i.test(String(expected))) {
    throw new Error(`${environment} 环境审核回调密钥未配置`)
  }

  if (actual !== expected) {
    throw new Error('审核回调密钥无效')
  }
}

function createCorsContext(request, allowedOrigins = '') {
  const policy = createCorsPolicy(allowedOrigins)
  const origin = normalizeOrigin(request.headers.get('origin') || '')

  if (policy.wildcard) {
    return {
      allowed: true,
      headers: {
        'access-control-allow-origin': '*'
      }
    }
  }

  if (!origin) {
    return {
      allowed: true,
      headers: {
        vary: 'Origin'
      }
    }
  }

  if (policy.allowedOrigins.has(origin)) {
    return {
      allowed: true,
      headers: {
        'access-control-allow-origin': origin,
        vary: 'Origin'
      }
    }
  }

  return {
    allowed: false,
    headers: {
      vary: 'Origin'
    }
  }
}

function createCorsPolicy(allowedOrigins = '') {
  const origins = Array.isArray(allowedOrigins)
    ? allowedOrigins
    : String(allowedOrigins || '').split(',')
  const normalizedOrigins = origins
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean)

  return {
    wildcard: normalizedOrigins.length === 0 || normalizedOrigins.includes('*'),
    allowedOrigins: new Set(normalizedOrigins.filter((origin) => origin !== '*'))
  }
}

function normalizeOrigin(value = '') {
  const origin = String(value || '').trim()

  if (origin === '*') {
    return origin
  }

  return origin.replace(/\/$/, '')
}

function getEnvironmentValue(key) {
  if (typeof process === 'undefined' || !process.env) {
    return ''
  }

  return process.env[key] || ''
}

function normalizeEnvironmentName(value = '') {
  const normalized = String(value || '').trim().toLowerCase()
  return ['dev', 'test', 'pre', 'prod'].includes(normalized) ? normalized : 'dev'
}

function isProtectedRuntime(environment) {
  return ['pre', 'prod'].includes(environment)
}
