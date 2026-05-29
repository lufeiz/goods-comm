<template>
  <view>
    <view v-if="item" class="page">
      <image v-if="coverImage" class="hero-cover image-cover" :src="coverImage" mode="aspectFill" />
      <view v-else :class="['hero-cover', coverClass]">
        <text class="hero-text">{{ item.title.slice(0, 2) }}</text>
      </view>

      <view class="title-block">
        <view class="title-row">
          <text class="title">{{ item.title }}</text>
          <text class="price">¥{{ item.price }}</text>
        </view>
        <view class="meta-row">
          <text>{{ categoryLabel }}</text>
          <text>{{ conditionLabel }}</text>
          <text>{{ item.tradeScope?.label || '同社区' }}</text>
          <text>{{ itemStatusText }}</text>
        </view>
      </view>

      <view class="panel">
        <view class="panel-head">
          <text class="panel-title">交易资格</text>
          <EligibilityTag :result="eligibility" />
        </view>
        <text class="eligibility-message">{{ eligibility?.message || '刷新当前位置后判断是否可发起交易' }}</text>
        <view class="scope-detail">
          <text>要求：{{ item.tradeScope?.label || '同社区' }}，{{ radiusText }} 内</text>
          <text>位置：{{ locationText }}</text>
        </view>
        <button class="outline-button" :disabled="checking" @tap="refreshEligibility">
          {{ checking ? '校验中' : '刷新定位校验' }}
        </button>
        <button class="outline-button choose-button" :disabled="checking" @tap="chooseEligibilityLocation">
          选择位置预估
        </button>
        <text class="trade-note">发起交易会重新使用实时 GPS 定位做最终校验，手动选择位置只用于预估。</text>
      </view>

      <view class="panel">
        <text class="panel-title">物品说明</text>
        <text class="description">{{ item.description }}</text>
      </view>

      <view class="panel">
        <text class="panel-title">卖家</text>
        <view class="seller-row">
          <view class="avatar">{{ item.seller.nickname.slice(0, 1) }}</view>
          <view>
            <text class="seller-name">{{ item.seller.nickname }}</text>
            <text class="seller-desc">建议当面验货，线下自愿交易</text>
          </view>
        </view>
      </view>

      <view class="bottom-bar">
        <button class="danger-button" @tap="reportItem">举报</button>
        <button class="primary-button" :disabled="!canStartTrade" @tap="startTrade">{{ tradeButtonText }}</button>
      </view>
    </view>

    <view v-else class="not-found">
      <text>物品不存在或已下架</text>
    </view>
  </view>
</template>

<script>
import EligibilityTag from '../../components/EligibilityTag.vue'
import { CATEGORIES, CONDITIONS } from '../../data/seed.js'
import { getStoredAuthUser, requireStoredAuthUser } from '../../services/auth.js'
import { hasRemoteApi } from '../../services/api.js'
import { requireUserAgreement } from '../../services/compliance.js'
import { fetchGoodsItem, isGoodsTradeAvailable, ITEM_STATUS, statusText, submitTradeIntent } from '../../services/goods.js'
import {
  chooseLocationProfile,
  getLocationProfile,
  isFinalTradeLocationProfile,
  verifyTradeEligibility
} from '../../services/location.js'
import { showToast } from '../../services/platform.js'
import { REPORT_REASONS, submitReport } from '../../services/reports.js'
import { trackClientEvent } from '../../services/telemetry.js'
import { formatDistance } from '../../utils/geo.js'

export default {
  components: {
    EligibilityTag
  },
  data() {
    return {
      item: null,
      eligibility: null,
      currentUser: null,
      checking: false
    }
  },
  computed: {
    categoryLabel() {
      return CATEGORIES.find((category) => category.value === this.item?.category)?.label || '其他'
    },
    coverClass() {
      return `tone-${this.item?.coverTone || 'sage'}`
    },
    coverImage() {
      return this.item?.images?.[0]?.url || this.item?.images?.[0] || ''
    },
    conditionLabel() {
      return CONDITIONS.find((condition) => condition.value === this.item?.condition)?.label || '成色未知'
    },
    radiusText() {
      return formatDistance(this.item?.tradeScope?.radiusMeters || this.item?.location?.radiusMeters)
    },
    locationText() {
      if (this.item?.location?.communityName) {
        return `${this.item.location.communityName} · ${this.item.location.streetName}`
      }

      return this.item?.location?.streetName || '卖家附近'
    },
    itemStatusText() {
      return statusText(this.item?.status || 'online')
    },
    canStartTrade() {
      return isGoodsTradeAvailable(this.item, this.currentUser)
    },
    tradeButtonText() {
      if (this.currentUser?.id && this.item?.seller?.id === this.currentUser.id) {
        return '自己的物品'
      }

      if (this.item?.status === ITEM_STATUS.RESERVED) {
        return '交易处理中'
      }

      if (this.item?.status === ITEM_STATUS.SOLD) {
        return '已售出'
      }

      return '发起交易'
    }
  },
  onShow() {
    this.currentUser = getStoredAuthUser()
  },
  onLoad(query) {
    this.currentUser = getStoredAuthUser()
    this.loadItem(query.id)
  },
  methods: {
    async loadItem(id) {
      this.item = await fetchGoodsItem(id)

      if (this.item) {
        this.loadEligibility()
      }
    },
    async loadEligibility() {
      if (!this.item || this.checking) {
        return
      }

      this.checking = true
      this.eligibility = this.usesServerEligibility()
        ? buildServerEligibility()
        : await verifyTradeEligibility(this.item)
      this.checking = false
    },
    async refreshEligibility() {
      if (!this.item || this.checking) {
        return
      }

      this.checking = true
      this.eligibility = this.usesServerEligibility()
        ? await this.refreshServerEligibility()
        : await verifyTradeEligibility(this.item, { refresh: true })
      this.checking = false
    },
    async chooseEligibilityLocation() {
      if (!this.item || this.checking) {
        return
      }

      this.checking = true
      try {
        const profile = await chooseLocationProfile()
        this.eligibility = this.usesServerEligibility()
          ? buildServerEligibility(profile, '手动选择位置只用于浏览预估，发起交易仍需实时 GPS 并由服务端重算资格')
          : await verifyTradeEligibility(this.item, { profile })
      } catch (error) {
        showToast(error?.errMsg || error?.message || '未选择位置')
      } finally {
        this.checking = false
      }
    },
    async startTrade() {
      if (!this.canStartTrade) {
        uni.showModal({
          title: '暂不可交易',
          content: this.item?.status === ITEM_STATUS.RESERVED
            ? '该物品已有交易处理中，可在交易页查看相关记录。'
            : '该物品当前不可发起交易。',
          showCancel: false
        })
        return
      }

      let buyer

      try {
        buyer = requireStoredAuthUser('发起交易前需要先登录')
      } catch (error) {
        this.promptLogin(error.message || '发起交易前需要先登录')
        return
      }

      try {
        requireUserAgreement('发起交易前请先阅读并同意用户协议和隐私政策')
      } catch (error) {
        this.promptAgreement(error.message)
        return
      }

      this.currentUser = buyer

      if (this.item?.seller?.id === buyer.id) {
        uni.showModal({
          title: '暂不可交易',
          content: '不能购买自己发布的物品。',
          showCancel: false
        })
        return
      }

      this.checking = true
      this.eligibility = this.usesServerEligibility()
        ? await this.refreshServerEligibility()
        : await verifyTradeEligibility(this.item, {
            refresh: true,
            final: true
          })
      this.checking = false

      if (!this.eligibility?.eligible && !this.usesServerEligibility()) {
        uni.showModal({
          title: '暂不可交易',
          content: this.eligibility?.message || '当前位置不满足交易要求',
          showCancel: false
        })
        return
      }

      if (this.usesServerEligibility() && !this.eligibility?.eligible) {
        uni.showModal({
          title: '暂不可交易',
          content: this.eligibility?.message || '发起交易需要使用实时 GPS 定位，请刷新当前位置后再试',
          showCancel: false
        })
        return
      }

      try {
        await submitTradeIntent(this.item, this.eligibility, buyer)
      } catch (error) {
        trackClientEvent('trade_create_failed', {
          level: 'error',
          error,
          user: buyer,
          context: {
            itemId: this.item?.id,
            eligibilityCode: this.eligibility?.code
          }
        })
        uni.showModal({
          title: '发起失败',
          content: error.message || '交易意向创建失败',
          showCancel: false
        })
        return
      }

      this.item = await fetchGoodsItem(this.item.id) || this.item
      uni.showModal({
        title: '已发起交易',
        content: '交易意向已记录，卖家确认后可在交易页查看一次性联系码。',
        confirmText: '查看交易',
        success: (res) => {
          if (res.confirm) {
            uni.switchTab({
              url: '/pages/orders/orders'
            })
          }
        }
      })
    },
    async refreshServerEligibility() {
      const profile = await getLocationProfile()

      if (!isFinalTradeLocationProfile(profile)) {
        return buildServerEligibility(
          profile,
          profile?.error?.message || '发起交易需要使用实时 GPS 定位，请刷新当前位置后再试',
          false
        )
      }

      return buildServerEligibility(profile, '已获取实时 GPS，发起交易时由服务端重算距离和社区归属', true)
    },
    usesServerEligibility() {
      return hasRemoteApi() && !hasCoordinateLocation(this.item?.location)
    },
    promptLogin(content) {
      uni.showModal({
        title: '需要登录',
        content,
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            uni.switchTab({
              url: '/pages/mine/mine'
            })
          }
        }
      })
    },
    promptAgreement(content) {
      uni.showModal({
        title: '需要确认协议',
        content,
        confirmText: '查看协议',
        success: (res) => {
          if (res.confirm) {
            uni.navigateTo({
              url: '/pages/legal/legal?type=terms'
            })
          }
        }
      })
    },
    reportItem() {
      let reporter

      try {
        reporter = requireStoredAuthUser('请先登录后再举报')
      } catch (error) {
        this.promptLogin(error.message || '请先登录后再举报')
        return
      }

      try {
        requireUserAgreement('举报前请先阅读并同意用户协议和隐私政策')
      } catch (error) {
        this.promptAgreement(error.message)
        return
      }

      if (this.item?.seller?.id === reporter.id) {
        showToast('不能举报自己发布的物品')
        return
      }

      uni.showActionSheet({
        itemList: REPORT_REASONS.map((reason) => reason.label),
        success: async (res) => {
          const reason = REPORT_REASONS[res.tapIndex]

          if (!reason) {
            return
          }

          try {
            await submitReport({
              targetType: 'item',
              targetId: this.item.id,
              reason: reason.value,
              description: `详情页举报：${reason.label}`
            }, reporter)
            showToast('举报已提交', 'success')
            this.item = await fetchGoodsItem(this.item.id)
          } catch (error) {
            trackClientEvent('report_submit_failed', {
              level: 'warn',
              error,
              user: reporter,
              context: {
                itemId: this.item?.id,
                reason: reason.value
              }
            })
            showToast(error.message || '举报提交失败')
          }
        }
      })
    }
  }
}

function buildServerEligibility(profile = null, message = '服务端将在发起交易时用实时 GPS 重算距离和社区归属', eligible = false) {
  return {
    eligible,
    pendingServerCheck: true,
    code: eligible ? 'REMOTE_SERVER_CHECK_READY' : 'REMOTE_SERVER_CHECK_REQUIRED',
    message,
    profile
  }
}

function hasCoordinateLocation(location = {}) {
  return Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 28rpx 140rpx;
}

.hero-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 360rpx;
  border-radius: 8rpx;
}

.image-cover {
  display: block;
  overflow: hidden;
  background: #f0f2ed;
}

.hero-text {
  color: rgba(255, 255, 255, 0.94);
  font-size: 72rpx;
  font-weight: 800;
}

.tone-sage {
  background: linear-gradient(135deg, #507a5f, #92a976);
}

.tone-blue {
  background: linear-gradient(135deg, #2c5f8f, #83a3bd);
}

.tone-ink {
  background: linear-gradient(135deg, #17231c, #68746b);
}

.tone-coral {
  background: linear-gradient(135deg, #9b4b35, #d89b77);
}

.title-block,
.panel {
  margin-top: 20rpx;
  padding: 24rpx;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.title-row,
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18rpx;
}

.title {
  flex: 1;
  color: #17231c;
  font-size: 38rpx;
  font-weight: 800;
  line-height: 1.3;
}

.price {
  color: #c6562c;
  font-size: 38rpx;
  font-weight: 800;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 16rpx;
}

.meta-row text {
  padding: 8rpx 12rpx;
  color: #5f6c64;
  background: #f0f2ed;
  border-radius: 8rpx;
  font-size: 22rpx;
}

.panel-title {
  display: block;
  color: #17231c;
  font-size: 28rpx;
  font-weight: 750;
}

.eligibility-message,
.description,
.scope-detail,
.seller-desc {
  display: block;
  margin-top: 12rpx;
  color: #5f6c64;
  font-size: 25rpx;
  line-height: 1.55;
}

.scope-detail {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding: 18rpx 0;
}

.trade-note {
  display: block;
  margin-top: 12rpx;
  color: #8b6d2f;
  font-size: 23rpx;
  line-height: 1.45;
}

.outline-button {
  height: 72rpx;
  color: #1f7a4d;
  background: #edf6ef;
  border: 1rpx solid #b9dbc4;
  font-size: 26rpx;
}

.choose-button {
  margin-top: 14rpx;
  color: #5f6c64;
  background: #ffffff;
  border-color: #dfe6dc;
}

.seller-row {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-top: 16rpx;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 78rpx;
  height: 78rpx;
  color: #ffffff;
  background: #1f7a4d;
  border-radius: 8rpx;
  font-size: 30rpx;
  font-weight: 800;
}

.seller-name {
  display: block;
  color: #17231c;
  font-size: 28rpx;
  font-weight: 700;
}

.bottom-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  gap: 16rpx;
  padding: 18rpx 28rpx 34rpx;
  background: #ffffff;
  border-top: 1rpx solid #dfe6dc;
}

.danger-button,
.primary-button {
  flex: 1;
  height: 82rpx;
  font-size: 28rpx;
  font-weight: 700;
}

.danger-button {
  color: #8a3c21;
  background: #fff3ea;
  border: 1rpx solid #e8c1aa;
}

.primary-button {
  color: #ffffff;
  background: #1f7a4d;
  border: 0;
}

.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  color: #6e7c73;
  font-size: 28rpx;
}
</style>
