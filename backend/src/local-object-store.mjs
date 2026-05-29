import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, normalize, resolve, sep } from 'node:path'

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024
const DEFAULT_PUBLIC_BASE_URL = '/assets'

export class LocalObjectStore {
  type = 'local'

  constructor(options = {}) {
    this.rootDir = resolve(options.rootDir || process.env.GOODS_COMM_OBJECT_DIR || '.data/object-store')
    this.publicBaseUrl = options.publicBaseUrl || process.env.GOODS_COMM_PUBLIC_ASSET_BASE_URL || DEFAULT_PUBLIC_BASE_URL
    this.maxImageBytes = Number(options.maxImageBytes || process.env.GOODS_COMM_MAX_IMAGE_BYTES || DEFAULT_MAX_IMAGE_BYTES)
  }

  async saveItemImage(file = {}) {
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
    const absolutePath = this.resolveStoragePath(storageKey)

    await mkdir(resolve(absolutePath, '..'), {
      recursive: true
    })
    await writeFile(absolutePath, bytes)

    return {
      storageKey,
      url: `${this.publicBaseUrl.replace(/\/$/, '')}/${storageKey}`,
      size: bytes.length,
      mimeType,
      originalName: file.filename || 'item-image',
      checksum: createHash('sha256').update(bytes).digest('hex'),
      status: 'uploaded'
    }
  }

  async readAsset(assetPath = '') {
    const storageKey = assetPath.replace(/^\/?assets\/?/, '')
    const absolutePath = this.resolveStoragePath(storageKey)
    const bytes = await readFile(absolutePath)

    return {
      bytes,
      mimeType: mimeTypeForPath(storageKey)
    }
  }

  resolveStoragePath(storageKey = '') {
    const normalizedKey = normalize(storageKey).replace(/^(\.\.[/\\])+/, '')
    const absolutePath = resolve(this.rootDir, normalizedKey)

    if (absolutePath !== this.rootDir && !absolutePath.startsWith(`${this.rootDir}${sep}`)) {
      throw new Error('对象存储路径无效')
    }

    return absolutePath
  }
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
