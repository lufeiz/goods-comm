import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  getLocationErrorView,
  getLocationQualityText,
  getSavedLocationProfile,
  isFinalTradeLocationProfile,
  isLocationAccuracyUsable,
  isLocationExpired,
  isLocationProfileUsable,
  normalizeLocationError
} from '../../src/services/location.js'

const storage = new Map()
const LAST_LOCATION_KEY = 'goods.lastLocationProfile'
const now = Date.now()
const freshLocation = {
  latitude: 31.2301,
  longitude: 121.4556,
  accuracy: 80,
  capturedAt: now
}
const region = {
  communityId: 'community-a',
  streetId: 'street-a'
}

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

describe('location profile guards', () => {
  beforeEach(() => {
    storage.clear()
  })

  it('guards freshness, accuracy, and final trade GPS requirements', () => {
    const gpsProfile = {
      cacheVersion: 5,
      location: freshLocation,
      region,
      source: 'gps',
      error: null,
      updatedAt: now
    }
    const chosenProfile = {
      ...gpsProfile,
      source: 'chosen',
      requiresGpsVerification: true
    }

    assert.equal(isLocationExpired({ ...freshLocation, capturedAt: now - 6 * 60 * 1000 }, now), true)
    assert.equal(isLocationAccuracyUsable({ accuracy: 201 }), false)
    assert.equal(isLocationAccuracyUsable({ accuracy: undefined }, { allowMissingAccuracy: true }), true)
    assert.equal(isLocationAccuracyUsable({ accuracy: undefined }, { requireAccuracy: true }), false)
    assert.equal(isLocationProfileUsable(gpsProfile), true)
    assert.equal(isFinalTradeLocationProfile(gpsProfile), true)
    assert.equal(isFinalTradeLocationProfile(chosenProfile), false)
    assert.equal(isFinalTradeLocationProfile({ ...gpsProfile, region: null }), false)
  })

  it('loads only current and usable cached location profiles', () => {
    const profile = {
      cacheVersion: 5,
      location: freshLocation,
      region,
      source: 'gps',
      error: null,
      updatedAt: now
    }

    storage.set(LAST_LOCATION_KEY, profile)
    assert.equal(getSavedLocationProfile()?.source, 'gps')

    storage.set(LAST_LOCATION_KEY, {
      ...profile,
      cacheVersion: 4
    })
    assert.equal(getSavedLocationProfile(), null)

    storage.set(LAST_LOCATION_KEY, {
      ...profile,
      location: {
        ...freshLocation,
        capturedAt: now - 6 * 60 * 1000
      }
    })
    assert.equal(getSavedLocationProfile(), null)
    assert.equal(getSavedLocationProfile({ allowExpired: true })?.source, 'gps')
  })

  it('normalizes platform location errors into stable product states', () => {
    assert.equal(normalizeLocationError({ errMsg: 'getLocation:fail system permission denied' }).code, 'LOCATION_SYSTEM_DISABLED')
    assert.equal(normalizeLocationError({ errMsg: 'getLocation:fail timeout' }).code, 'LOCATION_TIMEOUT')
    assert.equal(normalizeLocationError({ errMsg: 'getLocation:fail network error' }).code, 'LOCATION_NETWORK_FAILED')
    assert.equal(normalizeLocationError({ errMsg: 'chooseLocation:fail cancel' }).code, 'LOCATION_CANCELLED')
    assert.equal(normalizeLocationError({ errMsg: 'authorize:fail auth deny' }).code, 'LOCATION_DENIED')

    const deniedView = getLocationErrorView({ code: 'LOCATION_DENIED', message: 'denied' })
    assert.equal(deniedView.canOpenSetting, true)
    assert.equal(deniedView.actionText, '去设置')
  })

  it('renders location quality with source, accuracy, and freshness', () => {
    const text = getLocationQualityText({
      location: freshLocation,
      source: 'gps',
      updatedAt: now
    }, now)

    assert.match(text, /GPS/)
    assert.match(text, /80m/)
    assert.match(text, /刚刚/)
  })
})
