<template>
  <view class="page">
    <view class="segmented-row">
      <button :class="['segment-button', currentType === 'terms' ? 'selected' : '']" @tap="setType('terms')">
        用户协议
      </button>
      <button :class="['segment-button', currentType === 'privacy' ? 'selected' : '']" @tap="setType('privacy')">
        隐私政策
      </button>
    </view>

    <view class="panel">
      <text class="title">{{ currentDocument.title }}</text>
      <text class="version">版本：{{ agreementVersion }}</text>
      <view class="section-list">
        <view v-for="section in currentDocument.sections" :key="section.title" class="section">
          <text class="section-title">{{ section.title }}</text>
          <text v-for="item in section.items" :key="item" class="section-text">{{ item }}</text>
        </view>
      </view>
    </view>

    <view class="bottom-actions">
      <button class="primary-button" @tap="acceptAndBack">我已阅读并同意</button>
    </view>
  </view>
</template>

<script>
import { USER_AGREEMENT_VERSION, acceptUserAgreement } from '../../services/compliance.js'
import { showToast } from '../../services/platform.js'

const DOCUMENTS = {
  terms: {
    title: '邻里旧货用户协议',
    sections: [
      {
        title: '服务定位',
        items: [
          '本产品用于社区二手物品信息发布、同社区或同街道交易意向记录、站内交易状态协作和运营风控处理。',
          '平台只记录交易意向、状态、举报、审核和必要通知，不提供担保支付、物流履约或线下验货承诺。'
        ]
      },
      {
        title: '用户责任',
        items: [
          '发布物品必须真实、合法、可转让，不得发布违禁、侵权、诈骗、管制或明显不适合线下交易的内容。',
          '线下见面交易应自行确认物品状态、价格、交付方式和人身安全，发现风险应及时取消交易或发起举报。'
        ]
      },
      {
        title: '交易与风控',
        items: [
          '发起交易前系统会使用实时定位和服务端规则校验交易范围；手动选择位置只用于浏览预估。',
          '高风险举报、内容安全拒绝、账号注销或客服裁决可能导致商品下架、交易转争议或交易取消。'
        ]
      },
      {
        title: '账号与数据',
        items: [
          '账号注销后，服务端会吊销当前账号的未过期会话、下架活跃发布、取消活跃交易并保留必要审计记录。',
          '运营人员只能在受控后台处理待审商品、举报、争议和通知异常，关键操作会写入审计记录。'
        ]
      }
    ]
  },
  privacy: {
    title: '邻里旧货隐私政策',
    sections: [
      {
        title: '收集的信息',
        items: [
          '登录时会处理平台登录 code、平台用户标识、昵称和头像，用于建立交易身份和服务端会话。',
          '发布、浏览和发起交易时会处理定位结果、社区或街道归属、距离和定位质量，用于交易范围校验与距离排序。',
          '发布图片、商品描述、交易状态、举报、评价、通知和端侧错误事件会用于交易闭环、内容安全、风控和排障。'
        ]
      },
      {
        title: '使用与最小化',
        items: [
          '公开商品列表和详情只展示社区或街道等必要范围信息，不向普通用户暴露卖家精确经纬度或用户级联系码。',
          '一次性联系码只在卖家确认交易后展示，交易完成、取消或争议后会被清空。',
          '端侧遥测和运营审计会过滤 token、密钥、联系方式、精确地址、经纬度等敏感字段。'
        ]
      },
      {
        title: '保存与同步',
        items: [
          'dev、test、pre、prod 使用独立环境和数据库；prod 数据同步到 pre 时会执行脱敏 SQL，吊销会话并清理联系码和敏感上下文。',
          '账号注销记录、举报处理记录、运营审计和必要交易记录会为合规、安全和纠纷处理保留。'
        ]
      },
      {
        title: '用户权利',
        items: [
          '你可以在“我的”页面退出登录、管理发布、查看规则说明或发起账号注销。',
          '如果认为商品、交易或个人信息处理存在风险，可以通过举报入口提交运营处理。'
        ]
      }
    ]
  }
}

export default {
  data() {
    return {
      currentType: 'terms',
      agreementVersion: USER_AGREEMENT_VERSION
    }
  },
  computed: {
    currentDocument() {
      return DOCUMENTS[this.currentType] || DOCUMENTS.terms
    }
  },
  onLoad(query = {}) {
    this.setType(query.type === 'privacy' ? 'privacy' : 'terms')
  },
  methods: {
    setType(type) {
      this.currentType = type === 'privacy' ? 'privacy' : 'terms'
      uni.setNavigationBarTitle?.({
        title: this.currentDocument.title
      })
    },
    acceptAndBack() {
      acceptUserAgreement({
        source: `legal:${this.currentType}`
      })
      showToast('已同意协议', 'success')

      setTimeout(() => {
        uni.navigateBack({
          delta: 1
        })
      }, 300)
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 28rpx 150rpx;
}

.segmented-row {
  display: flex;
  gap: 12rpx;
  margin-bottom: 20rpx;
}

.segment-button {
  flex: 1;
  height: 72rpx;
  color: #5f6c64;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
  font-size: 26rpx;
}

.segment-button.selected {
  color: #ffffff;
  background: #1f7a4d;
  border-color: #1f7a4d;
}

.panel {
  padding: 26rpx;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.title {
  display: block;
  color: #17231c;
  font-size: 36rpx;
  font-weight: 800;
  line-height: 1.35;
}

.version {
  display: block;
  margin-top: 8rpx;
  color: #6e7c73;
  font-size: 24rpx;
}

.section-list {
  display: flex;
  flex-direction: column;
  gap: 26rpx;
  margin-top: 28rpx;
}

.section-title {
  display: block;
  color: #17231c;
  font-size: 29rpx;
  font-weight: 750;
}

.section-text {
  display: block;
  margin-top: 10rpx;
  color: #5f6c64;
  font-size: 25rpx;
  line-height: 1.6;
}

.bottom-actions {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 18rpx 28rpx 34rpx;
  background: #ffffff;
  border-top: 1rpx solid #dfe6dc;
}

.primary-button {
  width: 100%;
  height: 78rpx;
  color: #ffffff;
  background: #1f7a4d;
  border-color: #1f7a4d;
  font-size: 27rpx;
}
</style>
