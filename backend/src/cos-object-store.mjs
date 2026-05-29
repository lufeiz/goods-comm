import { createHash, createHmac } from 'node:crypto'
import { extname } from 'node:path'

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024

export class CosObjectStore {
  type = 'cos'
  productionSafe = true

  constructor(options = {}) {
    this.bucket = options.bucket || process.env.GOODS_COMM_COS_BUCKET
    this.region = options.region || process.env.GOODS_COMM_COS_REGION
    this.secretId = options.secretId || process.env.GOODS_COMM_COS_SECRET_ID
    this.secretKey = options.secretKey || process.env.GOODS_COMM_COS_SECRET_KEY
    this.baseUrl = stripTrailingSlash(options.baseUrl || process.env.GOODS_COMM_COS_BASE_URL || createCosBaseUrl(this.bucket, this.region))
    this.publicBaseUrl = stripTrailingSlash(options.publicBaseUrl || process.env.GOODS_COMM_CDN_BASE_URL || process.env.GOODS_COMM_PUBLIC_ASSET_BASE_URL || this.baseUrl)
    this.maxImageBytes = Number(options.maxImageBytes || process.env.GOODS_COMM_MAX_IMAGE_BYTES || DEFAULT_MAX_IMAGE_BYTES)
    this.fetcher = options.fetcher || globalThis.fetch
  }

  async saveItemImage(file = {}) {
    this.assertConfigured()

    if (!this.fetcher) {
      throw new Error('COS 对象存储运行时缺少 fetch')
    }

    const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes || '')

    if (!bytes.length) {
      throw new Error('请上传有效图片文件')
    }

    if (bytes.length > this.maxImageBytes) {
      throw new Error(`图片大小不能超过 ${Math.round(this.maxImageBytes / 1024 / 1024)}MB`)
    }

    const mimeType = normalizeMimeType(file.mimeType)

    if (!mimeType.startsWith('image/')) {
      throw new Error('只支持上传图片文件')
    }

    const storageKey = `items/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${extensionFor(file.filename, mimeType)}`
    const url = new URL(`/${storageKey}`, this.baseUrl)
    const authorization = createCosAuthorization({
      method: 'PUT',
      url,
      secretId: this.secretId,
      secretKey: this.secretKey
    })
    const response = await this.fetcher(url, {
      method: 'PUT',
      headers: {
        authorization,
        'content-type': mimeType,
        'content-length': String(bytes.length),
        host: url.host
      },
      body: bytes
    })

    if (!response.ok) {
      throw new Error(`COS 图片上传失败：HTTP ${response.status}`)
    }

    return {
      storageKey,
      url: `${this.publicBaseUrl}/${storageKey}`,
      size: bytes.length,
      mimeType,
      originalName: file.filename || 'item-image',
      checksum: createHash('sha256').update(bytes).digest('hex'),
      status: 'uploaded'
    }
  }

  async readAsset(assetPath = '') {
    if (!this.fetcher) {
      throw new Error('COS 对象存储运行时缺少 fetch')
    }

    const storageKey = assetPath.replace(/^\/?assets\/?/, '')
    const response = await this.fetcher(`${this.publicBaseUrl}/${storageKey}`)

    if (response.status === 404) {
      const error = new Error('对象不存在')
      error.code = 'ENOENT'
      throw error
    }

    if (!response.ok) {
      throw new Error(`COS 图片读取失败：HTTP ${response.status}`)
    }

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type') || mimeTypeForPath(storageKey)
    }
  }

  assertConfigured() {
    for (const [label, value] of [
      ['COS bucket', this.bucket],
      ['COS region', this.region],
      ['COS secretId', this.secretId],
      ['COS secretKey', this.secretKey],
      ['COS baseUrl', this.baseUrl]
    ]) {
      if (!value || /REPLACE_WITH|placeholder|example\./i.test(String(value))) {
        throw new Error(`对象存储配置未完成：${label}`)
      }
    }
  }
}

export function createCosAuthorization({ method, url, secretId, secretKey, now = Math.floor(Date.now() / 1000) }) {
  const signTime = `${now};${now + 600}`
  const keyTime = signTime
  const pathname = encodeCosPath(url.pathname)
  const httpString = `${method.toLowerCase()}\n${pathname}\n\nhost=${url.host.toLowerCase()}\n`
  const stringToSign = `sha1\n${signTime}\n${sha1Hex(httpString)}\n`
  const signKey = hmacSha1Hex(secretKey, keyTime)
  const signature = hmacSha1Hex(signKey, stringToSign)

  return [
    'q-sign-algorithm=sha1',
    `q-ak=${secretId}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${keyTime}`,
    'q-header-list=host',
    'q-url-param-list=',
    `q-signature=${signature}`
  ].join('&')
}

function createCosBaseUrl(bucket, region) {
  if (!bucket || !region) {
    return ''
  }

  return `https://${bucket}.cos.${region}.myqcloud.com`
}

function normalizeMimeType(value = '') {
  return String(value || 'application/octet-stream').split(';')[0].trim().toLowerCase()
}

function extensionFor(filename = '', mimeType = '') {
  const current = extname(filename || '').toLowerCase()

  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(current)) {
    return current
  }

  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
  }

  return map[mimeType] || '.jpg'
}

function mimeTypeForPath(storageKey = '') {
  const ext = extname(storageKey).toLowerCase()
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  }

  return map[ext] || 'application/octet-stream'
}

function stripTrailingSlash(value = '') {
  return String(value || '').trim().replace(/\/+$/, '')
}

function encodeCosPath(pathname) {
  return pathname
    .split('/')
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join('/')
}

function sha1Hex(value) {
  return createHash('sha1').update(value).digest('hex')
}

function hmacSha1Hex(key, value) {
  return createHmac('sha1', key).update(value).digest('hex')
}
