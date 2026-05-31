import {
  containsPlaceholder,
  loadSmokeEnvironmentFile,
  normalizeEnvironmentName,
  readEnvironmentFile
} from './env-files.mjs'
import { USER_AGREEMENT_VERSION } from '../src/config/app.js'

const environment = getEnvironmentArg()
const values = await readEnvironmentFile(environment)
await loadSmokeEnvironmentFile(environment)
const apiBaseUrl = normalizeBaseUrl(process.env.GOODS_COMM_SMOKE_API_BASE_URL || values.VITE_API_BASE_URL)
const latitude = parseRequiredNumber('GOODS_COMM_SMOKE_LATITUDE')
const longitude = parseRequiredNumber('GOODS_COMM_SMOKE_LONGITUDE')
const accuracy = parseOptionalNumber('GOODS_COMM_SMOKE_ACCURACY', 30)
const smokeCapturedAt = parseOptionalNumber('GOODS_COMM_SMOKE_CAPTURED_AT', Date.now())
const sellerProvider = process.env.GOODS_COMM_SMOKE_SELLER_PROVIDER || 'weixin'
const buyerProvider = process.env.GOODS_COMM_SMOKE_BUYER_PROVIDER || sellerProvider
const sellerCode = process.env.GOODS_COMM_SMOKE_SELLER_CODE || ''
const buyerCode = process.env.GOODS_COMM_SMOKE_BUYER_CODE || ''
const accountDeleteProvider = process.env.GOODS_COMM_SMOKE_ACCOUNT_DELETE_PROVIDER || sellerProvider
const accountDeleteCode = normalizeOptionalSmokeInput(process.env.GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE || '')
const accountDeleteReloginCode = normalizeOptionalSmokeInput(process.env.GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE || '')
const shouldRunAccountDeleteSmoke = Boolean(accountDeleteCode)
const scopeType = process.env.GOODS_COMM_SMOKE_SCOPE_TYPE || 'community'
const radiusMeters = parseOptionalNumber('GOODS_COMM_SMOKE_RADIUS_METERS', scopeType === 'street' ? 4000 : 1200)
const smokeRunId = normalizeSmokeRunId(process.env.GOODS_COMM_SMOKE_RUN_ID || `${environment}-${Date.now()}`)
const itemTitle = `部署主链路烟测-${smokeRunId}`
const idempotencyKeys = {
  itemCreate: `deployed:${smokeRunId}:item:create`,
  tradeCreateSelf: `deployed:${smokeRunId}:trade:create-self`,
  tradeCreate: `deployed:${smokeRunId}:trade:create`,
  tradeCreateDuplicate: `deployed:${smokeRunId}:trade:create-duplicate`,
  tradeConfirmByBuyer: `deployed:${smokeRunId}:trade:confirm-by-buyer`,
  tradeCreateAfterSold: `deployed:${smokeRunId}:trade:create-after-sold`,
  tradeConfirm: `deployed:${smokeRunId}:trade:confirm`,
  tradeComplete: `deployed:${smokeRunId}:trade:complete`,
  tradeReview: `deployed:${smokeRunId}:trade:review`,
  accountDeleteItem: `deployed:${smokeRunId}:account-delete:item:create`
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

const unauthenticatedUpload = await uploadSmokeImageExpectError('')
assertEqual(unauthenticatedUpload.status, 401, 'unauthenticated image upload status')
assertEqual(unauthenticatedUpload.code, 'UNAUTHENTICATED', 'unauthenticated image upload code')

const uploadedImage = await uploadSmokeImage(seller.token)
const itemImage = selectPublishImage(uploadedImage)
const itemPayload = {
  title: itemTitle,
  price: 1,
  category: 'home',
  condition: 'good',
  description: `部署后主链路烟测 ${environment}`,
  images: [itemImage],
  sellerOpenid: `client-spoof-openid-${smokeRunId}`,
  platformId: `client-spoof-platform-${smokeRunId}`,
  contentSafetyOpenid: `client-spoof-content-safety-${smokeRunId}`,
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
assertPublicItemPrivacy(item, 'published item response')
assertNoReviewIdentityFields(item, 'published item response')
assertNoReviewIdentityFields(replayedItem, 'replayed item response')

const list = await get(`/items?latitude=${encodeURIComponent(latitude.value)}&longitude=${encodeURIComponent(longitude.value)}&accuracy=${encodeURIComponent(accuracy.value)}&capturedAt=${encodeURIComponent(smokeCapturedAt.value)}`)
const listedItem = toArray(list.items).find((candidate) => candidate.id === item.id)
assert(listedItem, 'published item did not appear in public list')
assertPublicItemPrivacy(listedItem, 'public list item')
assertNoReviewIdentityFields(listedItem, 'public list item')
assert(Number.isFinite(Number(listedItem.distanceMeters)), 'public list item distanceMeters')

const tradePayload = {
  itemId: item.id,
  buyerLocation: {
    ...location,
    capturedAt: smokeCapturedAt.value
  }
}
const selfPurchaseTradeError = await postExpectError('/trades', tradePayload, seller.token, idempotencyOptions(idempotencyKeys.tradeCreateSelf))
assertEqual(selfPurchaseTradeError.status, 403, 'self-purchase trade rejection status')
assertEqual(selfPurchaseTradeError.code, 'FORBIDDEN', 'self-purchase trade rejection code')
assert(/不能购买自己/.test(selfPurchaseTradeError.message || ''), 'self-purchase trade rejection message')

const trade = await post('/trades', tradePayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeCreate))
const replayedTrade = await post('/trades', tradePayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeCreate))
const duplicateActiveTrade = await post('/trades', tradePayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeCreateDuplicate))

assertEqual(trade.status, 'pending_seller_confirm', 'created trade status')
assertEqual(replayedTrade.id, trade.id, 'replayed trade id')
assertEqual(duplicateActiveTrade.id, trade.id, 'duplicate active trade id')
assertEqual(duplicateActiveTrade.status, 'pending_seller_confirm', 'duplicate active trade status')
assertTradeContactHidden(duplicateActiveTrade, 'duplicate active trade')
const sellerTradesAfterCreate = await get('/trades', seller.token)
const sellerCreatedTrade = findTrade(sellerTradesAfterCreate, trade.id, 'pending_seller_confirm', 'seller created trade list')
assertTradeContactHidden(sellerCreatedTrade, 'seller pending trade')
const buyerTradesAfterCreate = await get('/trades', buyer.token)
const buyerCreatedTrade = findTrade(buyerTradesAfterCreate, trade.id, 'pending_seller_confirm', 'buyer created trade list')
assertTradeContactHidden(buyerCreatedTrade, 'buyer pending trade')
const sellerNotificationsAfterCreate = await get('/notifications', seller.token)
const sellerTradeCreatedNotification = findNotification(sellerNotificationsAfterCreate, 'trade_created', trade.id, 'seller trade created notification')
const readSellerTradeCreatedNotification = await patch(`/notifications/${sellerTradeCreatedNotification.id}/read`, {}, seller.token)
assertEqual(readSellerTradeCreatedNotification.id, sellerTradeCreatedNotification.id, 'read seller trade-created notification id')
assert(Boolean(readSellerTradeCreatedNotification.readAt), 'seller trade-created notification readAt')

const confirmPayload = {
  status: 'pending_meetup'
}
const buyerConfirmTradeError = await patchExpectError(`/trades/${trade.id}/status`, confirmPayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeConfirmByBuyer))
assertEqual(buyerConfirmTradeError.status, 409, 'buyer-confirm trade rejection status')
assertEqual(buyerConfirmTradeError.code, 'CONFLICT', 'buyer-confirm trade rejection code')
assert(/当前交易状态不允许/.test(buyerConfirmTradeError.message || ''), 'buyer-confirm trade rejection message')

const confirmed = await patch(`/trades/${trade.id}/status`, confirmPayload, seller.token, idempotencyOptions(idempotencyKeys.tradeConfirm))
const replayedConfirmed = await patch(`/trades/${trade.id}/status`, confirmPayload, seller.token, idempotencyOptions(idempotencyKeys.tradeConfirm))

assertEqual(confirmed.status, 'pending_meetup', 'confirmed trade status')
assertEqual(replayedConfirmed.id, confirmed.id, 'replayed confirmed trade id')
assertOneTimeContactCode(confirmed, 'confirmed trade')
assertOneTimeContactCode(replayedConfirmed, 'replayed confirmed trade')
const sellerTradesAfterConfirm = await get('/trades', seller.token)
const sellerConfirmedTrade = findTrade(sellerTradesAfterConfirm, trade.id, 'pending_meetup', 'seller confirmed trade list')
assertEqual(sellerConfirmedTrade.contactCode, confirmed.contactCode, 'seller confirmed trade contact code')
assertOneTimeContactCode(sellerConfirmedTrade, 'seller confirmed trade')
const buyerTradesAfterConfirm = await get('/trades', buyer.token)
const buyerConfirmedTrade = findTrade(buyerTradesAfterConfirm, trade.id, 'pending_meetup', 'buyer confirmed trade list')
assertEqual(buyerConfirmedTrade.contactCode, confirmed.contactCode, 'buyer confirmed trade contact code')
assertOneTimeContactCode(buyerConfirmedTrade, 'buyer confirmed trade')
const buyerNotificationsAfterConfirm = await get('/notifications', buyer.token)
findNotification(buyerNotificationsAfterConfirm, 'trade_confirmed', trade.id, 'buyer trade confirmed notification')

const completePayload = {
  status: 'completed'
}
const completed = await patch(`/trades/${trade.id}/status`, completePayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeComplete))
const replayedCompleted = await patch(`/trades/${trade.id}/status`, completePayload, buyer.token, idempotencyOptions(idempotencyKeys.tradeComplete))

assertEqual(completed.status, 'completed', 'completed trade status')
assertEqual(replayedCompleted.id, completed.id, 'replayed completed trade id')
assertTradeContactHidden(completed, 'completed trade')
assertTradeContactHidden(replayedCompleted, 'replayed completed trade')
const sellerTradesAfterComplete = await get('/trades', seller.token)
const sellerCompletedTrade = findTrade(sellerTradesAfterComplete, trade.id, 'completed', 'seller completed trade list')
assertTradeContactHidden(sellerCompletedTrade, 'seller completed trade')
const buyerTradesAfterComplete = await get('/trades', buyer.token)
const buyerCompletedTrade = findTrade(buyerTradesAfterComplete, trade.id, 'completed', 'buyer completed trade list')
assertTradeContactHidden(buyerCompletedTrade, 'buyer completed trade')
const sellerNotificationsAfterComplete = await get('/notifications', seller.token)
findNotification(sellerNotificationsAfterComplete, 'trade_completed', trade.id, 'seller trade completed notification')
const soldItem = await get(`/items/${encodeURIComponent(item.id)}`)
assertEqual(soldItem.status, 'sold', 'completed trade item status')
assertPublicItemPrivacy(soldItem, 'sold item detail')
assertNoReviewIdentityFields(soldItem, 'sold item detail')
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
const sellerNotificationsAfterReview = await get('/notifications', seller.token)
findNotification(sellerNotificationsAfterReview, 'trade_reviewed', trade.id, 'seller trade reviewed notification')

const soldList = await get(`/items?latitude=${encodeURIComponent(latitude.value)}&longitude=${encodeURIComponent(longitude.value)}&accuracy=${encodeURIComponent(accuracy.value)}&capturedAt=${encodeURIComponent(smokeCapturedAt.value)}`)
assert(!toArray(soldList.items).some((candidate) => candidate.id === item.id), 'sold item still appears in public list')

if (shouldRunAccountDeleteSmoke) {
  await runAccountDeletionSmoke()
}

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

  if (
    accountDeleteCode &&
    accountDeleteProvider === sellerProvider &&
    accountDeleteCode === sellerCode
  ) {
    missing.push('GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE must use a disposable account different from GOODS_COMM_SMOKE_SELLER_CODE')
  }

  if (
    accountDeleteCode &&
    accountDeleteProvider === buyerProvider &&
    accountDeleteCode === buyerCode
  ) {
    missing.push('GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE must use a disposable account different from GOODS_COMM_SMOKE_BUYER_CODE')
  }

  if (accountDeleteReloginCode && !accountDeleteCode) {
    missing.push('GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE requires GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE')
  }

  if (
    accountDeleteReloginCode &&
    accountDeleteProvider === sellerProvider &&
    accountDeleteReloginCode === sellerCode
  ) {
    missing.push('GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE must use the disposable delete account, not GOODS_COMM_SMOKE_SELLER_CODE')
  }

  if (
    accountDeleteReloginCode &&
    accountDeleteProvider === buyerProvider &&
    accountDeleteReloginCode === buyerCode
  ) {
    missing.push('GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE must use the disposable delete account, not GOODS_COMM_SMOKE_BUYER_CODE')
  }

  if (missing.length) {
    throw new Error(`Deployed main-flow smoke preconditions are missing:\n- ${missing.join('\n- ')}`)
  }
}

async function runAccountDeletionSmoke() {
  const account = await post('/auth/login', {
    provider: accountDeleteProvider,
    code: accountDeleteCode,
    agreement: createAgreement('deployed-main-flow:account-delete'),
    userInfo: {
      nickname: `部署烟测注销账号-${environment}`,
      avatarUrl: ''
    }
  })
  assert(Boolean(account.token), 'account deletion login did not return token')

  const uploadedDeleteImage = await uploadSmokeImage(account.token)
  const deleteItemImage = selectPublishImage(uploadedDeleteImage)
  const deleteItemPayload = {
    title: `部署注销烟测-${smokeRunId}`,
    price: 1,
    category: 'home',
    condition: 'good',
    description: `部署后账号注销烟测 ${environment}`,
    images: [deleteItemImage],
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
  const deleteItem = await post('/items', deleteItemPayload, account.token, idempotencyOptions(idempotencyKeys.accountDeleteItem))
  assertEqual(deleteItem.status, 'online', 'account deletion smoke item status')
  assertPublicItemPrivacy(deleteItem, 'account deletion smoke item response')
  assertNoReviewIdentityFields(deleteItem, 'account deletion smoke item response')

  const deletion = await post('/auth/delete-account', {
    reason: 'deployed_main_flow_smoke'
  }, account.token)
  assertEqual(deletion.ok, true, 'account deletion result')
  assert(Boolean(deletion.deletedAt), 'account deletion deletedAt')

  const revokedDeletedToken = await getExpectError('/items/mine', account.token)
  assertEqual(revokedDeletedToken.status, 401, 'account deletion revoked token status')
  assertEqual(revokedDeletedToken.code, 'UNAUTHENTICATED', 'account deletion revoked token code')

  const hiddenDeletedItem = await getExpectError(`/items/${encodeURIComponent(deleteItem.id)}`)
  assertEqual(hiddenDeletedItem.status, 404, 'account deletion hidden item status')
  assertEqual(hiddenDeletedItem.code, 'NOT_FOUND', 'account deletion hidden item code')

  if (accountDeleteReloginCode) {
    const reloginDeletedAccount = await postExpectError('/auth/login', {
      provider: accountDeleteProvider,
      code: accountDeleteReloginCode,
      agreement: createAgreement('deployed-main-flow:account-delete-relogin'),
      userInfo: {
        nickname: `部署烟测注销重登-${environment}`,
        avatarUrl: ''
      }
    })
    assertEqual(reloginDeletedAccount.status, 403, 'account deletion relogin status')
    assertEqual(reloginDeletedAccount.code, 'FORBIDDEN', 'account deletion relogin code')
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

function assertPublicItemPrivacy(item = {}, label) {
  assert(item && typeof item === 'object', `${label} missing item`)
  assert(item.seller && typeof item.seller === 'object', `${label} missing seller`)
  assert(item.location && typeof item.location === 'object', `${label} missing location`)
  assert(item.location.communityId || item.location.streetId, `${label} missing public region`)

  for (const key of ['contactCode', 'contact', 'phone', 'mobile', 'wechat', 'openId', 'openid', 'unionId', 'unionid']) {
    assertNoOwnKey(item.seller, key, `${label} seller`)
  }

  for (const key of ['latitude', 'longitude', 'accuracy', 'capturedAt', 'poiName', 'address']) {
    assertNoOwnKey(item.location, key, `${label} location`)
  }
}

function assertNoReviewIdentityFields(item = {}, label) {
  for (const key of ['sellerOpenid', 'platformId', 'contentSafetyOpenid', 'contentSafetyProvider', 'contentSafetyUserId', 'contentSafetyReviewer', 'moderation']) {
    assertNoOwnKey(item, key, label)
  }
}

function assertTradeContactHidden(trade = {}, label) {
  assertEqual(trade.contactCode || '', '', `${label} contact code`)
  assertEqual(trade.contactCodeExpiresAt || null, null, `${label} contact code expiry`)
}

function assertOneTimeContactCode(trade = {}, label) {
  assert(/^GC-[A-F0-9]{6}-[A-Z0-9]{4}$/.test(String(trade.contactCode || '')), `${label} contact code format`)

  if (seller.user?.contactCode) {
    assert(trade.contactCode !== seller.user.contactCode, `${label} must not reuse seller fixed contact code`)
  }

  if (buyer.user?.contactCode) {
    assert(trade.contactCode !== buyer.user.contactCode, `${label} must not reuse buyer fixed contact code`)
  }

  assert(Number(trade.contactCodeExpiresAt) > Date.now(), `${label} contact code expiry`)
}

function assertNoOwnKey(object = {}, key, label) {
  if (Object.prototype.hasOwnProperty.call(object, key)) {
    throw new Error(`${label} leaked ${key}`)
  }
}

async function uploadSmokeImage(token) {
  return request('/uploads/items', {
    method: 'POST',
    token,
    body: createSmokeImageForm()
  })
}

async function uploadSmokeImageExpectError(token = '') {
  return requestExpectError('/uploads/items', {
    method: 'POST',
    token,
    body: createSmokeImageForm()
  })
}

function createSmokeImageForm() {
  const form = new FormData()
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])

  form.append('usage', 'item_image')
  form.append('file', new Blob([bytes], {
    type: 'image/png'
  }), 'deployed-smoke-item.png')

  return form
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

async function patchExpectError(path, data, token = '', options = {}) {
  return requestExpectError(path, {
    method: 'PATCH',
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

function normalizeOptionalSmokeInput(value = '') {
  const normalized = String(value || '').trim()

  return containsPlaceholder(normalized) ? '' : normalized
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

function findTrade(payload, tradeId, expectedStatus, label) {
  const trade = toArray(payload.trades).find((candidate) => candidate.id === tradeId)
  assert(trade, `${label} missing trade ${tradeId}`)
  assertEqual(trade.status, expectedStatus, `${label} status`)
  return trade
}

function findNotification(payload, expectedType, targetId, label) {
  const notification = toArray(payload.notifications).find((candidate) =>
    candidate.type === expectedType &&
    candidate.targetId === targetId
  )

  assert(notification, `${label} missing ${expectedType} notification for ${targetId}`)
  assertEqual(notification.targetType, 'trade', `${label} target type`)
  assert(notification.title, `${label} title`)
  assert(notification.body, `${label} body`)

  return notification
}
