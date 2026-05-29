<template>
  <view class="location-wrap">
    <view class="location-guard">
      <view class="location-main">
        <text class="location-title">{{ title }}</text>
        <text class="location-desc">{{ description }}</text>
        <text v-if="qualityText" class="location-meta">{{ qualityText }}</text>
      </view>
      <view class="location-actions">
        <button class="location-action" :disabled="loading" @tap="$emit('refresh')">
          {{ loading ? '定位中' : '刷新' }}
        </button>
        <button class="location-action secondary" :disabled="loading" @tap="$emit('choose-location')">
          选择
        </button>
      </view>
    </view>
    <view v-if="profile?.error" class="location-error">
      <text>{{ profile.error.message }}</text>
      <button v-if="canOpenSetting" class="link-button" @tap="$emit('open-setting')">{{ errorView.actionText }}</button>
    </view>
  </view>
</template>

<script>
import { getPlatformName } from '../services/platform.js'
import {
  getLocationErrorView,
  getLocationQualityText
} from '../services/location.js'

export default {
  name: 'LocationGuard',
  props: {
    profile: {
      type: Object,
      default: null
    },
    loading: {
      type: Boolean,
      default: false
    }
  },
  emits: ['refresh', 'open-setting', 'choose-location'],
  computed: {
    errorView() {
      return this.profile?.error ? getLocationErrorView(this.profile.error) : null
    },
    canOpenSetting() {
      return Boolean(this.errorView?.canOpenSetting)
    },
    title() {
      if (this.profile?.error) {
        return this.errorView.title
      }

      const region = this.profile?.region
      const location = this.profile?.location
      const displayName = this.profile?.displayName

      if (region?.communityName) {
        return region.communityName
      }

      if (region?.streetName) {
        return region.streetName
      }

      if (displayName) {
        return displayName
      }

      if (location?.name) {
        return location.name
      }

      if (location) {
        return '当前位置已定位'
      }

      return '未确认当前位置'
    },
    description() {
      if (this.profile?.error) {
        return this.errorView.description
      }

      const region = this.profile?.region
      const location = this.profile?.location
      const displayAddress = this.profile?.displayAddress

      if (region?.streetName) {
        return `${getPlatformName()}已确认${this.sourceText}位置`
      }

      if (displayAddress) {
        return displayAddress
      }

      if (location?.address) {
        return location.address
      }

      if (location) {
        return `${getPlatformName()}已确认${this.sourceText}位置`
      }

      return '授权后可查看距离并发起符合范围的交易'
    },
    sourceText() {
      const source = this.profile?.source
      return source === 'chosen' ? '选择' : '当前'
    },
    qualityText() {
      return getLocationQualityText(this.profile)
    }
  }
}
</script>

<style scoped>
.location-guard {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 22rpx 24rpx;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.location-main {
  min-width: 0;
}

.location-title {
  display: block;
  color: #17231c;
  font-size: 30rpx;
  font-weight: 650;
  line-height: 1.35;
}

.location-desc {
  display: block;
  margin-top: 6rpx;
  color: #6e7c73;
  font-size: 24rpx;
  line-height: 1.4;
}

.location-meta {
  display: block;
  margin-top: 6rpx;
  color: #8b6d2f;
  font-size: 22rpx;
  line-height: 1.35;
}

.location-action {
  flex: 0 0 auto;
  min-width: 112rpx;
  padding: 16rpx 18rpx;
  color: #1f7a4d;
  background: #edf6ef;
  border: 1rpx solid #b9dbc4;
  font-size: 24rpx;
}

.location-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 10rpx;
}

.location-action.secondary {
  min-width: 96rpx;
  color: #5f6c64;
  background: #ffffff;
  border-color: #dfe6dc;
}

.location-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 12rpx;
  padding: 16rpx 20rpx;
  color: #8a3c21;
  background: #fff3ea;
  border-radius: 8rpx;
  font-size: 24rpx;
}

.link-button {
  flex: 0 0 auto;
  padding: 0;
  color: #8a3c21;
  background: transparent;
  border: 0;
  font-size: 24rpx;
}
</style>
