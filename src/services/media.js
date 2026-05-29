import { hasRemoteApi, uploadApiFile } from './api.js'

export async function uploadItemImages(images = [], user) {
  const normalized = normalizeImages(images)

  if (!normalized.length) {
    throw new Error('请至少添加 1 张物品照片')
  }

  if (!hasRemoteApi()) {
    return normalized.map((image) => ({
      ...image,
      status: image.status || 'local_pending_upload'
    }))
  }

  const uploaded = []

  for (const image of normalized) {
    if (isTrustedUploadedImageReference(image)) {
      uploaded.push(image)
      continue
    }

    const result = await uploadApiFile('/uploads/items', image.url, {
      token: user?.token,
      data: {
        usage: 'item_image'
      }
    })

    uploaded.push(normalizeUploadedImage(result, image))
  }

  return uploaded
}

function isTrustedUploadedImageReference(image = {}) {
  return image.status === 'uploaded' &&
    Boolean(image.url) &&
    Boolean(image.id || image.storageKey || image.checksum || image.traceId)
}

export function normalizeImages(images = []) {
  return images
    .filter(Boolean)
    .slice(0, 6)
    .map((image) => typeof image === 'string'
      ? {
          url: image,
          status: 'local_pending_upload'
        }
      : {
          ...image,
          url: image.url || image.path || ''
        })
    .filter((image) => image.url)
}

function normalizeUploadedImage(result, fallback) {
  if (typeof result === 'string') {
    return {
      url: result,
      status: 'uploaded'
    }
  }

  return {
    ...fallback,
    ...result,
    url: result?.url || result?.fileUrl || fallback.url,
    status: result?.status || 'uploaded'
  }
}
