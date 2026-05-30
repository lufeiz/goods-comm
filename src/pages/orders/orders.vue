<template>
  <view class="page" data-testid="orders-page">
    <view class="summary" data-testid="orders-summary">
      <text class="summary-title">我的交易</text>
      <text class="summary-desc">{{ summaryText }}</text>
    </view>

    <view v-if="user && notifications.length" class="notification-list" data-testid="orders-notification-list">
      <view
        v-for="notification in notifications"
        :key="notification.id"
        :class="['notification-card', notification.readAt ? 'is-read' : '']"
      >
        <view class="notification-main">
          <text class="notification-title">{{ notification.title }}</text>
          <text class="notification-body">{{ notification.body }}</text>
        </view>
        <button
          v-if="!notification.readAt"
          class="notification-action"
          @tap="readNotification(notification)"
        >
          已读
        </button>
      </view>
    </view>

    <view v-if="!user" class="empty-state" data-testid="orders-login-required">
      <text class="empty-title">请先登录</text>
      <text class="empty-desc">登录后可查看买入、卖出和待确认交易。</text>
      <button class="primary-action" data-testid="orders-login-entry" @tap="goLogin">去登录</button>
    </view>

    <view v-else-if="trades.length" class="trade-list" data-testid="orders-trade-list">
      <view v-for="trade in trades" :key="trade.id" class="trade-card">
        <view class="trade-head">
          <text class="trade-title">{{ trade.itemTitle }}</text>
          <text class="trade-price">¥{{ trade.price }}</text>
        </view>
        <text class="trade-status">{{ tradeStatusText(trade.status) }}</text>
        <text class="trade-desc">{{ trade.eligibilityMessage }}</text>
        <text v-if="contactText(trade)" class="trade-contact">{{ contactText(trade) }}</text>
        <text v-if="disputeText(trade)" class="trade-dispute">{{ disputeText(trade) }}</text>
        <text v-if="auditText(trade)" class="trade-audit">{{ auditText(trade) }}</text>
        <view class="seller-line">
          <text>卖家：{{ trade.seller.nickname }}</text>
          <text v-if="trade.buyer?.nickname">买家：{{ trade.buyer.nickname }}</text>
          <text>{{ formatTime(trade.createdAt) }}</text>
        </view>
        <view v-if="availableActions(trade).length" class="action-row">
          <button
            v-for="action in availableActions(trade)"
            :key="action.status"
            :class="['trade-action', action.primary ? 'primary' : '']"
            @tap="updateStatus(trade, action.status)"
          >
            {{ action.label }}
          </button>
        </view>
        <view v-if="canReview(trade)" class="review-panel">
          <text class="review-title">交易评价</text>
          <view class="rating-row">
            <button
              v-for="rating in ratingOptions"
              :key="rating"
              :class="['rating-action', reviewRating(trade.id) === rating ? 'selected' : '']"
              @tap="setReviewRating(trade.id, rating)"
            >
              {{ rating }}星
            </button>
          </view>
          <view class="tag-row">
            <button
              v-for="tag in reviewTagOptions"
              :key="tag"
              :class="['tag-action', reviewTags(trade.id).includes(tag) ? 'selected' : '']"
              @tap="toggleReviewTag(trade.id, tag)"
            >
              {{ tag }}
            </button>
          </view>
          <textarea
            class="review-input"
            maxlength="200"
            :value="reviewContent(trade.id)"
            placeholder="补充评价（选填）"
            @input="updateReviewContent(trade.id, $event)"
          />
          <button class="review-submit" @tap="submitReview(trade)">提交评价</button>
        </view>
        <text v-else-if="hasReviewed(trade)" class="reviewed-label">已评价</text>
      </view>
    </view>

    <view v-else class="empty-state" data-testid="orders-empty-state">
      <text class="empty-title">还没有交易意向</text>
      <text class="empty-desc">在物品详情页通过位置校验后，可以发起交易。</text>
    </view>
  </view>
</template>

<script>
import { getStoredAuthUser } from '../../services/auth.js'
import {
  changeTradeStatus,
  canReviewTrade,
  fetchTradeIntents,
  fetchNotifications,
  getTradeActionConfirmOptions,
  getTradeContactText,
  isTradeActionAllowed,
  markNotificationRead,
  statusText,
  submitTradeReview,
  TRADE_STATUS
} from '../../services/goods.js'
import { showToast } from '../../services/platform.js'

export default {
  data() {
    return {
      user: null,
      trades: [],
      notifications: [],
      reviewDrafts: {},
      ratingOptions: [5, 4, 3, 2, 1],
      reviewTagOptions: ['准时', '沟通顺畅', '物品一致', '爽快']
    }
  },
  computed: {
    summaryText() {
      if (!this.user) {
        return '登录后展示与你有关的买入和卖出交易。'
      }

      return '仅记录已通过 LBS 校验的交易意向，卖家确认后生成一次性联系码。'
    }
  },
  onShow() {
    this.user = getStoredAuthUser()
    this.loadTrades()
    this.loadNotifications()
  },
  methods: {
    async loadTrades() {
      try {
        this.trades = await fetchTradeIntents({
          user: this.user
        })
        this.primeReviewDrafts()
      } catch (error) {
        showToast(error.message || '交易加载失败')
      }
    },
    async loadNotifications() {
      if (!this.user) {
        this.notifications = []
        return
      }

      try {
        this.notifications = (await fetchNotifications({
          user: this.user
        })).slice(0, 5)
      } catch (error) {
        showToast(error.message || '通知加载失败')
      }
    },
    async readNotification(notification) {
      try {
        const next = await markNotificationRead(notification.id, this.user)
        this.notifications = this.notifications.map((candidate) =>
          candidate.id === notification.id ? next : candidate
        )
      } catch (error) {
        showToast(error.message || '操作失败')
      }
    },
    tradeStatusText(status) {
      return statusText(status)
    },
    contactText(trade) {
      return getTradeContactText(trade)
    },
    disputeText(trade) {
      const dispute = trade.disputeCase

      if (!dispute) {
        return ''
      }

      if (dispute.status === 'resolved') {
        return `争议已处理：${this.disputeResolutionText(dispute.resolution)}`
      }

      return '争议处理中，客服将根据举报、交易记录和双方反馈处理。'
    },
    disputeResolutionText(resolution) {
      const map = {
        release_item: '取消交易并释放商品',
        complete_trade: '确认交易完成',
        remove_item: '取消交易并下架商品'
      }

      return map[resolution] || '已处理'
    },
    availableActions(trade) {
      const actions = [
        {
          status: TRADE_STATUS.PENDING_MEETUP,
          label: '确认可交易',
          primary: true
        },
        {
          status: TRADE_STATUS.COMPLETED,
          label: '标记完成',
          primary: true
        },
        {
          status: TRADE_STATUS.CANCELLED,
          label: '取消',
          primary: false
        },
        {
          status: TRADE_STATUS.DISPUTED,
          label: '发起争议',
          primary: false
        }
      ]

      return actions.filter((action) => isTradeActionAllowed(trade, action.status, this.user))
    },
    canReview(trade) {
      return canReviewTrade(trade, this.user)
    },
    hasReviewed(trade) {
      return trade.status === TRADE_STATUS.COMPLETED && Boolean(trade.reviewedByMe)
    },
    primeReviewDrafts() {
      const next = { ...this.reviewDrafts }

      for (const trade of this.trades) {
        if (this.canReview(trade) && !next[trade.id]) {
          next[trade.id] = {
            rating: 5,
            content: '',
            tags: []
          }
        }
      }

      this.reviewDrafts = next
    },
    reviewRating(tradeId) {
      return this.reviewDrafts[tradeId]?.rating || 5
    },
    reviewContent(tradeId) {
      return this.reviewDrafts[tradeId]?.content || ''
    },
    reviewTags(tradeId) {
      return this.reviewDrafts[tradeId]?.tags || []
    },
    setReviewRating(tradeId, rating) {
      this.reviewDrafts = {
        ...this.reviewDrafts,
        [tradeId]: {
          rating,
          content: this.reviewContent(tradeId),
          tags: this.reviewTags(tradeId)
        }
      }
    },
    updateReviewContent(tradeId, event) {
      this.reviewDrafts = {
        ...this.reviewDrafts,
        [tradeId]: {
          rating: this.reviewRating(tradeId),
          content: event.detail?.value || '',
          tags: this.reviewTags(tradeId)
        }
      }
    },
    toggleReviewTag(tradeId, tag) {
      const tags = this.reviewTags(tradeId)
      const nextTags = tags.includes(tag)
        ? tags.filter((candidate) => candidate !== tag)
        : [...tags, tag]

      this.reviewDrafts = {
        ...this.reviewDrafts,
        [tradeId]: {
          rating: this.reviewRating(tradeId),
          content: this.reviewContent(tradeId),
          tags: nextTags
        }
      }
    },
    async submitReview(trade) {
      const draft = this.reviewDrafts[trade.id] || {
        rating: 5,
        content: '',
        tags: []
      }

      try {
        await submitTradeReview(trade.id, draft, this.user)
        const next = { ...this.reviewDrafts }
        delete next[trade.id]
        this.reviewDrafts = next
        showToast('评价已提交', 'success')
        this.loadTrades()
        this.loadNotifications()
      } catch (error) {
        showToast(error.message || '评价提交失败')
      }
    },
    async updateStatus(trade, status) {
      const confirmed = await this.confirmTradeAction(status)

      if (!confirmed) {
        return
      }

      try {
        await changeTradeStatus(trade.id, status, this.user)
        showToast('交易状态已更新', 'success')
        this.loadTrades()
        this.loadNotifications()
      } catch (error) {
        showToast(error.message || '操作失败')
      }
    },
    confirmTradeAction(status) {
      const options = getTradeActionConfirmOptions(status)

      if (!options) {
        return Promise.resolve(true)
      }

      return new Promise((resolve) => {
        uni.showModal({
          ...options,
          cancelText: '再想想',
          confirmColor: status === TRADE_STATUS.PENDING_MEETUP ? '#1f7a4d' : '#8a3c21',
          success: (res) => resolve(Boolean(res.confirm)),
          fail: () => resolve(false)
        })
      })
    },
    goLogin() {
      uni.switchTab({
        url: '/pages/mine/mine'
      })
    },
    formatTime(timestamp) {
      const date = new Date(timestamp)
      const month = `${date.getMonth() + 1}`.padStart(2, '0')
      const day = `${date.getDate()}`.padStart(2, '0')
      const hour = `${date.getHours()}`.padStart(2, '0')
      const minute = `${date.getMinutes()}`.padStart(2, '0')

      return `${month}-${day} ${hour}:${minute}`
    },
    auditText(trade) {
      const audit = trade.locationAudit

      if (!audit || (!Number.isFinite(Number(audit.distanceMeters)) && !Number.isFinite(Number(audit.accuracy)))) {
        return ''
      }

      const distance = Number.isFinite(Number(audit.distanceMeters))
        ? `距离约 ${Math.round(audit.distanceMeters)}m`
        : ''
      const accuracy = Number.isFinite(Number(audit.accuracy))
        ? `定位精度 ${Math.round(audit.accuracy)}m`
        : ''

      return [distance, accuracy].filter(Boolean).join('，')
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 28rpx 48rpx;
}

.summary,
.notification-card,
.trade-card,
.empty-state {
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.summary {
  padding: 26rpx;
}

.summary-title {
  display: block;
  color: #17231c;
  font-size: 34rpx;
  font-weight: 800;
}

.summary-desc {
  display: block;
  margin-top: 10rpx;
  color: #6e7c73;
  font-size: 25rpx;
  line-height: 1.5;
}

.notification-list {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  margin-top: 18rpx;
}

.notification-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  padding: 20rpx 22rpx;
}

.notification-card.is-read {
  opacity: 0.74;
}

.notification-main {
  min-width: 0;
}

.notification-title,
.notification-body {
  display: block;
}

.notification-title {
  color: #17231c;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 1.35;
}

.notification-body {
  margin-top: 6rpx;
  color: #5f6c64;
  font-size: 23rpx;
  line-height: 1.45;
}

.notification-action {
  flex: 0 0 auto;
  min-width: 92rpx;
  padding: 12rpx 16rpx;
  color: #1f7a4d;
  background: #edf6ef;
  border: 1rpx solid #b9dbc4;
  font-size: 22rpx;
}

.trade-list {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  margin-top: 22rpx;
}

.trade-card {
  padding: 24rpx;
}

.trade-head,
.seller-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.trade-title {
  flex: 1;
  color: #17231c;
  font-size: 30rpx;
  font-weight: 750;
}

.trade-price {
  color: #c6562c;
  font-size: 30rpx;
  font-weight: 800;
}

.trade-status {
  display: inline-flex;
  margin-top: 14rpx;
  padding: 8rpx 12rpx;
  color: #1f7a4d;
  background: #edf6ef;
  border-radius: 8rpx;
  font-size: 22rpx;
  font-weight: 650;
}

.trade-desc,
.trade-contact,
.trade-dispute,
.trade-audit {
  display: block;
  margin-top: 14rpx;
  color: #5f6c64;
  font-size: 25rpx;
  line-height: 1.5;
}

.trade-audit {
  color: #6e7c73;
  font-size: 23rpx;
}

.trade-contact {
  color: #1f7a4d;
  font-weight: 650;
}

.trade-dispute {
  color: #8a3c21;
  font-weight: 650;
}

.review-panel {
  margin-top: 18rpx;
  padding: 18rpx;
  background: #f7faf6;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.review-title,
.reviewed-label {
  display: block;
  color: #17231c;
  font-size: 24rpx;
  font-weight: 700;
}

.rating-row,
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 14rpx;
}

.rating-action,
.tag-action {
  min-width: 96rpx;
  height: 56rpx;
  padding: 0 16rpx;
  color: #5f6c64;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  font-size: 22rpx;
}

.rating-action.selected,
.tag-action.selected {
  color: #1f7a4d;
  background: #edf6ef;
  border-color: #9dceb0;
}

.review-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 132rpx;
  margin-top: 14rpx;
  padding: 16rpx;
  color: #17231c;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
  font-size: 24rpx;
  line-height: 1.5;
}

.review-submit {
  width: 100%;
  height: 62rpx;
  margin-top: 14rpx;
  color: #ffffff;
  background: #1f7a4d;
  border-color: #1f7a4d;
  font-size: 24rpx;
}

.reviewed-label {
  margin-top: 18rpx;
  color: #1f7a4d;
}

.seller-line {
  flex-wrap: wrap;
  margin-top: 18rpx;
  color: #6e7c73;
  font-size: 23rpx;
}

.empty-state {
  margin-top: 22rpx;
  padding: 72rpx 32rpx;
  text-align: center;
}

.empty-title {
  display: block;
  color: #17231c;
  font-size: 30rpx;
  font-weight: 700;
}

.empty-desc {
  display: block;
  margin-top: 10rpx;
  color: #6e7c73;
  font-size: 24rpx;
  line-height: 1.5;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 18rpx;
}

.trade-action,
.primary-action {
  min-width: 138rpx;
  height: 64rpx;
  color: #5f6c64;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  font-size: 24rpx;
}

.trade-action.primary,
.primary-action {
  color: #ffffff;
  background: #1f7a4d;
  border-color: #1f7a4d;
}

.primary-action {
  margin-top: 24rpx;
}
</style>
