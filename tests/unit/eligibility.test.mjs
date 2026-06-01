import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { verifyTradeEligibility } from '../../src/domain/eligibility.js'

const baseItem = {
  id: 'item_unit',
  title: 'Unit item',
  tradeScope: {
    type: 'community',
    label: 'same community',
    radiusMeters: 1200
  },
  location: {
    latitude: 31.22945,
    longitude: 121.45494,
    communityId: 'community-a',
    streetId: 'street-a'
  }
}

const nearLocation = {
  latitude: 31.2301,
  longitude: 121.4556
}

describe('trade eligibility domain rules', () => {
  it('allows a buyer inside the configured community radius', () => {
    const result = verifyTradeEligibility({
      item: baseItem,
      userLocation: nearLocation,
      userRegion: {
        communityId: 'community-a',
        streetId: 'street-a'
      }
    })

    assert.equal(result.eligible, true)
    assert.equal(result.code, 'ELIGIBLE')
    assert.ok(result.distanceMeters > 0)
  })

  it('rejects missing item, missing location, and invalid coordinates with stable codes', () => {
    assert.equal(verifyTradeEligibility({ item: null, userLocation: nearLocation }).code, 'ITEM_NOT_FOUND')
    assert.equal(verifyTradeEligibility({ item: baseItem, userLocation: null }).code, 'LOCATION_REQUIRED')
    assert.equal(verifyTradeEligibility({
      item: { ...baseItem, location: null },
      userLocation: nearLocation
    }).code, 'ITEM_LOCATION_MISSING')
    assert.equal(verifyTradeEligibility({
      item: baseItem,
      userLocation: { latitude: Number.NaN, longitude: 121.45 },
      userRegion: { communityId: 'community-a' }
    }).code, 'LOCATION_INVALID')
  })

  it('prioritizes range failure before region mismatch', () => {
    const result = verifyTradeEligibility({
      item: {
        ...baseItem,
        tradeScope: {
          ...baseItem.tradeScope,
          radiusMeters: 10
        }
      },
      userLocation: nearLocation,
      userRegion: {
        communityId: 'community-b',
        streetId: 'street-b'
      }
    })

    assert.equal(result.eligible, false)
    assert.equal(result.code, 'OUT_OF_RANGE')
  })

  it('distinguishes unknown region from region mismatch', () => {
    assert.equal(verifyTradeEligibility({
      item: baseItem,
      userLocation: nearLocation,
      userRegion: null
    }).code, 'REGION_UNKNOWN')

    assert.equal(verifyTradeEligibility({
      item: baseItem,
      userLocation: nearLocation,
      userRegion: {
        communityId: 'community-b',
        streetId: 'street-a'
      }
    }).code, 'REGION_MISMATCH')
  })

  it('uses street matching when the item trade scope is street', () => {
    const streetItem = {
      ...baseItem,
      tradeScope: {
        type: 'street',
        label: 'same street',
        radiusMeters: 4000
      }
    }

    assert.equal(verifyTradeEligibility({
      item: streetItem,
      userLocation: nearLocation,
      userRegion: {
        communityId: 'community-b',
        streetId: 'street-a'
      }
    }).code, 'ELIGIBLE')

    assert.equal(verifyTradeEligibility({
      item: streetItem,
      userLocation: nearLocation,
      userRegion: {
        communityId: 'community-a',
        streetId: 'street-b'
      }
    }).code, 'REGION_MISMATCH')
  })
})
