import { AUTH_SESSION_TTL_MS } from '../config/app.js'
import { hasRemoteApi, requestApi } from './api.js'
import { getUserAgreementAcceptance, requireUserAgreement } from './compliance.js'
import { getRuntimePlatform, isBrowserRuntime } from './platform.js'

const AUTH_USER_KEY = 'goods.authUser'
const AUTH_CACHE_VERSION = 5

export function getStoredAuthUser() {
  const user = uni.getStorageSync(AUTH_USER_KEY) || null

  return isAuthUserUsable(user) ? user : null
}

export function requireStoredAuthUser(message = '请先登录后再继续操作') {
  const user = getStoredAuthUser()

  if (!user) {
    throw new Error(message)
  }

  return user
}

export function clearStoredAuthUser() {
  uni.removeStorageSync(AUTH_USER_KEY)
}

export async function logoutAuthSession(user) {
  if (!user?.id) {
    return {
      ok: true,
      revokedAt: Date.now()
    }
  }

  if (hasRemoteApi()) {
    return requestApi('/auth/logout', {
      method: 'POST',
      token: user.token
    })
  }

  return {
    ok: true,
    revokedAt: Date.now()
  }
}

export async function deleteAuthAccount(user, reason = 'user_requested') {
  if (!user?.id) {
    throw new Error('请先登录后再注销账号')
  }

  if (hasRemoteApi()) {
    return requestApi('/auth/delete-account', {
      method: 'POST',
      token: user.token,
      data: {
        reason
      }
    })
  }

  return {
    ok: true,
    deletedAt: Date.now()
  }
}

export function isAuthUserUsable(user, now = Date.now()) {
  return Boolean(
    user &&
    user.cacheVersion === AUTH_CACHE_VERSION &&
    user.id &&
    user.token &&
    Number(user.sessionExpiresAt) > now
  )
}

export async function loginWithPlatformProfile() {
  requireUserAgreement('登录前请先阅读并同意用户协议和隐私政策')

  // #ifdef MP-WEIXIN
  if (getRuntimePlatform() === 'weixin') {
    throw new Error('微信端请点击微信头像授权按钮登录')
  }
  // #endif

  const shouldProfileFirst = shouldRequestProfileBeforeLogin()
  const profile = shouldProfileFirst ? await requestUserProfile() : null
  const login = await requestLogin()
  const resolvedProfile = profile || await requestUserProfile()
  const userInfo = normalizeUserInfo(resolvedProfile)
  assertUsableProfile(userInfo)

  return persistAuthUser(await exchangeAuthSession(login, userInfo, resolvedProfile))
}

export async function loginWithUserInfo(userInfo, rawProfile = {}) {
  requireUserAgreement('登录前请先阅读并同意用户协议和隐私政策')

  const normalized = normalizeUserInfo({
    userInfo
  })

  assertUsableProfile(normalized)

  const login = await requestLogin()

  return persistAuthUser(await exchangeAuthSession(login, normalized, rawProfile))
}

async function exchangeAuthSession(login, userInfo, rawProfile) {
  const provider = getLoginProvider() || 'unknown'
  const payload = {
    provider,
    code: login.code || '',
    userInfo,
    rawProfile,
    agreement: getUserAgreementAcceptance()
  }

  if (hasRemoteApi()) {
    const session = await requestApi('/auth/login', {
      method: 'POST',
      data: payload
    })

    return normalizeAuthSession(session, payload)
  }

  return buildLocalAuthSession(payload)
}

function persistAuthUser(session) {
  const authUser = {
    cacheVersion: AUTH_CACHE_VERSION,
    ...session,
    updatedAt: Date.now()
  }

  uni.setStorageSync(AUTH_USER_KEY, authUser)

  return authUser
}

export function normalizeAuthSession(session, fallback = {}) {
  const now = Date.now()
  const userInfo = session?.user || session || {}
  const fallbackInfo = fallback.userInfo || {}
  const provider = session?.provider || fallback.provider || 'unknown'
  const platformId = userInfo.platformId || userInfo.openid || userInfo.userId || session?.platformId || session?.openid || session?.userId || fallback.code || ''

  return {
    id: userInfo.id || platformId || `local_${now}`,
    provider,
    platformId,
    token: session?.token || `local_token_${now}`,
    sessionExpiresAt: Number(session?.sessionExpiresAt || now + AUTH_SESSION_TTL_MS),
    nickname: userInfo.nickname || fallbackInfo.nickname || '社区用户',
    avatarUrl: userInfo.avatarUrl || fallbackInfo.avatarUrl || '',
    contactCode: userInfo.contactCode || createContactCode(provider, platformId || now),
    rawProfile: fallback.rawProfile || {}
  }
}

export function buildLocalAuthSession(payload) {
  const stableCode = payload.code || `${payload.provider}_${Date.now()}`
  const localUserId = `local_${payload.provider}_${hashText(stableCode)}`

  return normalizeAuthSession({
    user: {
      id: localUserId,
      userId: localUserId,
      nickname: payload.userInfo?.nickname,
      avatarUrl: payload.userInfo?.avatarUrl,
      contactCode: createContactCode(payload.provider, localUserId)
    },
    provider: payload.provider,
    token: `local_token_${hashText(`${stableCode}_${Date.now()}`)}`,
    sessionExpiresAt: Date.now() + AUTH_SESSION_TTL_MS
  }, payload)
}

function assertUsableProfile(userInfo) {
  // #ifdef MP-WEIXIN
  if (getRuntimePlatform() === 'weixin' && isAnonymousWeixinProfile(userInfo)) {
    throw new Error('未获得微信头像授权，请在弹框中选择头像')
  }
  // #endif
}

function isAnonymousWeixinProfile(userInfo) {
  return !userInfo.avatarUrl ||
    userInfo.avatarUrl.includes('default-avatar')
}

function requestLogin() {
  return new Promise((resolve, reject) => {
    if (getRuntimePlatform() === 'h5') {
      const browserLogin = createBrowserLogin()

      if (browserLogin) {
        resolve(browserLogin)
        return
      }
    }

    if (typeof uni === 'undefined' || !uni.login) {
      const browserLogin = createBrowserLogin()

      if (browserLogin) {
        resolve(browserLogin)
        return
      }

      reject(new Error('当前平台不支持登录'))
      return
    }

    const options = {
      success: resolve,
      fail: reject
    }
    const provider = getLoginProvider()

    if (provider) {
      options.provider = provider
    }

    uni.login(options)
  })
}

function requestUserProfile() {
  return new Promise((resolve, reject) => {
    if (getRuntimePlatform() === 'h5') {
      const browserProfile = createBrowserProfile()

      if (browserProfile) {
        resolve(browserProfile)
        return
      }
    }

    if (typeof uni !== 'undefined' && uni.getUserProfile) {
      uni.getUserProfile({
        desc: '用于展示社区交易昵称与头像',
        success: resolve,
        fail: reject
      })
      return
    }

    if (typeof uni !== 'undefined' && uni.getUserInfo) {
      uni.getUserInfo({
        success: resolve,
        fail: reject
      })
      return
    }

    const browserProfile = createBrowserProfile()

    if (browserProfile) {
      resolve(browserProfile)
      return
    }

    reject(new Error('当前平台不支持获取用户信息'))
  })
}

function normalizeUserInfo(profile) {
  const parsed = parseProfileResponse(profile)
  const userInfo = profile?.userInfo || parsed?.response || parsed?.userInfo || parsed || {}

  return {
    nickname: userInfo.nickName || userInfo.nickname || userInfo.nick_name || userInfo.name || '社区用户',
    avatarUrl: userInfo.avatarUrl || userInfo.avatar || userInfo.avatar_url || ''
  }
}

function parseProfileResponse(profile) {
  if (!profile?.response || typeof profile.response !== 'string') {
    return null
  }

  try {
    return JSON.parse(profile.response)
  } catch (error) {
    return null
  }
}

function getLoginProvider() {
  const runtimePlatform = getRuntimePlatform()

  if (['weixin', 'alipay', 'h5'].includes(runtimePlatform)) {
    return runtimePlatform
  }

  // #ifdef MP-WEIXIN
  return 'weixin'
  // #endif

  // #ifdef MP-ALIPAY
  return 'alipay'
  // #endif

  // #ifdef H5
  return 'h5'
  // #endif

  return ''
}

function shouldRequestProfileBeforeLogin() {
  // #ifdef MP-WEIXIN
  return false
  // #endif

  return false
}

function createContactCode(provider, seed) {
  return `${provider || 'user'}-${hashText(String(seed)).slice(0, 8)}`
}

function createBrowserLogin() {
  if (!isBrowserRuntime()) {
    return null
  }

  return {
    provider: 'h5',
    code: getBrowserStableId()
  }
}

function createBrowserProfile() {
  if (!isBrowserRuntime()) {
    return null
  }

  const nickname = getBrowserStoredValue('goods.h5.nickname') || 'H5 用户'
  const avatarUrl = getBrowserStoredValue('goods.h5.avatarUrl') || ''

  return {
    userInfo: {
      nickname,
      avatarUrl
    }
  }
}

function getBrowserStableId() {
  const key = 'goods.h5.clientId'
  const existing = getBrowserStoredValue(key)

  if (existing) {
    return existing
  }

  const created = `h5_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  setBrowserStoredValue(key, created)

  return created
}

function getBrowserStoredValue(key) {
  try {
    return window.localStorage?.getItem(key) || ''
  } catch (error) {
    return ''
  }
}

function setBrowserStoredValue(key, value) {
  try {
    window.localStorage?.setItem(key, value)
  } catch (error) {
    // Ignore unavailable browser storage. The session can still be created for this runtime.
  }
}

function hashText(text) {
  let hash = 2166136261

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return Math.abs(hash >>> 0).toString(36)
}
