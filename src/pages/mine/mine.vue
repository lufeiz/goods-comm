<template>
  <view class="page">
    <view class="profile">
      <image v-if="user?.avatarUrl" class="avatar image-avatar" :src="user.avatarUrl" mode="aspectFill" />
      <view v-else class="avatar">{{ avatarText }}</view>
      <view>
        <text class="nickname">{{ user?.nickname || '未登录用户' }}</text>
        <text class="platform">{{ loginText }}</text>
      </view>
    </view>

    <view class="auth-actions">
      <!-- #ifdef MP-WEIXIN -->
      <button class="auth-button primary" open-type="chooseAvatar" @chooseavatar="loginWithWeixinAvatar">
        {{ loginButtonText }}
      </button>
      <!-- #endif -->
      <!-- #ifndef MP-WEIXIN -->
      <button class="auth-button primary" @tap="login">
        {{ loginButtonText }}
      </button>
      <!-- #endif -->
      <button v-if="user" class="auth-button" @tap="logout">退出登录</button>
    </view>

    <view class="agreement-panel">
      <label class="agreement-check" @tap="toggleAgreement">
        <checkbox :checked="agreementAccepted" color="#1f7a4d" />
        <text>我已阅读并同意</text>
      </label>
      <view class="agreement-links">
        <text class="link-text" @tap.stop="openLegal('terms')">用户协议</text>
        <text class="link-divider">和</text>
        <text class="link-text" @tap.stop="openLegal('privacy')">隐私政策</text>
      </view>
    </view>

    <!-- #ifdef MP-WEIXIN -->
    <view class="nickname-panel">
      <input
        class="nickname-input"
        type="nickname"
        :value="weixinNickname"
        placeholder="昵称可选"
        @input="onWeixinNicknameInput"
      />
    </view>
    <!-- #endif -->

    <LocationGuard
      :profile="locationProfile"
      :loading="locating"
      @refresh="refreshLocation"
      @open-setting="openSettings"
      @choose-location="chooseLocation"
    />

    <view class="panel">
      <text class="panel-title">我的发布</text>
      <view v-if="user && myGoods.length" class="goods-list">
        <view v-for="item in myGoods" :key="item.id" class="goods-row">
          <view class="goods-main">
            <text class="goods-title">{{ item.title }}</text>
            <text class="goods-meta">¥{{ item.price }} · {{ itemStatusText(item.status) }}</text>
          </view>
          <view class="goods-actions">
            <button v-if="item.status === 'online'" class="mini-button" @tap="changeItemStatus(item, 'removed')">下架</button>
            <button v-if="canRelistItem(item)" class="mini-button primary" @tap="changeItemStatus(item, 'online')">重新上架</button>
          </view>
        </view>
      </view>
      <view v-else class="rule-list">
        <text>{{ user ? '还没有发布物品。' : '登录后可管理自己发布的物品。' }}</text>
      </view>
    </view>

    <view class="panel">
      <text class="panel-title">交易规则</text>
      <view class="rule-list">
        <text>同社区交易：当前位置需在卖家社区范围和距离半径内。</text>
        <text>同街道交易：当前位置需在卖家街道范围和距离半径内。</text>
        <text>平台只记录交易意向，付款、验货、交付由双方线下确认。</text>
      </view>
    </view>

    <view class="panel">
      <text class="panel-title">隐私与风控</text>
      <view class="rule-list">
        <text>当前位置只用于本次校验和距离排序。</text>
        <text>正式上线应在服务端重算距离和行政区归属，避免客户端伪造。</text>
        <text>建议隐藏精确坐标，只展示社区或街道名称。</text>
      </view>
      <view class="button-row">
        <button class="mini-button" @tap="openLegal('terms')">用户协议</button>
        <button class="mini-button" @tap="openLegal('privacy')">隐私政策</button>
      </view>
    </view>

    <view v-if="canShowOpsEntry" class="panel">
      <text class="panel-title">内部运营</text>
      <view class="rule-list">
        <text>处理待审商品、举报、争议和平台通知重试。</text>
      </view>
      <button class="auth-button primary" @tap="goOpsConsole">进入运营控制台</button>
    </view>

    <view v-if="user" class="panel danger-panel">
      <text class="panel-title">账号与数据</text>
      <view class="rule-list">
        <text>注销后会清除当前登录态，并下架你仍在售或审核中的物品。</text>
        <text>进行中的交易会自动取消；真实生产环境还应同步吊销服务端 token。</text>
      </view>
      <button class="danger-auth-button" @tap="deleteAccount">注销账号</button>
    </view>
  </view>
</template>

<script>
import LocationGuard from '../../components/LocationGuard.vue'
import { APP_ENV } from '../../config/app.js'
import {
  clearStoredAuthUser,
  deleteAuthAccount,
  getStoredAuthUser,
  loginWithPlatformProfile,
  loginWithUserInfo,
  logoutAuthSession
} from '../../services/auth.js'
import { changeGoodsStatus, deleteUserOwnedData, fetchMyGoods, statusText } from '../../services/goods.js'
import {
  acceptUserAgreement,
  clearUserAgreementAcceptance,
  hasAcceptedUserAgreement
} from '../../services/compliance.js'
import { chooseLocationProfile, getLocationProfile } from '../../services/location.js'
import { getStoredOpsSecret } from '../../services/ops.js'
import { getPlatformName, openLocationSettings, showToast } from '../../services/platform.js'
import { trackClientEvent } from '../../services/telemetry.js'

export default {
  components: {
    LocationGuard
  },
  data() {
    return {
      locationProfile: null,
      locating: false,
      platformName: getPlatformName(),
      user: getStoredAuthUser(),
      weixinNickname: '',
      myGoods: [],
      agreementAccepted: hasAcceptedUserAgreement()
    }
  },
  computed: {
    avatarText() {
      return (this.user?.nickname || '邻').slice(0, 1)
    },
    loginText() {
      if (!this.user) {
        return `${this.platformName} · 登录后用于展示交易身份`
      }

      return `${this.platformName} · 已授权用户信息`
    },
    loginButtonText() {
      const platformLabel = this.platformName.includes('支付宝') ? '支付宝' : '微信'

      // #ifdef MP-WEIXIN
      return this.user ? `重新授权${platformLabel}头像` : `${platformLabel}头像授权登录`
      // #endif

      return this.user ? `重新授权${platformLabel}信息` : `${platformLabel}信息登录`
    },
    canShowOpsEntry() {
      return APP_ENV !== 'prod' || Boolean(getStoredOpsSecret())
    }
  },
  onShow() {
    this.user = getStoredAuthUser()
    this.agreementAccepted = hasAcceptedUserAgreement()
    if (!this.weixinNickname && this.user?.nickname && this.user.nickname !== '社区用户') {
      this.weixinNickname = this.user.nickname
    }
    this.loadMyGoods()
    this.refreshLocation({ silent: true })
  },
  methods: {
    async loadMyGoods() {
      try {
        this.myGoods = await fetchMyGoods(this.user)
      } catch (error) {
        showToast(error.message || '发布记录加载失败')
      }
    },
    async login() {
      if (!this.ensureAgreementAccepted('登录前请先阅读并同意用户协议和隐私政策')) {
        return
      }

      try {
        this.user = await loginWithPlatformProfile()
        this.loadMyGoods()
        showToast('登录成功', 'success')
      } catch (error) {
        trackClientEvent('login_failed', {
          level: 'warn',
          error,
          context: {
            source: 'platform_profile'
          }
        })
        clearStoredAuthUser()
        this.user = null
        showToast(error?.errMsg || error?.message || '登录未完成')
      }
    },
    async loginWithWeixinAvatar(event) {
      if (!this.ensureAgreementAccepted('登录前请先阅读并同意用户协议和隐私政策')) {
        return
      }

      const avatarUrl = event?.detail?.avatarUrl

      if (!avatarUrl) {
        showToast('未选择微信头像')
        return
      }

      try {
        this.user = await loginWithUserInfo({
          nickName: this.weixinNickname.trim() || '社区用户',
          avatarUrl
        }, event?.detail || {})
        this.loadMyGoods()
        showToast('登录成功', 'success')
      } catch (error) {
        trackClientEvent('login_failed', {
          level: 'warn',
          error,
          context: {
            source: 'weixin_avatar'
          }
        })
        clearStoredAuthUser()
        this.user = null
        showToast(error?.errMsg || error?.message || '登录未完成')
      }
    },
    onWeixinNicknameInput(event) {
      this.weixinNickname = event?.detail?.value || ''
    },
    toggleAgreement() {
      if (this.agreementAccepted) {
        clearUserAgreementAcceptance()
        this.agreementAccepted = false
        showToast('已取消协议确认')
        return
      }

      acceptUserAgreement({
        source: 'mine-checkbox'
      })
      this.agreementAccepted = true
      showToast('已同意协议', 'success')
    },
    ensureAgreementAccepted(content) {
      if (hasAcceptedUserAgreement()) {
        this.agreementAccepted = true
        return true
      }

      uni.showModal({
        title: '需要确认协议',
        content,
        confirmText: '查看协议',
        success: (res) => {
          if (res.confirm) {
            this.openLegal('terms')
          }
        }
      })

      return false
    },
    async logout() {
      const currentUser = this.user

      if (currentUser) {
        try {
          await logoutAuthSession(currentUser)
        } catch (error) {
          showToast(error.message || '服务端退出失败，已清除本机登录态')
        }
      }

      clearStoredAuthUser()
      this.user = null
      this.myGoods = []
      showToast('已退出')
    },
    deleteAccount() {
      if (!this.user) {
        return
      }

      uni.showModal({
        title: '确认注销账号',
        content: '注销后当前账号登录态会失效，仍在售或审核中的发布会下架，进行中的交易会取消。',
        confirmText: '确认注销',
        confirmColor: '#8a3c21',
        success: async (res) => {
          if (!res.confirm) {
            return
          }

          try {
            await deleteAuthAccount(this.user)
            deleteUserOwnedData(this.user)
            clearStoredAuthUser()
            this.user = null
            this.myGoods = []
            showToast('账号已注销', 'success')
          } catch (error) {
            trackClientEvent('account_delete_failed', {
              level: 'error',
              error,
              user: this.user
            })
            showToast(error.message || '注销失败')
          }
        }
      })
    },
    itemStatusText(status) {
      return statusText(status)
    },
    canRelistItem(item) {
      return item.status === 'removed' &&
        !['reported_removed', 'seller_deleted', 'rejected'].includes(item.reviewStatus)
    },
    async changeItemStatus(item, status) {
      try {
        await changeGoodsStatus(item.id, status, this.user)
        showToast('物品状态已更新', 'success')
        this.loadMyGoods()
      } catch (error) {
        showToast(error.message || '操作失败')
      }
    },
    async refreshLocation(options = {}) {
      if (this.locating) {
        return
      }

      this.locating = true
      this.locationProfile = await getLocationProfile()
      this.locating = false

      if (!options.silent && this.locationProfile?.error) {
        this.handleLocationError()
      }
    },
    async chooseLocation() {
      if (this.locating) {
        return
      }

      this.locating = true
      try {
        this.locationProfile = await chooseLocationProfile()
        showToast(this.locationProfile.error ? this.locationProfile.error.message : '位置已确认')
      } catch (error) {
        showToast(error?.errMsg || error?.message || '未选择位置')
      } finally {
        this.locating = false
      }
    },
    async openSettings() {
      try {
        await openLocationSettings()
        await this.refreshLocation()
      } catch (error) {
        showToast('无法打开权限设置')
      }
    },
    goOpsConsole() {
      uni.navigateTo({
        url: '/pages/ops/ops'
      })
    },
    openLegal(type) {
      uni.navigateTo({
        url: `/pages/legal/legal?type=${type}`
      })
    },
    handleLocationError() {
      if (this.locationProfile?.error?.code !== 'LOCATION_DENIED') {
        showToast(this.locationProfile.error.message)
        return
      }

      uni.showModal({
        title: '需要位置权限',
        content: '请允许获取当前位置，用于判断同社区或同街道交易范围。',
        confirmText: '去授权',
        success: (res) => {
          if (res.confirm) {
            this.openSettings()
          }
        }
      })
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 28rpx 48rpx;
}

.profile,
.panel {
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.profile {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-bottom: 22rpx;
  padding: 26rpx;
}

.auth-actions {
  display: flex;
  gap: 14rpx;
  margin-bottom: 22rpx;
}

.agreement-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 22rpx;
  padding: 20rpx 22rpx;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.agreement-check,
.agreement-links,
.button-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.agreement-check {
  color: #17231c;
  font-size: 24rpx;
}

.agreement-links {
  flex-wrap: wrap;
}

.link-text {
  color: #1f7a4d;
  font-size: 24rpx;
  font-weight: 700;
}

.link-divider {
  color: #6e7c73;
  font-size: 24rpx;
}

.auth-button {
  flex: 1;
  height: 78rpx;
  color: #5f6c64;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  font-size: 26rpx;
}

.auth-button.primary {
  color: #ffffff;
  background: #1f7a4d;
  border-color: #1f7a4d;
}

.nickname-panel {
  margin-bottom: 22rpx;
  padding: 0;
}

.nickname-input {
  width: 100%;
  height: 78rpx;
  padding: 0 24rpx;
  color: #17231c;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
  font-size: 26rpx;
  line-height: 78rpx;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 86rpx;
  height: 86rpx;
  color: #ffffff;
  background: #1f7a4d;
  border-radius: 8rpx;
  font-size: 34rpx;
  font-weight: 800;
}

.image-avatar {
  display: block;
  overflow: hidden;
}

.nickname {
  display: block;
  color: #17231c;
  font-size: 32rpx;
  font-weight: 800;
}

.platform {
  display: block;
  margin-top: 8rpx;
  color: #6e7c73;
  font-size: 24rpx;
}

.panel {
  margin-top: 22rpx;
  padding: 26rpx;
}

.panel-title {
  display: block;
  color: #17231c;
  font-size: 30rpx;
  font-weight: 750;
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 18rpx;
}

.rule-list text {
  color: #5f6c64;
  font-size: 25rpx;
  line-height: 1.55;
}

.button-row {
  margin-top: 18rpx;
}

.goods-list {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  margin-top: 18rpx;
}

.goods-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx;
  background: #f8faf6;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.goods-main {
  min-width: 0;
}

.goods-title {
  display: block;
  color: #17231c;
  font-size: 26rpx;
  font-weight: 700;
}

.goods-meta {
  display: block;
  margin-top: 6rpx;
  color: #6e7c73;
  font-size: 23rpx;
}

.goods-actions {
  flex: 0 0 auto;
}

.mini-button {
  min-width: 104rpx;
  height: 58rpx;
  color: #5f6c64;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  font-size: 23rpx;
}

.mini-button.primary {
  color: #ffffff;
  background: #1f7a4d;
  border-color: #1f7a4d;
}

.danger-panel {
  border-color: #e8c1aa;
}

.danger-auth-button {
  width: 100%;
  height: 74rpx;
  margin-top: 20rpx;
  color: #8a3c21;
  background: #fff3ea;
  border: 1rpx solid #e8c1aa;
  font-size: 26rpx;
}
</style>
