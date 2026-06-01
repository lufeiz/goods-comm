import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  distanceInMeters,
  formatDistance,
  isWithinRadius,
  normalizeLocation
} from '../../src/utils/geo.js'

describe('geo utilities', () => {
  it('normalizes latitude and longitude aliases', () => {
    assert.deepEqual(normalizeLocation({ lat: '31.23', lng: '121.45' }), {
      latitude: 31.23,
      longitude: 121.45
    })
    assert.equal(normalizeLocation({ latitude: 'x', longitude: 121 }), null)
    assert.equal(normalizeLocation(null), null)
  })

  it('calculates stable distances and radius checks', () => {
    const seller = { latitude: 31.22945, longitude: 121.45494 }
    const buyer = { latitude: 31.2301, longitude: 121.4556 }
    const distance = distanceInMeters(seller, buyer)

    assert.ok(distance > 90 && distance < 110, `expected roughly 100m, got ${distance}`)
    assert.equal(isWithinRadius(seller, buyer, 120).within, true)
    assert.equal(isWithinRadius(seller, buyer, 80).within, false)
    assert.equal(isWithinRadius(seller, { latitude: Number.NaN, longitude: 121 }, 80).within, false)
  })

  it('formats distances for UI display', () => {
    assert.equal(formatDistance(Number.NaN), '距离未知')
    assert.equal(formatDistance(0.2), '1m')
    assert.equal(formatDistance(999.4), '999m')
    assert.equal(formatDistance(1500), '1.5km')
    assert.equal(formatDistance(12000), '12km')
  })
})
