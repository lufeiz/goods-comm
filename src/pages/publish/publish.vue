<template>
  <view class="page" data-testid="publish-page">
    <LocationGuard
      :profile="locationProfile"
      :loading="locating"
      @refresh="refreshLocation"
      @open-setting="openSettings"
      @choose-location="chooseLocation"
    />

    <view class="form" data-testid="publish-form">
      <label class="field" data-testid="publish-title-field">
        <text class="label">物品名称</text>
        <input class="input" data-testid="publish-title-input" v-model="form.title" maxlength="28" placeholder="例如：九成新折叠椅" />
      </label>

      <label class="field" data-testid="publish-price-field">
        <text class="label">价格</text>
        <input class="input" data-testid="publish-price-input" v-model="form.price" type="digit" placeholder="填写转让价" />
      </label>

      <view class="field" data-testid="publish-scope-field">
        <text class="label">分类</text>
        <picker :range="publishCategories" range-key="label" :value="categoryIndex" @change="onCategoryChange">
          <view class="picker-value">{{ selectedCategory.label }}</view>
        </picker>
      </view>

      <view class="field">
        <text class="label">成色</text>
        <picker :range="conditions" range-key="label" :value="conditionIndex" @change="onConditionChange">
          <view class="picker-value">{{ selectedCondition.label }}</view>
        </picker>
      </view>

      <view class="field">
        <text class="label">交易范围</text>
        <view class="scope-row">
          <button
            v-for="scope in scopeOptions"
            :key="scope.type"
            :class="['scope-button', form.scopeType === scope.type ? 'active' : '']"
            @tap="setScope(scope.type)"
          >
            {{ scope.label }}
          </button>
        </view>
        <text class="hint">{{ scopeHint }}</text>
      </view>

      <view class="field">
        <text class="label">允许距离 {{ form.radiusMeters }}m</text>
        <slider
          :value="form.radiusMeters"
          min="500"
          max="5000"
          step="100"
          activeColor="#1f7a4d"
          backgroundColor="#dfe6dc"
          @change="onRadiusChange"
          @changing="onRadiusChange"
        />
      </view>

      <label class="field" data-testid="publish-description-field">
        <text class="label">描述</text>
        <textarea
          class="textarea"
          data-testid="publish-description-input"
          v-model="form.description"
          maxlength="160"
          placeholder="说明新旧程度、取货方式、是否可议价"
        />
      </label>

      <view class="field" data-testid="publish-images-field">
        <text class="label">物品照片</text>
        <view class="image-grid">
          <view v-for="(image, index) in form.images" :key="image.url || image" class="image-cell">
            <image class="item-image" :src="image.url || image" mode="aspectFill" />
            <button class="image-remove" @tap="removeImage(index)">删除</button>
          </view>
          <button v-if="form.images.length < 6" class="image-add" data-testid="publish-image-add" @tap="chooseImages">
            添加照片
          </button>
        </view>
        <text class="hint">至少 1 张，最多 6 张；正式上线后应上传到服务端并进入内容审核。</text>
      </view>

      <view class="location-summary" data-testid="publish-location-summary">
        <text class="summary-title">发布位置</text>
        <text class="summary-text">{{ regionLabel }}</text>
      </view>

      <button class="submit-button" data-testid="publish-submit" :disabled="submitting" @tap="submit">
        {{ submitting ? '发布中' : '发布到邻里集市' }}
      </button>
    </view>
  </view>
</template>

<script>
import LocationGuard from '../../components/LocationGuard.vue'
import { DEFAULT_TRADE_SCOPES } from '../../config/app.js'
import { CATEGORIES, CONDITIONS } from '../../data/seed.js'
import { requireStoredAuthUser } from '../../services/auth.js'
import { requireUserAgreement } from '../../services/compliance.js'
import { ITEM_STATUS, submitGoods } from '../../services/goods.js'
import { chooseLocationProfile, getLocationProfile } from '../../services/location.js'
import { uploadItemImages } from '../../services/media.js'
import { openLocationSettings, showToast } from '../../services/platform.js'
import { trackClientEvent } from '../../services/telemetry.js'

export default {
  components: {
    LocationGuard
  },
  data() {
    return {
      publishCategories: CATEGORIES.filter((category) => category.value !== 'all'),
      conditions: CONDITIONS,
      scopeOptions: Object.values(DEFAULT_TRADE_SCOPES),
      categoryIndex: 0,
      conditionIndex: 1,
      locationProfile: null,
      locating: false,
      submitting: false,
      form: {
        title: '',
        price: '',
        scopeType: 'community',
        radiusMeters: DEFAULT_TRADE_SCOPES.community.radiusMeters,
        description: '',
        images: []
      }
    }
  },
  computed: {
    selectedCategory() {
      return this.publishCategories[this.categoryIndex]
    },
    selectedCondition() {
      return this.conditions[this.conditionIndex]
    },
    scopeHint() {
      return this.form.scopeType === 'street'
        ? '适合同街道内可步行或短途骑行交易'
        : '适合同小区、社区服务范围内当面交易'
    },
    regionLabel() {
      const region = this.locationProfile?.region
      const location = this.locationProfile?.location
      const displayName = this.locationProfile?.displayName
      const displayAddress = this.locationProfile?.displayAddress

      if (region?.communityName) {
        return `${region.communityName} · ${region.streetName}`
      }

      if (region?.streetName) {
        return region.streetName
      }

      if (displayName && displayAddress) {
        return `${displayName} · ${displayAddress}`
      }

      if (displayName) {
        return displayName
      }

      if (location?.name) {
        return location.name
      }

      if (location?.address) {
        return location.address
      }

      if (location) {
        return '当前位置已确认'
      }

      return '请先刷新定位'
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
    onCategoryChange(event) {
      this.categoryIndex = Number(event.detail.value)
    },
    onConditionChange(event) {
      this.conditionIndex = Number(event.detail.value)
    },
    setScope(scopeType) {
      this.form.scopeType = scopeType
      this.form.radiusMeters = DEFAULT_TRADE_SCOPES[scopeType].radiusMeters
    },
    onRadiusChange(event) {
      this.form.radiusMeters = Number(event.detail.value)
    },
    chooseImages() {
      if (!uni.chooseImage) {
        showToast('当前平台不支持选择图片')
        return
      }

      uni.chooseImage({
        count: 6 - this.form.images.length,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const files = res.tempFilePaths || []
          this.form.images = [
            ...this.form.images,
            ...files.map((url) => ({
              url,
              status: 'local_pending_upload'
            }))
          ].slice(0, 6)
        },
        fail: () => showToast('未选择图片')
      })
    },
    removeImage(index) {
      this.form.images = this.form.images.filter((_, currentIndex) => currentIndex !== index)
    },
    async submit() {
      if (this.submitting) {
        return
      }

      const activeLocation = this.locationProfile?.location
      const activeRegion = this.locationProfile?.region
      let user

      try {
        user = requireStoredAuthUser('发布物品前需要先登录')
      } catch (error) {
        this.promptLogin(error.message || '发布物品前需要先登录')
        return
      }

      try {
        requireUserAgreement('发布物品前请先阅读并同意用户协议和隐私政策')
      } catch (error) {
        this.promptAgreement(error.message)
        return
      }

      if (!this.form.title.trim()) {
        showToast('请填写物品名称')
        return
      }

      if (!Number(this.form.price) || Number(this.form.price) <= 0) {
        showToast('请填写有效价格')
        return
      }

      if (!activeLocation) {
        showToast('请先授权定位')
        return
      }

      if (!activeRegion?.communityId && this.form.scopeType === 'community') {
        showToast('未能确认所属社区，请重新定位')
        return
      }

      if (!activeRegion?.streetId && this.form.scopeType === 'street') {
        showToast('未能确认所属街道，请重新定位')
        return
      }

      if (!this.form.images.length) {
        showToast('请至少添加 1 张物品照片')
        return
      }

      const scope = {
        ...DEFAULT_TRADE_SCOPES[this.form.scopeType],
        radiusMeters: this.form.radiusMeters
      }

      this.submitting = true
      let publishedItem
      try {
        const images = await uploadItemImages(this.form.images, user)

        publishedItem = await submitGoods({
          title: this.form.title.trim(),
          price: Number(this.form.price),
          category: this.selectedCategory.value,
          condition: this.selectedCondition.value,
          description: this.form.description.trim() || '卖家暂未填写补充说明。',
          images,
          coverTone: this.form.scopeType === 'street' ? 'blue' : 'coral',
          tradeScope: scope,
          location: {
            ...activeLocation,
            communityId: activeRegion?.communityId || '',
            communityName: activeRegion?.communityName || '',
            streetId: activeRegion?.streetId || '',
            streetName: activeRegion?.streetName || '',
            scopeType: this.form.scopeType,
            radiusMeters: this.form.radiusMeters
          }
        }, user)
      } catch (error) {
        trackClientEvent('publish_submit_failed', {
          level: 'error',
          error,
          user,
          context: {
            scopeType: this.form.scopeType,
            imageCount: this.form.images.length,
            category: this.selectedCategory.value
          }
        })
        showToast(error.message || '发布失败')
        this.submitting = false
        return
      }

      this.submitting = false
      this.resetForm()

      if (publishedItem?.status === ITEM_STATUS.PENDING_REVIEW) {
        uni.showModal({
          title: '已提交审核',
          content: '图片或内容仍在审核中，可在“我的发布”查看进度。',
          confirmText: '查看我的',
          success: (res) => {
            if (res.confirm) {
              uni.switchTab({
                url: '/pages/mine/mine'
              })
            }
          }
        })
        return
      }

      showToast('已发布', 'success')
      uni.switchTab({
        url: '/pages/home/home'
      })
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
    resetForm() {
      this.form = {
        title: '',
        price: '',
        scopeType: 'community',
        radiusMeters: DEFAULT_TRADE_SCOPES.community.radiusMeters,
        description: '',
        images: []
      }
      this.categoryIndex = 0
      this.conditionIndex = 1
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
        content: '请允许获取当前位置，发布物品时需要记录交易范围。',
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

.form {
  display: flex;
  flex-direction: column;
  gap: 22rpx;
  margin-top: 24rpx;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.label {
  color: #17231c;
  font-size: 26rpx;
  font-weight: 650;
}

.input,
.picker-value,
.textarea {
  width: 100%;
  color: #17231c;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
  font-size: 28rpx;
}

.input,
.picker-value {
  height: 82rpx;
  padding: 0 22rpx;
  line-height: 82rpx;
}

.textarea {
  min-height: 180rpx;
  padding: 20rpx 22rpx;
  line-height: 1.5;
}

.scope-row {
  display: flex;
  gap: 14rpx;
}

.scope-button {
  flex: 1;
  height: 72rpx;
  color: #5f6c64;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  font-size: 26rpx;
}

.scope-button.active {
  color: #ffffff;
  background: #1f7a4d;
  border-color: #1f7a4d;
}

.hint {
  color: #6e7c73;
  font-size: 24rpx;
  line-height: 1.45;
}

.location-summary {
  padding: 22rpx;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14rpx;
}

.image-cell,
.image-add {
  position: relative;
  width: 100%;
  height: 160rpx;
  overflow: hidden;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.item-image {
  display: block;
  width: 100%;
  height: 100%;
}

.image-remove {
  position: absolute;
  right: 8rpx;
  bottom: 8rpx;
  min-width: 74rpx;
  height: 42rpx;
  padding: 0 12rpx;
  color: #ffffff;
  background: rgba(23, 35, 28, 0.72);
  border: 0;
  font-size: 20rpx;
  line-height: 42rpx;
}

.image-add {
  color: #1f7a4d;
  background: #edf6ef;
  border-style: dashed;
  font-size: 24rpx;
}

.summary-title {
  display: block;
  color: #17231c;
  font-size: 26rpx;
  font-weight: 650;
}

.summary-text {
  display: block;
  margin-top: 8rpx;
  color: #6e7c73;
  font-size: 24rpx;
}

.submit-button {
  height: 88rpx;
  color: #ffffff;
  background: #1f7a4d;
  border: 0;
  font-size: 28rpx;
  font-weight: 700;
}
</style>
