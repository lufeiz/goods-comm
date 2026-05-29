import {
  APP_ENV,
  LOCATION_CACHE_TTL_MS,
  LOCATION_TYPE,
  MAX_LOCATION_ACCURACY_METERS
} from '../config/app.js'
import { describeLocationFromSamples, resolveRegionFromSamples } from '../data/regions.js'
import { verifyTradeEligibility as verifyEligibility } from '../domain/eligibility.js'
import { hasRemoteApi, requestApi } from './api.js'
import { isBrowserRuntime } from './platform.js'
import { trackClientEvent } from './telemetry.js'

const LAST_LOCATION_KEY = 'goods.lastLocationProfile'
const LOCATION_CACHE_VERSION = 5
const LOCATION_ERROR_TITLES = {
  LOCATION_DENIED: '定位权限未开启',
  LOCATION_SYSTEM_DISABLED: '系统定位不可用',
  LOCATION_TIMEOUT: '定位超时',
  LOCATION_NETWORK_FAILED: '定位网络异常',
  LOCATION_LOW_ACCURACY: '定位精度不足',
  LOCATION_EXPIRED: '定位已过期',
  LOCATION_INVALID: '定位数据无效',
  LOCATION_REGION_FAILED: '区域解析失败',
  LOCATION_UNSUPPORTED: '平台不支持定位',
  LOCATION_CANCELLED: '未选择位置',
  LOCATION_FAILED: '当前位置未确认'
}

export function getSavedLocationProfile(options = {}) {
  const profile = uni.getStorageSync(LAST_LOCATION_KEY) || null

  if (profile?.cacheVersion !== LOCATION_CACHE_VERSION) {
    return null
  }

  return isLocationProfileUsable(profile, options) ? profile : null
}

export function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (typeof uni === 'undefined' || !uni.getLocation) {
      getBrowserCurrentLocation().then(resolve).catch(reject)
      return
    }

    uni.getLocation({
      type: LOCATION_TYPE,
      isHighAccuracy: true,
      geocode: true,
      success: (res) => {
        resolve({
          latitude: Number(res.latitude),
          longitude: Number(res.longitude),
          name: parseLocationName(res),
          address: parseLocationAddress(res),
          accuracy: res.accuracy,
          capturedAt: Date.now()
        })
      },
      fail: reject
    })
  })
}

export async function getLocationProfile() {
  try {
    await ensureLocationPermission()
    const location = await getCurrentLocation()
    assertLocationQuality(location)
    const region = await resolveCurrentRegion(location)
    const description = describeLocation(location, region)

    const profile = {
      cacheVersion: LOCATION_CACHE_VERSION,
      location,
      region,
      displayName: description.displayName,
      displayAddress: description.displayAddress,
      source: 'gps',
      error: null,
      updatedAt: Date.now()
    }

    uni.setStorageSync(LAST_LOCATION_KEY, profile)

    return profile
  } catch (error) {
    uni.removeStorageSync(LAST_LOCATION_KEY)
    const normalizedError = normalizeLocationError(error)
    trackClientEvent('location_profile_failed', {
      level: 'warn',
      code: normalizedError.code,
      message: normalizedError.message,
      context: {
        source: 'gps'
      }
    })

    return {
      location: null,
      region: null,
      error: normalizedError,
      updatedAt: Date.now()
    }
  }
}

export async function chooseLocationProfile() {
  const chosen = await chooseLocation()
  const location = {
    latitude: Number(chosen.latitude),
    longitude: Number(chosen.longitude),
    name: chosen.name || '',
    address: chosen.address || '',
    capturedAt: Date.now()
  }
  assertLocationQuality(location, { allowMissingAccuracy: true })
  const region = await resolveCurrentRegion(location)
  const description = describeLocation(location, region)
  const profile = {
    cacheVersion: LOCATION_CACHE_VERSION,
    location,
    region,
    displayName: description.displayName,
    displayAddress: description.displayAddress,
    source: 'chosen',
    requiresGpsVerification: true,
    error: null,
    updatedAt: Date.now()
  }

  uni.setStorageSync(LAST_LOCATION_KEY, profile)

  return profile
}

export function getLocationErrorView(error = {}) {
  const normalized = normalizeLocationError(error)

  return {
    code: normalized.code,
    title: LOCATION_ERROR_TITLES[normalized.code] || LOCATION_ERROR_TITLES.LOCATION_FAILED,
    description: normalized.message,
    canOpenSetting: normalized.code === 'LOCATION_DENIED',
    actionText: normalized.code === 'LOCATION_DENIED' ? '去设置' : ''
  }
}

export function getLocationQualityText(profile = {}, now = Date.now()) {
  const location = profile?.location

  if (!location || profile?.error) {
    return ''
  }

  const source = profile?.source === 'chosen'
    ? '手动选择，仅用于展示和预估'
    : 'GPS 实时定位，可用于交易校验'
  const accuracy = Number.isFinite(Number(location.accuracy))
    ? `精度约 ${Math.round(Number(location.accuracy))}m`
    : '无精度信息'
  const updatedAt = Number(location.capturedAt || profile?.updatedAt)
  const freshness = Number.isFinite(updatedAt)
    ? `更新于 ${formatLocationFreshness(updatedAt, now)}`
    : ''

  return [source, accuracy, freshness].filter(Boolean).join(' · ')
}

export function formatLocationFreshness(timestamp, now = Date.now()) {
  const deltaMs = Math.max(0, now - Number(timestamp))
  const minuteMs = 60 * 1000

  if (!Number.isFinite(deltaMs)) {
    return ''
  }

  if (deltaMs < minuteMs) {
    return '刚刚'
  }

  const minutes = Math.floor(deltaMs / minuteMs)

  if (minutes < 60) {
    return `${minutes}分钟前`
  }

  const date = new Date(timestamp)
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')

  return `${hour}:${minute}`
}

function describeLocation(location, region) {
  if (location?.name || location?.address) {
    return {
      displayName: location.name || region?.communityName || region?.streetName || '已选择位置',
      displayAddress: location.address || describeLocationFromSamples(location).displayAddress
    }
  }

  if (region?.communityName) {
    const fallback = describeLocationFromSamples(location)
    return {
      displayName: region.communityName,
      displayAddress: fallback.displayAddress
    }
  }

  if (region?.streetName) {
    const fallback = describeLocationFromSamples(location)
    return {
      displayName: region.streetName,
      displayAddress: fallback.displayAddress
    }
  }

  return describeLocationFromSamples(location)
}

function parseLocationName(res) {
  return res.name || res.poiName || res.address?.name || ''
}

function parseLocationAddress(res) {
  if (typeof res.address === 'string') {
    return res.address
  }

  if (res.address) {
    return [
      res.address.province,
      res.address.city,
      res.address.district,
      res.address.street,
      res.address.streetNum
    ].filter(Boolean).join('')
  }

  return res.fullAddress || res.addr || ''
}

export async function resolveCurrentRegion(location) {
  if (hasRemoteApi()) {
    try {
      const region = await requestRegionFromServer(location)

      if (region) {
        return region
      }
    } catch (error) {
      if (isRemoteRegionRequired()) {
        throw createLocationError('LOCATION_REGION_FAILED', `服务端区域解析失败：${error.message || '未知错误'}`)
      }

      console.warn('resolve region fallback to local samples', error)
    }
  }

  if (isRemoteRegionRequired()) {
    throw createLocationError('LOCATION_REGION_FAILED', '当前环境必须配置服务端区域解析')
  }

  const region = resolveRegionFromSamples(location)

  if (!region) {
    throw createLocationError('LOCATION_REGION_FAILED', '未能解析当前位置所属社区或街道')
  }

  return region
}

function isRemoteRegionRequired() {
  return APP_ENV === 'pre' || APP_ENV === 'prod'
}

export async function verifyTradeEligibility(item, options = {}) {
  const profile = options.profile || (
    options.refresh
      ? await getLocationProfile()
      : getSavedLocationProfile() || await getLocationProfile()
  )

  if (options.final && !isFinalTradeLocationProfile(profile)) {
    return {
      eligible: false,
      code: profile?.error?.code || 'LOCATION_NOT_TRUSTED',
      message: profile?.error?.message || '发起交易需要使用实时 GPS 定位，请刷新当前位置后再试',
      profile
    }
  }

  const activeLocation = profile.location || null
  const activeRegion = profile.region || null

  return {
    ...verifyEligibility({
      item,
      userLocation: activeLocation,
      userRegion: activeRegion
    }),
    profile
  }
}

export function isFinalTradeLocationProfile(profile) {
  if (!isLocationProfileUsable(profile, { requireAccuracy: true })) {
    return false
  }

  return profile.source === 'gps' && Boolean(profile.region)
}

export function isLocationProfileUsable(profile, options = {}) {
  if (!profile?.location || profile.error) {
    return false
  }

  if (!options.allowExpired && isLocationExpired(profile.location)) {
    return false
  }

  return isLocationAccuracyUsable(profile.location, options)
}

export function isLocationExpired(location, now = Date.now()) {
  const capturedAt = Number(location?.capturedAt)

  if (!Number.isFinite(capturedAt)) {
    return true
  }

  return now - capturedAt > LOCATION_CACHE_TTL_MS
}

export function isLocationAccuracyUsable(location, options = {}) {
  const accuracy = Number(location?.accuracy)

  if (!Number.isFinite(accuracy)) {
    return Boolean(options.allowMissingAccuracy) && !options.requireAccuracy
  }

  return accuracy <= MAX_LOCATION_ACCURACY_METERS
}

function assertLocationQuality(location, options = {}) {
  if (!Number.isFinite(Number(location?.latitude)) || !Number.isFinite(Number(location?.longitude))) {
    throw createLocationError('LOCATION_INVALID', '未获取到有效经纬度，请重新定位')
  }

  if (isLocationExpired(location)) {
    throw createLocationError('LOCATION_EXPIRED', '当前位置已过期，请重新刷新定位')
  }

  if (!isLocationAccuracyUsable(location, options)) {
    throw createLocationError(
      'LOCATION_LOW_ACCURACY',
      Number.isFinite(Number(location?.accuracy))
        ? `定位精度约 ${Math.round(Number(location?.accuracy))}m，请到开阔位置或开启精准定位后重试`
        : '未获取到定位精度，请使用实时 GPS 定位后再试'
    )
  }
}

function ensureLocationPermission() {
  return new Promise((resolve, reject) => {
    if (typeof uni === 'undefined') {
      if (hasBrowserGeolocation()) {
        resolve()
        return
      }

      reject(createLocationError('LOCATION_UNSUPPORTED', '当前平台不支持定位'))
      return
    }

    if (!uni.getSetting || !uni.authorize) {
      resolve()
      return
    }

    uni.getSetting({
      success: (setting) => {
        const status = setting.authSetting?.['scope.userLocation']

        if (status === true) {
          resolve()
          return
        }

        if (status === false) {
          reject(createLocationError('LOCATION_DENIED', '定位权限未开启，请在设置中允许位置权限'))
          return
        }

        uni.authorize({
          scope: 'scope.userLocation',
          success: resolve,
          fail: () => reject(createLocationError('LOCATION_DENIED', '需要授权当前位置后才能进行 LBS 交易校验'))
        })
      },
      fail: resolve
    })
  })
}

function getBrowserCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!hasBrowserGeolocation()) {
      reject(createLocationError('LOCATION_UNSUPPORTED', '当前浏览器不支持定位'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: Number(position.coords.latitude),
          longitude: Number(position.coords.longitude),
          name: '',
          address: '',
          accuracy: position.coords.accuracy,
          capturedAt: Date.now()
        })
      },
      (error) => {
        reject(normalizeBrowserLocationError(error))
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    )
  })
}

function hasBrowserGeolocation() {
  return isBrowserRuntime() &&
    Boolean(navigator.geolocation?.getCurrentPosition)
}

function normalizeBrowserLocationError(error = {}) {
  if (error.code === 1) {
    return createLocationError('LOCATION_DENIED', '浏览器定位权限未开启，请允许网站使用当前位置')
  }

  if (error.code === 3) {
    return createLocationError('LOCATION_TIMEOUT', '浏览器定位超时，请检查网络或稍后重试')
  }

  return createLocationError('LOCATION_FAILED', error.message || '浏览器定位失败')
}

function chooseLocation() {
  return new Promise((resolve, reject) => {
    if (!uni.chooseLocation) {
      reject(createLocationError('LOCATION_UNSUPPORTED', '当前平台不支持选择位置'))
      return
    }

    uni.chooseLocation({
      success: resolve,
      fail: reject
    })
  })
}

function requestRegionFromServer(location) {
  return requestApi('/lbs/resolve-region', {
    method: 'POST',
    data: {
      latitude: location.latitude,
      longitude: location.longitude,
      coordType: LOCATION_TYPE
    }
  })
}

export function normalizeLocationError(error) {
  const message = error?.message || error?.errMsg || '定位失败'
  const normalizedMessage = String(message).toLowerCase()

  if ([
    'LOCATION_DENIED',
    'LOCATION_SYSTEM_DISABLED',
    'LOCATION_TIMEOUT',
    'LOCATION_NETWORK_FAILED',
    'LOCATION_LOW_ACCURACY',
    'LOCATION_EXPIRED',
    'LOCATION_INVALID',
    'LOCATION_REGION_FAILED',
    'LOCATION_UNSUPPORTED',
    'LOCATION_CANCELLED'
  ].includes(error?.code)) {
    return {
      code: error.code,
      message
    }
  }

  if (
    normalizedMessage.includes('system permission') ||
    normalizedMessage.includes('location service') ||
    normalizedMessage.includes('location disabled') ||
    (normalizedMessage.includes('gps') && normalizedMessage.includes('off')) ||
    message.includes('系统定位') ||
    message.includes('定位服务') ||
    message.includes('未开启定位')
  ) {
    return {
      code: 'LOCATION_SYSTEM_DISABLED',
      message: '系统定位服务未开启，请开启系统定位后重试'
    }
  }

  if (message.includes('cancel') || message.includes('取消')) {
    return {
      code: 'LOCATION_CANCELLED',
      message: '未选择位置'
    }
  }

  if (normalizedMessage.includes('timeout') || message.includes('超时')) {
    return {
      code: 'LOCATION_TIMEOUT',
      message: '定位超时，请检查网络或到开阔位置后重试'
    }
  }

  if (normalizedMessage.includes('network') || normalizedMessage.includes('request') || message.includes('网络')) {
    return {
      code: 'LOCATION_NETWORK_FAILED',
      message: '定位网络异常，请稍后重试'
    }
  }

  if (normalizedMessage.includes('unsupported') || normalizedMessage.includes('not support') || message.includes('不支持')) {
    return {
      code: 'LOCATION_UNSUPPORTED',
      message
    }
  }

  if (message.includes('区域解析') || message.includes('社区') || message.includes('街道')) {
    return {
      code: 'LOCATION_REGION_FAILED',
      message
    }
  }

  if (error?.code === 'LOCATION_DENIED' || normalizedMessage.includes('auth') || normalizedMessage.includes('permission') || normalizedMessage.includes('authorize') || normalizedMessage.includes('deny')) {
    return {
      code: 'LOCATION_DENIED',
      message: '定位权限未开启，请在设置中允许位置权限'
    }
  }

  return {
    code: 'LOCATION_FAILED',
    message
  }
}

function createLocationError(code, message) {
  return {
    code,
    message
  }
}
