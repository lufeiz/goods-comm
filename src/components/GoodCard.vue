<template>
  <view class="good-card" data-testid="good-card" @tap="$emit('open', item)">
    <image v-if="coverImage" class="cover image-cover" :src="coverImage" mode="aspectFill" />
    <view v-else :class="['cover', coverClass]">
      <text class="cover-text">{{ coverText }}</text>
    </view>
    <view class="content">
      <view class="title-row">
        <text class="title">{{ item.title }}</text>
        <text class="price">¥{{ item.price }}</text>
      </view>
      <text class="description">{{ item.description }}</text>
      <view class="meta-row">
        <text class="scope">{{ item.tradeScope?.label || '同社区' }}</text>
        <text class="distance">{{ distanceText }}</text>
        <text v-if="statusLabel" class="status">{{ statusLabel }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import { formatDistance } from '../utils/geo.js'

export default {
  name: 'GoodCard',
  props: {
    item: {
      type: Object,
      required: true
    }
  },
  emits: ['open'],
  computed: {
    coverImage() {
      const image = this.item.images?.find((candidate) =>
        typeof candidate === 'string' ? candidate : candidate?.url
      )

      return typeof image === 'string' ? image : image?.url || ''
    },
    coverClass() {
      return `tone-${this.item.coverTone || 'sage'}`
    },
    coverText() {
      return String(this.item.title || '').slice(0, 2)
    },
    distanceText() {
      return this.item.distanceMeters === null || this.item.distanceMeters === undefined
        ? '授权后看距离'
        : formatDistance(this.item.distanceMeters)
    },
    statusLabel() {
      const map = {
        reserved: '已锁定',
        sold: '已售出'
      }

      return map[this.item.status] || ''
    }
  }
}
</script>

<style scoped>
.good-card {
  display: flex;
  gap: 22rpx;
  padding: 22rpx;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.cover {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 156rpx;
  width: 156rpx;
  height: 156rpx;
  border-radius: 8rpx;
}

.image-cover {
  display: block;
  overflow: hidden;
  background: #f0f2ed;
}

.cover-text {
  color: rgba(255, 255, 255, 0.94);
  font-size: 34rpx;
  font-weight: 750;
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

.content {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  justify-content: space-between;
}

.title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18rpx;
}

.title {
  flex: 1;
  color: #17231c;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.35;
}

.price {
  flex: 0 0 auto;
  color: #c6562c;
  font-size: 30rpx;
  font-weight: 750;
}

.description {
  display: -webkit-box;
  margin-top: 10rpx;
  overflow: hidden;
  color: #5f6c64;
  font-size: 24rpx;
  line-height: 1.45;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 16rpx;
}

.scope,
.distance,
.status {
  padding: 7rpx 12rpx;
  border-radius: 8rpx;
  font-size: 22rpx;
}

.scope {
  color: #1f7a4d;
  background: #edf6ef;
}

.distance {
  color: #5f6c64;
  background: #f0f2ed;
}

.status {
  color: #8a3c21;
  background: #fff3ea;
}
</style>
