import assert from 'node:assert/strict'
import {
  getLocationErrorView,
  getLocationProfile,
  getLocationQualityText,
  getSavedLocationProfile,
  isFinalTradeLocationProfile,
  normalizeLocationError,
  verifyTradeEligibility
} from '../src/services/location.js'

const storage = new Map()
const LAST_LOCATION_KEY = 'goods.lastLocationProfile'
const STALE_CAPTURED_AT = Date.now() - 6 * 60 * 1000

globalThis.uni = {
  getStorageSync(key) {
    return storage.get(key)
  },
  setStorageSync(key, value) {
    storage.set(key, value)
  },
  removeStorageSync(key) {
    storage.delete(key)
  },
  getSystemInfoSync() {
    return {
      uniPlatform: 'mp-weixin'
    }
  }
}

const nearUser = {
  latitude: 31.2301,
  longitude: 121.4556,
  accuracy: 60,
  capturedAt: Date.now()
}
const region = {
  communityId: 'sh-jingan-shimen',
  streetId: 'sh-jingan-nanjingxi'
}
const item = {
  id: 'location_matrix_item',
  title: '定位矩阵商品',
  tradeScope: {
    type: 'community',
    label: '同社区',
    radiusMeters: 1200
  },
  location: {
    latitude: 31.22945,
    longitude: 121.45494,
    accuracy: 50,
    capturedAt: Date.now(),
    communityId: region.communityId,
    communityName: '石门二路社区',
    streetId: region.streetId,
    streetName: '南京西路街道'
  }
}

let scenarioCount = 0

assertNormalizedErrorMatrix()
await assertMiniProgramLocationProfileMatrix()
await assertBrowserLocationProfileMatrix()
await assertFinalTradeLocationMatrix()

console.log(`Location permission matrix smoke checks passed for ${scenarioCount} scenarios`)

function assertNormalizedErrorMatrix() {
  const cases = [
    ['getLocation:fail system permission denied', 'LOCATION_SYSTEM_DISABLED'],
    ['getLocation:fail location service disabled', 'LOCATION_SYSTEM_DISABLED'],
    ['getLocation:fail timeout', 'LOCATION_TIMEOUT'],
    ['getLocation:fail network error', 'LOCATION_NETWORK_FAILED'],
    ['chooseLocation:fail cancel', 'LOCATION_CANCELLED'],
    ['getLocation:fail unsupported provider', 'LOCATION_UNSUPPORTED'],
    ['服务端区域解析失败', 'LOCATION_REGION_FAILED'],
    ['authorize:fail auth deny', 'LOCATION_DENIED']
  ]

  for (const [errMsg, expectedCode] of cases) {
    assert.equal(normalizeLocationError({ errMsg }).code, expectedCode)
    scenarioCount += 1
  }
}

async function assertMiniProgramLocationProfileMatrix() {
  await assertLocationFailure({
    name: 'saved denied permission',
    runtime: {
      authStatus: false
    },
    expectedCode: 'LOCATION_DENIED',
    canOpenSetting: true
  })

  await assertLocationFailure({
    name: 'first authorize denied',
    runtime: {
      authorizeFail: true
    },
    expectedCode: 'LOCATION_DENIED',
    canOpenSetting: true
  })

  await assertLocationFailure({
    name: 'system location disabled',
    runtime: {
      authStatus: true,
      locationError: {
        errMsg: 'getLocation:fail system permission denied'
      }
    },
    expectedCode: 'LOCATION_SYSTEM_DISABLED'
  })

  await assertLocationFailure({
    name: 'location timeout',
    runtime: {
      authStatus: true,
      locationError: {
        errMsg: 'getLocation:fail timeout'
      }
    },
    expectedCode: 'LOCATION_TIMEOUT'
  })

  await assertLocationFailure({
    name: 'network failed',
    runtime: {
      authStatus: true,
      locationError: {
        errMsg: 'getLocation:fail network error'
      }
    },
    expectedCode: 'LOCATION_NETWORK_FAILED'
  })

  await assertLocationFailure({
    name: 'invalid coordinate',
    runtime: {
      authStatus: true,
      locationResult: {
        latitude: Number.NaN,
        longitude: nearUser.longitude,
        accuracy: 60
      }
    },
    expectedCode: 'LOCATION_INVALID'
  })

  await assertLocationFailure({
    name: 'low accuracy',
    runtime: {
      authStatus: true,
      locationResult: {
        ...nearUser,
        accuracy: 260
      }
    },
    expectedCode: 'LOCATION_LOW_ACCURACY'
  })

  await assertLocationFailure({
    name: 'region failed',
    runtime: {
      authStatus: true,
      locationResult: {
        latitude: 0,
        longitude: 0,
        accuracy: 35
      }
    },
    expectedCode: 'LOCATION_REGION_FAILED'
  })

  storage.clear()
  installMiniProgramLocationRuntime({
    authStatus: true,
    locationResult: nearUser
  })
  const profile = await getLocationProfile()
  assert.equal(profile.error, null)
  assert.equal(profile.source, 'gps')
  assert.equal(profile.region.communityId, region.communityId)
  assert.match(getLocationQualityText(profile, profile.updatedAt), /GPS 实时定位/)
  assert.equal(isFinalTradeLocationProfile(profile), true)
  scenarioCount += 1

  const saved = storage.get(LAST_LOCATION_KEY)
  storage.set(LAST_LOCATION_KEY, {
    ...saved,
    location: {
      ...saved.location,
      capturedAt: STALE_CAPTURED_AT
    }
  })
  assert.equal(getSavedLocationProfile(), null)
  assert.equal(getSavedLocationProfile({ allowExpired: true })?.source, 'gps')
  scenarioCount += 1
}

async function assertBrowserLocationProfileMatrix() {
  await assertBrowserLocationFailure(1, 'LOCATION_DENIED')
  await assertBrowserLocationFailure(3, 'LOCATION_TIMEOUT')

  const restore = installBrowserLocationRuntime({
    success: {
      latitude: nearUser.latitude,
      longitude: nearUser.longitude,
      accuracy: 35
    }
  })

  try {
    storage.clear()
    const profile = await getLocationProfile()
    assert.equal(profile.error, null)
    assert.equal(profile.source, 'gps')
    assert.equal(profile.region.communityId, region.communityId)
    assert.equal(profile.location.accuracy, 35)
    scenarioCount += 1
  } finally {
    restore()
  }
}

function assertFinalTradeLocationMatrix() {
  const chosenProfile = {
    source: 'chosen',
    location: {
      ...nearUser,
      capturedAt: Date.now()
    },
    region
  }

  assert.equal(isFinalTradeLocationProfile(chosenProfile), false)

  return verifyTradeEligibility(item, {
    final: true,
    profile: chosenProfile
  }).then((result) => {
    assert.equal(result.eligible, false)
    assert.equal(result.code, 'LOCATION_NOT_TRUSTED')
    assert.match(result.message, /实时 GPS 定位/)
    scenarioCount += 1
  })
}

async function assertLocationFailure({ name, runtime, expectedCode, canOpenSetting = false }) {
  storage.clear()
  installMiniProgramLocationRuntime(runtime)
  const profile = await getLocationProfile()
  assert.equal(profile.error.code, expectedCode, name)
  assert.equal(getLocationErrorView(profile.error).canOpenSetting, canOpenSetting, name)
  assert.equal(storage.has(LAST_LOCATION_KEY), false, name)
  scenarioCount += 1
}

async function assertBrowserLocationFailure(code, expectedCode) {
  const restore = installBrowserLocationRuntime({
    error: {
      code,
      message: `browser error ${code}`
    }
  })

  try {
    storage.clear()
    const profile = await getLocationProfile()
    assert.equal(profile.error.code, expectedCode)
    assert.equal(storage.has(LAST_LOCATION_KEY), false)
    scenarioCount += 1
  } finally {
    restore()
  }
}

function installMiniProgramLocationRuntime(options = {}) {
  globalThis.uni.getSystemInfoSync = () => ({
    uniPlatform: 'mp-weixin'
  })
  globalThis.uni.getSetting = ({ success }) => {
    success({
      authSetting: {
        'scope.userLocation': options.authStatus
      }
    })
  }
  globalThis.uni.authorize = ({ success, fail }) => {
    if (options.authorizeFail) {
      fail?.({
        errMsg: 'authorize:fail auth deny'
      })
      return
    }

    success?.()
  }
  globalThis.uni.getLocation = ({ success, fail }) => {
    if (options.locationError) {
      fail?.(options.locationError)
      return
    }

    success?.({
      latitude: options.locationResult?.latitude,
      longitude: options.locationResult?.longitude,
      accuracy: options.locationResult?.accuracy,
      name: options.locationResult?.name || '',
      address: options.locationResult?.address || ''
    })
  }
}

function installBrowserLocationRuntime(options = {}) {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalUni = {
    getSystemInfoSync: globalThis.uni.getSystemInfoSync,
    getSetting: globalThis.uni.getSetting,
    authorize: globalThis.uni.authorize,
    getLocation: globalThis.uni.getLocation
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {}
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition(success, fail) {
          if (options.error) {
            fail?.(options.error)
            return
          }

          success({
            coords: options.success
          })
        }
      }
    }
  })

  globalThis.uni.getSystemInfoSync = () => ({
    uniPlatform: 'web'
  })
  globalThis.uni.getSetting = undefined
  globalThis.uni.authorize = undefined
  globalThis.uni.getLocation = undefined

  return () => {
    restoreGlobalProperty('window', windowDescriptor)
    restoreGlobalProperty('navigator', navigatorDescriptor)
    Object.assign(globalThis.uni, originalUni)
  }
}

function restoreGlobalProperty(key, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor)
    return
  }

  delete globalThis[key]
}
