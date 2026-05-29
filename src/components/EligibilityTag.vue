<template>
  <view :class="['eligibility-tag', toneClass]">
    <text class="tag-dot"></text>
    <text class="tag-text">{{ text }}</text>
  </view>
</template>

<script>
export default {
  name: 'EligibilityTag',
  props: {
    result: {
      type: Object,
      default: null
    }
  },
  computed: {
    text() {
      if (!this.result) {
        return '待校验'
      }

      if (this.result.pendingServerCheck) {
        return '待服务端校验'
      }

      return this.result.eligible ? '可交易' : '暂不可交易'
    },
    toneClass() {
      if (!this.result) {
        return 'neutral'
      }

      if (this.result.pendingServerCheck) {
        return 'neutral'
      }

      return this.result.eligible ? 'success' : 'warning'
    }
  }
}
</script>

<style scoped>
.eligibility-tag {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  height: 44rpx;
  padding: 0 14rpx;
  border-radius: 8rpx;
  font-size: 22rpx;
  font-weight: 650;
}

.tag-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
}

.success {
  color: #1f7a4d;
  background: #edf6ef;
}

.success .tag-dot {
  background: #1f7a4d;
}

.warning {
  color: #9b421f;
  background: #fff0e8;
}

.warning .tag-dot {
  background: #c6562c;
}

.neutral {
  color: #6e7c73;
  background: #eef1eb;
}

.neutral .tag-dot {
  background: #9aa79e;
}
</style>
