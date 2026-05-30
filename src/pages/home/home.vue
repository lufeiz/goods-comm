<template>
  <view class="page" data-testid="home-page">
    <view class="topbar" data-testid="home-topbar">
      <view>
        <text class="app-name">邻里旧货</text>
        <text class="subline">同社区 / 同街道二手流转</text>
      </view>
      <button class="publish-button" data-testid="home-publish-entry" @tap="goPublish">发布</button>
    </view>

    <LocationGuard
      :profile="locationProfile"
      :loading="locating"
      @refresh="refreshLocation"
      @open-setting="openSettings"
      @choose-location="chooseLocation"
    />

    <view class="search-row" data-testid="home-search">
      <input
        class="search-input"
        data-testid="home-search-input"
        v-model="keyword"
        confirm-type="search"
        placeholder="搜索闲置物品"
        @confirm="loadItems"
      />
      <button class="search-button" data-testid="home-search-button" @tap="loadItems">搜索</button>
    </view>

    <scroll-view class="category-strip" scroll-x>
      <view class="category-list">
        <button
          v-for="category in categories"
          :key="category.value"
          :class="['category-chip', category.value === selectedCategory ? 'active' : '']"
          @tap="setCategory(category.value)"
        >
          {{ category.label }}
        </button>
      </view>
    </scroll-view>

    <view class="section-head">
      <text class="section-title">附近物品</text>
      <text class="section-count">{{ items.length }} 件</text>
    </view>

    <view v-if="items.length" class="good-list" data-testid="home-good-list">
      <GoodCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        @open="openItem"
      />
    </view>

    <view v-else class="empty-state" data-testid="home-empty-state">
      <text class="empty-title">暂无匹配物品</text>
      <text class="empty-desc">换个关键词，或发布一件邻里可自提的闲置物品。</text>
    </view>
  </view>
</template>

<script>
import GoodCard from '../../components/GoodCard.vue'
import LocationGuard from '../../components/LocationGuard.vue'
import { CATEGORIES } from '../../data/seed.js'
import { fetchGoodsList } from '../../services/goods.js'
import { chooseLocationProfile, getLocationProfile } from '../../services/location.js'
import { openLocationSettings, showToast } from '../../services/platform.js'

export default {
  components: {
    GoodCard,
    LocationGuard
  },
  data() {
    return {
      categories: CATEGORIES,
      selectedCategory: 'all',
      keyword: '',
      items: [],
      locationProfile: null,
      locating: false
    }
  },
  onShow() {
    this.refreshLocation({ silent: true })
  },
  methods: {
    async refreshLocation(options = {}) {
      if (this.locating) {
        return
      }

      this.locating = true
      this.locationProfile = await getLocationProfile()
      this.locating = false
      this.loadItems()

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
        this.loadItems()
        showToast(this.locationProfile.error ? this.locationProfile.error.message : '位置已确认')
      } catch (error) {
        showToast(error?.errMsg || error?.message || '未选择位置')
      } finally {
        this.locating = false
      }
    },
    async loadItems() {
      try {
        this.items = await fetchGoodsList({
          keyword: this.keyword,
          category: this.selectedCategory,
          currentLocation: this.locationProfile?.location
        })
      } catch (error) {
        showToast(error.message || '物品加载失败')
      }
    },
    setCategory(category) {
      this.selectedCategory = category
      this.loadItems()
    },
    openItem(item) {
      uni.navigateTo({
        url: `/pages/detail/detail?id=${item.id}`
      })
    },
    goPublish() {
      uni.switchTab({
        url: '/pages/publish/publish'
      })
    },
    async openSettings() {
      try {
        await openLocationSettings()
        await this.refreshLocation()
      } catch (error) {
        showToast('无法打开权限设置')
      }
    },
    handleLocationError() {
      if (this.locationProfile?.error?.code !== 'LOCATION_DENIED') {
        showToast(this.locationProfile.error.message)
        return
      }

      uni.showModal({
        title: '需要位置权限',
        content: '请允许获取当前位置，用于展示附近物品和交易范围校验。',
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

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
}

.app-name {
  display: block;
  color: #17231c;
  font-size: 42rpx;
  font-weight: 800;
  line-height: 1.2;
}

.subline {
  display: block;
  margin-top: 6rpx;
  color: #6e7c73;
  font-size: 24rpx;
}

.publish-button {
  min-width: 112rpx;
  padding: 18rpx 24rpx;
  color: #ffffff;
  background: #1f7a4d;
  border: 0;
  font-size: 26rpx;
  font-weight: 650;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 22rpx;
}

.search-input {
  flex: 1;
  height: 78rpx;
  padding: 0 22rpx;
  color: #17231c;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
  font-size: 26rpx;
}

.search-button {
  min-width: 104rpx;
  height: 78rpx;
  color: #1f7a4d;
  background: #edf6ef;
  border: 1rpx solid #b9dbc4;
  font-size: 26rpx;
}

.category-strip {
  width: 100%;
  margin-top: 22rpx;
  white-space: nowrap;
}

.category-list {
  display: flex;
  gap: 14rpx;
}

.category-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 104rpx;
  height: 58rpx;
  padding: 0 22rpx;
  color: #5f6c64;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  font-size: 24rpx;
}

.category-chip.active {
  color: #ffffff;
  background: #1f7a4d;
  border-color: #1f7a4d;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 30rpx 0 18rpx;
}

.section-title {
  color: #17231c;
  font-size: 32rpx;
  font-weight: 750;
}

.section-count {
  color: #6e7c73;
  font-size: 24rpx;
}

.good-list {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}

.empty-state {
  padding: 70rpx 32rpx;
  text-align: center;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
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
</style>
