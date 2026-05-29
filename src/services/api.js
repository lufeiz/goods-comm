import { API_BASE_URL } from '../config/app.js'

let apiTransport = null

export function hasRemoteApi() {
  return Boolean(API_BASE_URL || apiTransport)
}

export function setApiTransportForTesting(transport) {
  apiTransport = transport
}

export function clearApiTransportForTesting() {
  apiTransport = null
}

export function requestApi(path, options = {}) {
  if (apiTransport) {
    return Promise.resolve(apiTransport(path, options))
  }

  if (!API_BASE_URL) {
    return Promise.reject(new Error('API_BASE_URL 未配置'))
  }

  return new Promise((resolve, reject) => {
    uni.request({
      url: `${API_BASE_URL}${path}`,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'content-type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        ...options.header
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data || res.data)
          return
        }

        reject(new Error(res.data?.message || `HTTP ${res.statusCode}`))
      },
      fail: reject
    })
  })
}

export function uploadApiFile(path, filePath, options = {}) {
  if (apiTransport) {
    return Promise.resolve(apiTransport(path, {
      ...options,
      method: 'UPLOAD',
      filePath
    }))
  }

  if (!API_BASE_URL) {
    return Promise.reject(new Error('API_BASE_URL 未配置'))
  }

  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE_URL}${path}`,
      filePath,
      name: options.name || 'file',
      formData: options.data || {},
      header: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        ...options.header
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parseUploadResponse(res.data))
          return
        }

        reject(new Error(`HTTP ${res.statusCode}`))
      },
      fail: reject
    })
  })
}

export function createIdempotencyKey(prefix, payload = {}) {
  const normalizedPrefix = String(prefix || 'request').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 32) || 'request'
  return `${normalizedPrefix}_${hashText(stableStringify(payload))}`
}

function parseUploadResponse(data) {
  if (!data || typeof data !== 'string') {
    return data
  }

  try {
    const parsed = JSON.parse(data)
    return parsed?.data || parsed
  } catch (error) {
    return data
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (!value || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function hashText(text = '') {
  let hash = 2166136261

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return Math.abs(hash >>> 0).toString(36)
}
