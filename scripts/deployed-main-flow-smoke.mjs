import {
  containsPlaceholder,
  normalizeEnvironmentName,
  readEnvironmentFile
} from './env-files.mjs'
import { USER_AGREEMENT_VERSION } from '../src/config/app.js'

const environment = getEnvironmentArg()
const values = await readEnvironmentFile(environment)
const apiBaseUrl = normalizeBaseUrl(process.env.GOODS_COMM_SMOKE_API_BASE_URL || values.VITE_API_BASE_URL)
const latitude = parseRequiredNumber('GOODS_COMM_SMOKE_LATITUDE')
const longitude = parseRequiredNumber('GOODS_COMM_SMOKE_LONGITUDE')
const accuracy = parseOptionalNumber('GOODS_COMM_SMOKE_ACCURACY', 30)
const smokeCapturedAt = parseOptionalNumber('GOODS_COMM_SMOKE_CAPTURED_AT', Date.now())
const sellerProvider = process.env.GOODS_COMM_SMOKE_SELLER_PROVIDER || 'weixin'
const buyerProvider = process.env.GOODS_COMM_SMOKE_BUYER_PROVIDER || sellerProvider
const sellerCode = process.env.GOODS_COMM_SMOKE_SELLER_CODE || ''
const buyerCode = process.env.GOODS_COMM_SMOKE_BUYER_CODE || ''
const scopeType = process.env.GOODS_COMM_SMOKE_SCOPE_TYPE || 'community'
const radiusMeters = parseOptionalNumber('GOODS_COMM_SMOKE_RADIUS_METERS', scopeType === 'street' ? 4000 : 1200)
const smokeRunId = normalizeSmokeRunId(process.env.GOODS_COMM_SMOKE_RUN_ID || `${environment}-${Date.now()}`)
const itemTitle = `部署主链路烟测-${smokeRunId}`
const idempotencyKeys = {
  itemCreate: `deployed:${smokeRunId}:item:create`,
  tradeCreate: `deployed:${smokeRunId}:trade:create`,
  tradeCreateAfterSold: `deployed:${smokeRunId}:trade:create-after-sold`,
  tradeConfirm: `deployed:${smokeRunId}:trade:confirm`,
  tradeComplete: `deployed:${smokeRunId}:trade:complete`,
  tradeReview: `deployed:${smokeRunId}:trade:review`
}

validateInputs()

const seller = await post('/auth/login', {
  provider: sellerProvider,
  code: sellerCode,
  agreement: createAgreement('deployed-main-flow:seller'),
  userInfo: {
    nickname: `部署烟测卖家-${environment}`,
    avatarUrl: ''
  }
})
assert(Boolean(seller.token), 'seller login did not return token')

const buyer = await post('/auth/login', {
  provider: buyerProvider,
  code: buyerCode,
  agreement: createAgreement('deployed-main-flow:buyer'),
  userInfo: {
    nickname: `部署烟测买家-${environment}`,
    avatarUrl: ''
  }
})
assert(Boolean(buyer.token), 'buyer login did not return token')

const location = {
  latitude: latitude.value,
  longitude: longitude.value,
  accuracy: accuracy.value,
  capturedAt: smokeCapturedAt.value
}
const region = await post('/lbs/resolve-region', {
  latitude: latitude.value,
  longitude: longitude.value,
  coordType: 'gcj02'
}, seller.token)

assert(region.communityId || region.streetId, 'region resolution did not return communityId or streetId')

const uploadedImage = await uploadSmokeImage(seller.token)
const itemImage = selectPublishImage(uploadedImage)
const itemPayload = {
  title: itemTitle,
  price: 1,
  category: 'home',
  condition: 'good',
  description: `部署后主链路烟测 ${environment}`,
  images: [itemImage],
  tradeScope: {
    type: scopeType,
    label: scopeType === 'street' ? '同街道' : '同社区',
    radiusMeters: radiusMeters.value
  },
  location: {
    ...location,
    scopeType,
    radiusMeters: radiusMeters.value
  }
}
const item = await post('/items', itemPayload, seller.token, idempotencyOptions(idempotencyKeys.itemCreate))
const replayedItem = await post('/items', itemPayload, seller.token, idempotencyOptions(idempotencyKeys.itemCreate))

assertEqual(item.status, 'online', 'published item status')
assertEqual(replayedItem.id, item.id, 'replayed item id')
assertEqual(item.location.communityId || region.communityId, region.communityId || item.location.communityId, 'published item region')

const list = await get(`/items?latitude=${encodeURIComponent(latitude.value)}&longitude=${encodeURIComponent(longitude.value)}`)
assert(toArray(list.items).some((candidate) => candidate.id === item.id), 'published item did not appear in public list')

const tradePayload = {
  itemId: item.id,
  buyerLocation: {
    ...location,
    capturedAt: smokeCapturedAt.value
  }
}
const trade = await post('/trades', tradePayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeCreate))
const replayedTrade = await post('/trades', tradePayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeCreate))

assertEqual(trade.status, 'pending_seller_confirm', 'created trade status')
assertEqual(replayedTrade.id, trade.id, 'replayed trade id')

const confirmPayload = {
  status: 'pending_meetup'
}
const confirmed = await patch(`/trades/${trade.id}/status`, confirmPayload, seller.token, idempotencyOptions(idempotencyKeys.tradeConfirm))
const replayedConfirmed = await patch(`/trades/${trade.id}/status`, confirmPayload, seller.token, idempotencyOptions(idempotencyKeys.tradeConfirm))

assertEqual(confirmed.status, 'pending_meetup', 'confirmed trade status')
assertEqual(replayedConfirmed.id, confirmed.id, 'replayed confirmed trade id')
assert(Boolean(confirmed.contactCode), 'confirmed trade did not expose contactCode')

const completePayload = {
  status: 'completed'
}
const completed = await patch(`/trades/${trade.id}/status`, completePayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeComplete))
const replayedCompleted = await patch(`/trades/${trade.id}/status`, completePayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeComplete))

assertEqual(completed.status, 'completed', 'completed trade status')
assertEqual(replayedCompleted.id, completed.id, 'replayed completed trade id')
const soldItem = await get(`/items/${encodeURIComponent(item.id)}`)
assertEqual(soldItem.status, 'sold', 'completed trade item status')
const postSoldTradeError = await postExpectError('/trades', tradePayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeCreateAfterSold))
assertEqual(postSoldTradeError.status, 409, 'post-sale trade rejection status')
assertEqual(postSoldTradeError.code, 'CONFLICT', 'post-sale trade rejection code')
assert(/已完成交易/.test(postSoldTradeError.message || ''), 'post-sale trade rejection message')
const reviewPayload = {
  rating: 5,
  content: `部署后交易评价烟测 ${environment}`,
  tags: ['准时']
}
const review = await post(`/trades/${trade.id}/review`, reviewPayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeReview))
const replayedReview = await post(`/trades/${trade.id}/review`, reviewPayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeReview))
assertEqual(review.tradeId, trade.id, 'created review trade id')
assertEqual(replayedReview.id, review.id, 'replayed review id')
assertEqual(review.reviewee.id, seller.user.id, 'created review reviewee')
const reviews = await get(`/reviews?itemId=${encodeURIComponent(item.id)}`)
assert(toArray(reviews.reviews).some((candidate) => candidate.id === review.id), 'created review did not appear in item review list')

const soldList = await get(`/items?latitude=${encodeURIComponent(latitude.value)}&longitude=${encodeURIComponent(longitude.value)}`)
assert(!toArray(soldList.items).some((candidate) => candidate.id === item.id), 'sold item still appears in public list')

const logout = await post('/auth/logout', {}, buyer.token)
assertEqual(logout.ok, true, 'buyer logout')
const revokedAuth = await getExpectError('/items/mine', buyer.token)
assertEqual(revokedAuth.status, 401, 'revoked buyer token status')
assertEqual(revokedAuth.code, 'UNAUTHENTICATED', 'revoked buyer token code')
assert(/登录态无效/.test(revokedAuth.message || ''), 'revoked buyer token message')

console.log(`Deployed main-flow smoke passed for ${environment}: ${apiBaseUrl}`)

function validateInputs() {
  const missing = []

  if (!apiBaseUrl) {
    missing.push(`[${environment}] VITE_API_BASE_URL is required for deployed main-flow smoke`)
  }

  if (containsPlaceholder(apiBaseUrl)) {
    missing.push(`[${environment}] VITE_API_BASE_URL still contains a placeholder`)
  }

  if (['test', 'pre', 'prod'].includes(environment) && !apiBaseUrl.startsWith('https://')) {
    missing.push(`[${environment}] deployed main-flow smoke requires HTTPS VITE_API_BASE_URL`)
  }

  if (environment === 'prod' && process.env.GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION !== 'true') {
    missing.push('[prod] refusing to mutate production without GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=true')
  }

  if (!sellerCode) {
    missing.push('GOODS_COMM_SMOKE_SELLER_CODE is required')
  }

  if (!buyerCode) {
    missing.push('GOODS_COMM_SMOKE_BUYER_CODE is required')
  }

  for (const parsed of [latitude, longitude, accuracy, smokeCapturedAt, radiusMeters]) {
    if (parsed.error) {
      missing.push(parsed.error)
    }
  }

  if (!['community', 'street'].includes(scopeType)) {
    missing.push('GOODS_COMM_SMOKE_SCOPE_TYPE must be community or street')
  }

  if (missing.length) {
    throw new Error(`Deployed main-flow smoke preconditions are missing:\n- ${missing.join('\n- ')}`)
  }
}

function selectPublishImage(uploadedImage) {
  if (uploadedImage.status === 'uploaded') {
    return uploadedImage
  }

  const approvedUrl = process.env.GOODS_COMM_SMOKE_APPROVED_IMAGE_URL || ''

  if (!approvedUrl) {
    throw new Error(`Uploaded smoke image status is ${uploadedImage.status}; set GOODS_COMM_SMOKE_APPROVED_IMAGE_URL to a pre-approved HTTPS image for full publish/trade smoke`)
  }

  if (!approvedUrl.startsWith('https://') || containsPlaceholder(approvedUrl)) {
    throw new Error('GOODS_COMM_SMOKE_APPROVED_IMAGE_URL must be a real HTTPS image URL')
  }

  return {
    id: `smoke-approved-image-${Date.now()}`,
    url: approvedUrl,
    storageKey: process.env.GOODS_COMM_SMOKE_APPROVED_IMAGE_STORAGE_KEY || 'smoke/approved-image.jpg',
    size: parseOptionalNumber('GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE', 1).value,
    mimeType: process.env.GOODS_COMM_SMOKE_APPROVED_IMAGE_MIME_TYPE || 'image/jpeg',
    originalName: 'approved-smoke-image.jpg',
    checksum: process.env.GOODS_COMM_SMOKE_APPROVED_IMAGE_CHECKSUM || '',
    status: 'uploaded'
  }
}

async function uploadSmokeImage(token) {
  const form = new FormData()
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])

  form.append('usage', 'item_image')
  form.append('file', new Blob([bytes], {
    type: 'image/png'
  }), 'deployed-smoke-item.png')

  return request('/uploads/items', {
    method: 'POST',
    token,
    body: form
  })
}

async function get(path, token = '') {
  return request(path, {
    method: 'GET',
    token
  })
}

async function getExpectError(path, token = '') {
  return requestExpectError(path, {
    method: 'GET',
    token
  })
}

async function post(path, data, token = '', options = {}) {
  return request(path, {
    method: 'POST',
    token,
    data,
    ...options
  })
}

async function postExpectError(path, data, token = '', options = {}) {
  return requestExpectError(path, {
    method: 'POST',
    token,
    data,
    ...options
  })
}

async function patch(path, data, token = '', options = {}) {
  return request(path, {
    method: 'PATCH',
    token,
    data,
    ...options
  })
}

async function request(path, options = {}) {
  const { response, payload } = await requestEnvelope(path, options)

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} returned HTTP ${response.status}: ${payload.message || payload.code || 'unknown error'}`)
  }

  return payload.data
}

async function requestExpectError(path, options = {}) {
  const { response, payload } = await requestEnvelope(path, options)

  if (response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} unexpectedly succeeded`)
  }

  return {
    ...payload,
    status: response.status
  }
}

async function requestEnvelope(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.header || {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
  }
  let body = options.body

  if (options.data !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.data)
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body
  })
  const payload = await parseResponse(response)

  return {
    response,
    payload
  }
}

async function parseResponse(response) {
  const text = await response.text()

  try {
    return text ? JSON.parse(text) : {}
  } catch (error) {
    throw new Error(`response was not valid JSON: HTTP ${response.status}`)
  }
}

function parseRequiredNumber(name) {
  const value = Number(process.env[name])

  if (!Number.isFinite(value)) {
    return {
      value: null,
      error: `${name} is required and must be a finite number`
    }
  }

  return {
    value,
    error: ''
  }
}

function parseOptionalNumber(name, fallback) {
  const raw = process.env[name]

  if (raw === undefined || raw === '') {
    return {
      value: fallback,
      error: ''
    }
  }

  const value = Number(raw)

  if (!Number.isFinite(value)) {
    return {
      value: fallback,
      error: `${name} must be a finite number`
    }
  }

  return {
    value,
    error: ''
  }
}

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '')
}

function getEnvironmentArg() {
  const envIndex = process.argv.findIndex((arg) => arg === '--env')
  const value = envIndex >= 0 ? process.argv[envIndex + 1] : process.argv[2]

  return normalizeEnvironmentName(value || process.env.GOODS_COMM_ENV || 'pre')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`)
  }
}

function idempotencyOptions(key) {
  return {
    header: {
      'Idempotency-Key': key
    }
  }
}

function normalizeSmokeRunId(value = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

  return normalized || `${environment}-${Date.now()}`
}

function createAgreement(source) {
  return {
    version: USER_AGREEMENT_VERSION,
    acceptedAt: Date.now(),
    source
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : []
}
