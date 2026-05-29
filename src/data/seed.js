import { DEMO_REGIONS } from './regions.js'

export const CATEGORIES = [
  { value: 'all', label: '全部' },
  { value: 'digital', label: '数码' },
  { value: 'home', label: '家居' },
  { value: 'baby', label: '母婴' },
  { value: 'book', label: '图书' },
  { value: 'sport', label: '运动' }
]

export const CONDITIONS = [
  { value: 'new', label: '几乎全新' },
  { value: 'good', label: '成色良好' },
  { value: 'used', label: '正常使用痕迹' }
]

const shimen = DEMO_REGIONS[0]
const jiangning = DEMO_REGIONS[1]
const ruijin = DEMO_REGIONS[2]

export const SEED_ITEMS = [
  {
    id: 'item_1001',
    title: '宜家小边桌',
    price: 58,
    category: 'home',
    condition: 'good',
    description: '客厅用小边桌，桌面无明显划痕，自提优先。',
    seller: {
      nickname: '林女士',
      contact: 'community-demo-1001'
    },
    coverTone: 'sage',
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1200
    },
    location: buildLocation(shimen, 'community'),
    createdAt: 1715660000000
  },
  {
    id: 'item_1002',
    title: '儿童滑板车',
    price: 120,
    category: 'baby',
    condition: 'used',
    description: '适合 4-7 岁，轮子顺滑，楼下可验货。',
    seller: {
      nickname: '王先生',
      contact: 'community-demo-1002'
    },
    coverTone: 'blue',
    tradeScope: {
      type: 'street',
      label: '同街道',
      radiusMeters: 4000
    },
    location: buildLocation(jiangning, 'street'),
    createdAt: 1715580000000
  },
  {
    id: 'item_1003',
    title: 'Kindle Paperwhite',
    price: 310,
    category: 'digital',
    condition: 'good',
    description: '带保护壳，屏幕无坏点，支持当面开机检查。',
    seller: {
      nickname: '陈同学',
      contact: 'community-demo-1003'
    },
    coverTone: 'ink',
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: 1000
    },
    location: buildLocation(ruijin, 'community'),
    createdAt: 1715500000000
  }
]

function buildLocation(region, scopeType) {
  return {
    latitude: region.latitude,
    longitude: region.longitude,
    communityId: region.communityId,
    communityName: region.communityName,
    streetId: region.streetId,
    streetName: region.streetName,
    scopeType,
    radiusMeters: scopeType === 'street' ? region.streetRadiusMeters : region.radiusMeters
  }
}
