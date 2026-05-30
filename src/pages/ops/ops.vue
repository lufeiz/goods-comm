<template>
  <view class="page" data-testid="ops-page">
    <view class="panel" data-testid="ops-auth-panel">
      <view class="panel-head">
        <view>
          <text class="panel-title">运营控制台</text>
          <text class="panel-desc">举报、争议和平台通知处理</text>
        </view>
        <text class="state-pill" data-testid="ops-auth-state" :class="hasAuth ? 'ready' : 'blocked'">{{ hasAuth ? '已登录' : '待登录' }}</text>
      </view>

      <input
        class="secret-input"
        data-testid="ops-actor-input"
        :value="actorDraft"
        placeholder="运营账号 ID"
        @input="onActorInput"
      />
      <input
        class="secret-input"
        data-testid="ops-secret-input"
        password
        :value="secretDraft"
        placeholder="输入运营密钥"
        @input="onSecretInput"
      />

      <view class="button-row">
        <button class="mini-button primary" data-testid="ops-login-submit" @tap="saveSecret">保存</button>
        <button class="mini-button" data-testid="ops-refresh" :disabled="!hasAuth || loading" @tap="refresh">刷新</button>
        <button class="mini-button danger" data-testid="ops-clear-session" @tap="clearSecret">清除</button>
      </view>
      <text v-if="opsSession?.operator?.id" class="case-meta" data-testid="ops-current-operator">当前操作人：{{ opsSession.operator.id }}</text>
    </view>

    <view v-if="queue" class="stats-grid" data-testid="ops-stats-grid">
      <view class="stat-card" data-testid="ops-stat-card" data-stat="pendingItems">
        <text class="stat-value">{{ queue.counts?.pendingItems || 0 }}</text>
        <text class="stat-label">待审商品</text>
      </view>
      <view class="stat-card" data-testid="ops-stat-card" data-stat="pendingReports">
        <text class="stat-value">{{ queue.counts?.pendingReports || 0 }}</text>
        <text class="stat-label">待处理举报</text>
      </view>
      <view class="stat-card" data-testid="ops-stat-card" data-stat="openDisputes">
        <text class="stat-value">{{ queue.counts?.openDisputes || 0 }}</text>
        <text class="stat-label">争议中交易</text>
      </view>
      <view class="stat-card" data-testid="ops-stat-card" data-stat="failedDeliveries">
        <text class="stat-value">{{ queue.counts?.failedDeliveries || 0 }}</text>
        <text class="stat-label">通知异常</text>
      </view>
      <view class="stat-card" data-testid="ops-stat-card" data-stat="clientEvents">
        <text class="stat-value">{{ clientEvents.length }}</text>
        <text class="stat-label">端侧事件</text>
      </view>
      <view class="stat-card" data-testid="ops-stat-card" data-stat="auditEvents">
        <text class="stat-value">{{ auditEvents.length }}</text>
        <text class="stat-label">操作审计</text>
      </view>
    </view>

    <view class="panel" data-testid="ops-user-risk-panel">
      <view class="panel-head">
        <text class="panel-title">用户风控</text>
        <text class="count-text">{{ users.length }}</text>
      </view>
      <input
        class="secret-input"
        data-testid="ops-user-risk-target"
        :value="userRiskTarget"
        placeholder="输入用户 ID"
        @input="onUserRiskTargetInput"
      />
      <textarea
        class="note-input"
        data-testid="ops-user-risk-reason"
        maxlength="300"
        :value="userRiskReason"
        placeholder="封禁 / 解封原因"
        @input="onUserRiskReasonInput"
      />
      <view class="button-row">
        <button class="mini-button danger" data-testid="ops-user-block-submit" :disabled="loading || !userRiskTarget" @tap="updateUserStatus('blocked')">封禁</button>
        <button class="mini-button" data-testid="ops-user-unblock-submit" :disabled="loading || !userRiskTarget" @tap="updateUserStatus('active')">解封</button>
      </view>
      <view class="filter-row">
        <button
          v-for="status in userStatuses"
          :key="status.value"
          :class="['filter-button', userStatus === status.value ? 'selected' : '']"
          data-testid="ops-user-status-filter"
          :data-status="status.value"
          @tap="changeUserStatus(status.value)"
        >
          {{ status.label }}
        </button>
      </view>
      <view v-if="users.length" class="case-list" data-testid="ops-user-list">
        <view v-for="user in users" :key="user.id" class="case-card" data-testid="ops-user-card" :data-user-id="user.id">
          <view class="case-head">
            <text class="case-title">{{ user.nickname || user.id }}</text>
            <text class="case-badge">{{ userStatusText(user.status) }}</text>
          </view>
          <text class="case-meta">用户：{{ user.id }}</text>
          <text class="case-meta">平台：{{ user.provider || '-' }} {{ user.platformId || '' }}</text>
          <text class="case-meta">封禁：{{ user.blockReason || '-' }}</text>
          <text class="case-meta">{{ formatTime(user.blockedAt || user.createdAt) }}</text>
          <view class="button-row">
            <button class="mini-button" data-testid="ops-user-prefill" :data-user-id="user.id" :disabled="loading" @tap="prefillUserRisk(user)">填入</button>
            <button v-if="user.status === 'blocked'" class="mini-button" data-testid="ops-user-list-unblock" :data-user-id="user.id" :disabled="loading" @tap="updateListedUserStatus(user, 'active')">解封</button>
            <button v-else class="mini-button danger" data-testid="ops-user-list-block" :data-user-id="user.id" :disabled="loading" @tap="updateListedUserStatus(user, 'blocked')">封禁</button>
          </view>
        </view>
      </view>
      <text v-else class="empty-text" data-testid="ops-user-empty">暂无匹配用户</text>
    </view>

    <view class="panel" data-testid="ops-items-panel">
      <view class="panel-head">
        <text class="panel-title">待审商品</text>
        <text class="count-text">{{ pendingItems.length }}</text>
      </view>
      <view v-if="pendingItems.length" class="case-list" data-testid="ops-item-list">
        <view v-for="item in pendingItems" :key="item.id" class="case-card" data-testid="ops-item-card" :data-item-id="item.id">
          <view class="case-head">
            <text class="case-title">{{ item.title }}</text>
            <text class="case-badge">{{ itemStatusText(item) }}</text>
          </view>
          <text class="case-meta">发布人：{{ item.seller?.nickname || item.seller?.id || '-' }}</text>
          <text class="case-meta">原因：{{ reasonListText(item.reviewReasons) }}</text>
          <text class="case-meta">{{ formatTime(item.updatedAt || item.createdAt) }}</text>
          <textarea
            class="note-input"
            data-testid="ops-item-note"
            :data-item-id="item.id"
            maxlength="200"
            :value="noteDraft(item.id)"
            placeholder="审核备注"
            @input="updateNote(item.id, $event)"
          />
          <view class="button-row">
            <button class="mini-button primary" data-testid="ops-item-approve" :data-item-id="item.id" :disabled="loading" @tap="reviewItem(item, 'approved')">通过</button>
            <button class="mini-button danger" data-testid="ops-item-reject" :data-item-id="item.id" :disabled="loading" @tap="reviewItem(item, 'rejected')">拒绝</button>
          </view>
        </view>
      </view>
      <text v-else class="empty-text" data-testid="ops-item-empty">暂无待审商品</text>
    </view>

    <view class="panel" data-testid="ops-reports-panel">
      <view class="panel-head">
        <text class="panel-title">举报队列</text>
        <text class="count-text">{{ reports.length }}</text>
      </view>
      <view v-if="reports.length" class="case-list" data-testid="ops-report-list">
        <view v-for="report in reports" :key="report.id" class="case-card" data-testid="ops-report-card" :data-report-id="report.id">
          <view class="case-head">
            <text class="case-title">{{ report.targetItem?.title || report.targetId }}</text>
            <text class="case-badge">{{ reportReasonText(report.reason) }}</text>
          </view>
          <text class="case-meta">举报人：{{ report.reporter?.nickname || report.reporter?.id || '-' }}</text>
          <text class="case-meta">说明：{{ report.description || '-' }}</text>
          <text class="case-meta">{{ formatTime(report.createdAt) }}</text>
          <textarea
            class="note-input"
            data-testid="ops-report-note"
            :data-report-id="report.id"
            maxlength="300"
            :value="noteDraft(report.id)"
            placeholder="处理备注"
            @input="updateNote(report.id, $event)"
          />
          <view class="button-row">
            <button class="mini-button" data-testid="ops-report-dismiss" :data-report-id="report.id" :disabled="loading" @tap="resolveReport(report, 'dismiss_report')">驳回</button>
            <button class="mini-button danger" data-testid="ops-report-uphold" :data-report-id="report.id" :disabled="loading" @tap="resolveReport(report, 'uphold_report')">确认违规</button>
            <button class="mini-button danger" data-testid="ops-report-block-reporter" :data-report-id="report.id" :disabled="loading || !report.reporter?.id" @tap="blockReporter(report)">封禁举报人</button>
          </view>
        </view>
      </view>
      <text v-else class="empty-text" data-testid="ops-report-empty">暂无待处理举报</text>
    </view>

    <view class="panel" data-testid="ops-disputes-panel">
      <view class="panel-head">
        <text class="panel-title">争议处理</text>
        <text class="count-text">{{ disputes.length }}</text>
      </view>
      <view v-if="disputes.length" class="case-list" data-testid="ops-dispute-list">
        <view v-for="dispute in disputes" :key="dispute.id" class="case-card" data-testid="ops-dispute-card" :data-dispute-id="dispute.id">
          <view class="case-head">
            <text class="case-title">{{ dispute.itemTitle || dispute.tradeId }}</text>
            <text class="case-badge">{{ disputeSourceText(dispute.source) }}</text>
          </view>
          <text class="case-meta">发起人：{{ dispute.opener?.nickname || dispute.opener?.id || '-' }}</text>
          <text class="case-meta">原因：{{ dispute.reason || '-' }}</text>
          <text class="case-meta">{{ dispute.description || '-' }}</text>
          <view class="segmented-row">
            <button
              v-for="resolution in disputeResolutions"
              :key="dispute.id + '-' + resolution.value"
              :class="['segment-button', disputeResolutionDraft(dispute.id) === resolution.value ? 'selected' : '']"
              data-testid="ops-dispute-resolution"
              :data-dispute-id="dispute.id"
              :data-resolution="resolution.value"
              @tap="setDisputeResolution(dispute.id, resolution.value)"
            >
              {{ resolution.label }}
            </button>
          </view>
          <textarea
            class="note-input"
            data-testid="ops-dispute-note"
            :data-dispute-id="dispute.id"
            maxlength="300"
            :value="noteDraft(dispute.id)"
            placeholder="争议处理备注"
            @input="updateNote(dispute.id, $event)"
          />
          <button class="full-button primary" data-testid="ops-dispute-submit" :data-dispute-id="dispute.id" :disabled="loading" @tap="resolveDispute(dispute)">提交处理</button>
        </view>
      </view>
      <text v-else class="empty-text" data-testid="ops-dispute-empty">暂无争议交易</text>
    </view>

    <view class="panel" data-testid="ops-deliveries-panel">
      <view class="panel-head">
        <text class="panel-title">通知投递</text>
        <text class="count-text">{{ notificationDeliveries.length }}</text>
      </view>
      <view class="filter-row">
        <button
          v-for="status in deliveryStatuses"
          :key="status.value"
          :class="['filter-button', deliveryStatus === status.value ? 'selected' : '']"
          data-testid="ops-delivery-status-filter"
          :data-status="status.value"
          @tap="changeDeliveryStatus(status.value)"
        >
          {{ status.label }}
        </button>
      </view>
      <button class="full-button" data-testid="ops-delivery-retry-due" :disabled="!hasAuth || loading" @tap="retryDueDeliveries">重试到期异常</button>
      <view v-if="notificationDeliveries.length" class="case-list" data-testid="ops-delivery-list">
        <view v-for="delivery in notificationDeliveries" :key="delivery.id" class="case-card" data-testid="ops-delivery-card" :data-delivery-id="delivery.id">
          <view class="case-head">
            <text class="case-title">{{ delivery.type || delivery.notificationId }}</text>
            <text class="case-badge">{{ deliveryStatusText(delivery.status) }}</text>
          </view>
          <text class="case-meta">用户：{{ delivery.userId || '-' }}</text>
          <text class="case-meta">目标：{{ delivery.targetType || '-' }} / {{ delivery.targetId || '-' }}</text>
          <text class="case-meta">次数：{{ delivery.attemptCount || 0 }} · {{ delivery.message || '-' }}</text>
          <button class="full-button primary" data-testid="ops-delivery-retry-one" :data-delivery-id="delivery.id" :disabled="loading" @tap="retryDelivery(delivery)">立即重试</button>
        </view>
      </view>
      <text v-else class="empty-text" data-testid="ops-delivery-empty">暂无通知投递记录</text>
    </view>

    <view class="panel" data-testid="ops-client-events-panel">
      <view class="panel-head">
        <text class="panel-title">端侧事件</text>
        <text class="count-text">{{ clientEvents.length }}</text>
      </view>
      <view class="filter-row">
        <button
          v-for="level in eventLevels"
          :key="level.value"
          :class="['filter-button', eventLevel === level.value ? 'selected' : '']"
          data-testid="ops-event-level-filter"
          :data-level="level.value"
          @tap="changeEventLevel(level.value)"
        >
          {{ level.label }}
        </button>
      </view>
      <view v-if="clientEvents.length" class="case-list" data-testid="ops-client-event-list">
        <view v-for="event in clientEvents" :key="event.id" class="case-card" data-testid="ops-client-event-card" :data-event-id="event.id" :data-level="event.level">
          <view class="case-head">
            <text class="case-title">{{ event.type }}</text>
            <text class="case-badge">{{ event.level }}</text>
          </view>
          <text class="case-meta">页面：{{ event.route || '-' }}</text>
          <text class="case-meta">用户：{{ event.userId || '-' }}</text>
          <text class="case-meta">信息：{{ event.message || event.code || '-' }}</text>
          <text class="case-meta">{{ formatTime(event.createdAt) }}</text>
        </view>
      </view>
      <text v-else class="empty-text" data-testid="ops-client-event-empty">暂无端侧事件</text>
    </view>

    <view class="panel" data-testid="ops-audit-panel">
      <view class="panel-head">
        <text class="panel-title">操作审计</text>
        <text class="count-text">{{ auditEvents.length }}</text>
      </view>
      <view v-if="auditEvents.length" class="case-list" data-testid="ops-audit-list">
        <view v-for="event in auditEvents" :key="event.id" class="case-card" data-testid="ops-audit-card" :data-audit-id="event.id" :data-action="event.action">
          <view class="case-head">
            <text class="case-title">{{ auditActionText(event.action) }}</text>
            <text class="case-badge">{{ event.result || 'success' }}</text>
          </view>
          <text class="case-meta">操作人：{{ event.actorId || '-' }}</text>
          <text class="case-meta">目标：{{ event.targetType || '-' }} / {{ event.targetId || '-' }}</text>
          <text class="case-meta">{{ formatTime(event.createdAt) }}</text>
        </view>
      </view>
      <text v-else class="empty-text" data-testid="ops-audit-empty">暂无操作审计</text>
    </view>
  </view>
</template>

<script>
import {
  OPS_DISPUTE_RESOLUTIONS,
  clearStoredOpsSecret,
  clearStoredOpsSession,
  fetchClientEvents,
  fetchNotificationDeliveries,
  fetchOpsAuditEvents,
  fetchOpsModerationQueue,
  fetchOpsUsers,
  getStoredOpsSecret,
  getStoredOpsSession,
  loginOpsSession,
  retryNotificationDeliveries,
  resolveOpsDispute,
  resolveOpsReport,
  reviewOpsItem,
  setStoredOpsSecret,
  updateOpsUserStatus
} from '../../services/ops.js'
import { showToast } from '../../services/platform.js'

export default {
  data() {
    const secret = getStoredOpsSecret()
    const opsSession = getStoredOpsSession()

    return {
      secret,
      secretDraft: secret,
      actorDraft: opsSession?.operator?.id || 'ops-console',
      opsSession,
      loading: false,
      queue: null,
      pendingItems: [],
      reports: [],
      disputes: [],
      notificationDeliveries: [],
      users: [],
      clientEvents: [],
      auditEvents: [],
      noteDrafts: {},
      disputeResolutionDrafts: {},
      userRiskTarget: '',
      userRiskReason: '',
      userStatus: 'blocked',
      userStatuses: [
        {
          value: 'blocked',
          label: '封禁'
        },
        {
          value: 'active',
          label: '正常'
        },
        {
          value: '',
          label: '全部'
        }
      ],
      disputeResolutions: OPS_DISPUTE_RESOLUTIONS,
      deliveryStatus: 'failed',
      deliveryStatuses: [
        {
          value: 'failed',
          label: '失败'
        },
        {
          value: 'pending',
          label: '待发送'
        },
        {
          value: '',
          label: '全部'
        }
      ],
      eventLevel: 'error',
      eventLevels: [
        {
          value: 'error',
          label: '错误'
        },
        {
          value: 'warn',
          label: '警告'
        },
        {
          value: '',
          label: '全部'
        }
      ]
    }
  },
  computed: {
    hasSecret() {
      return Boolean(this.secret)
    },
    hasAuth() {
      return Boolean(this.secret || this.opsSession?.token)
    }
  },
  onShow() {
    this.secret = getStoredOpsSecret()
    this.secretDraft = this.secret
    this.opsSession = getStoredOpsSession()
    this.actorDraft = this.opsSession?.operator?.id || this.actorDraft || 'ops-console'

    if (this.hasAuth) {
      this.refresh()
    }
  },
  methods: {
    onActorInput(event) {
      this.actorDraft = event.detail?.value || ''
    },
    onSecretInput(event) {
      this.secretDraft = event.detail?.value || ''
    },
    async saveSecret() {
      try {
        this.opsSession = await loginOpsSession({
          accountId: this.actorDraft || 'ops-console',
          password: this.secretDraft,
          secret: this.secretDraft
        })
        this.secret = setStoredOpsSecret(this.secretDraft)

        showToast('运营会话已建立', 'success')
        this.refresh()
      } catch (error) {
        this.secret = ''
        this.opsSession = null
        showToast(error.message || '运营登录失败')
      }
    },
    clearSecret() {
      clearStoredOpsSecret()
      clearStoredOpsSession()
      this.secret = ''
      this.secretDraft = ''
      this.opsSession = null
      this.queue = null
      this.pendingItems = []
      this.reports = []
      this.disputes = []
      this.notificationDeliveries = []
      this.users = []
      this.clientEvents = []
      this.auditEvents = []
      showToast('密钥已清除')
    },
    async refresh() {
      if (!this.hasAuth) {
        showToast('请先登录运营控制台')
        return
      }

      this.loading = true
      let primaryError = ''
      let moderationQueue = null
      try {
        try {
          moderationQueue = await fetchOpsModerationQueue(this.secret, {
            limit: 50
          })
          this.queue = moderationQueue
          this.pendingItems = Array.isArray(moderationQueue.pendingItems) ? moderationQueue.pendingItems : []
          this.reports = Array.isArray(moderationQueue.reports) ? moderationQueue.reports : []
          this.disputes = Array.isArray(moderationQueue.disputes) ? moderationQueue.disputes : []
        } catch (error) {
          primaryError = error.message || '运营队列加载失败'
          this.queue = null
          this.pendingItems = []
          this.reports = []
          this.disputes = []
        }

        try {
          const deliveries = await fetchNotificationDeliveries(this.secret, {
            status: this.deliveryStatus,
            limit: 50
          })
          this.notificationDeliveries = Array.isArray(deliveries.deliveries) ? deliveries.deliveries : []
        } catch (error) {
          this.notificationDeliveries = Array.isArray(moderationQueue?.notificationDeliveries)
            ? moderationQueue.notificationDeliveries
            : []
        }

        try {
          const users = await fetchOpsUsers(this.secret, {
            status: this.userStatus,
            limit: 50
          })
          this.users = Array.isArray(users.users) ? users.users : []
        } catch (error) {
          this.users = []
        }

        try {
          const events = await fetchClientEvents(this.secret, {
            level: this.eventLevel,
            limit: 50
          })
          this.clientEvents = Array.isArray(events.events) ? events.events : []
        } catch (error) {
          this.clientEvents = []
        }

        try {
          const audits = await fetchOpsAuditEvents(this.secret, {
            limit: 50
          })
          this.auditEvents = Array.isArray(audits.events) ? audits.events : []
        } catch (error) {
          this.auditEvents = []
        }

        if (primaryError && !this.clientEvents.length && !this.auditEvents.length) {
          showToast(primaryError)
        }
      } catch (error) {
        showToast(error.message || '运营队列加载失败')
      } finally {
        this.loading = false
      }
    },
    async reviewItem(item, status) {
      const confirmed = await this.confirmAction(status === 'approved' ? '确认通过审核？' : '确认拒绝该商品？')

      if (!confirmed) {
        return
      }

      await this.runAction(async () => {
        await reviewOpsItem(item.id, {
          status,
          actorId: this.currentActorId(),
          note: this.noteDraft(item.id),
          reasons: status === 'rejected' ? ['manual_reject'] : []
        }, this.secret)
        showToast('商品审核已处理', 'success')
      })
    },
    async resolveReport(report, resolution) {
      const confirmed = await this.confirmAction(resolution === 'uphold_report' ? '确认举报成立？' : '确认驳回举报？')

      if (!confirmed) {
        return
      }

      await this.runAction(async () => {
        await resolveOpsReport(report.id, {
          resolution,
          actorId: this.currentActorId(),
          note: this.noteDraft(report.id),
          reasons: resolution === 'uphold_report' ? [`report:${report.reason}`] : []
        }, this.secret)
        showToast('举报已处理', 'success')
      })
    },
    async resolveDispute(dispute) {
      const resolution = this.disputeResolutionDraft(dispute.id)
      const confirmed = await this.confirmAction('确认提交争议处理？')

      if (!confirmed) {
        return
      }

      await this.runAction(async () => {
        await resolveOpsDispute(dispute.id, {
          resolution,
          actorId: this.currentActorId(),
          note: this.noteDraft(dispute.id)
        }, this.secret)
        showToast('争议已处理', 'success')
      })
    },
    async retryDelivery(delivery) {
      await this.runAction(async () => {
        await retryNotificationDeliveries(this.secret, {
          ids: [delivery.id],
          force: true,
          limit: 1
        })
        showToast('已触发重试', 'success')
      })
    },
    async retryDueDeliveries() {
      await this.runAction(async () => {
        await retryNotificationDeliveries(this.secret, {
          force: false,
          limit: 20
        })
        showToast('已重试到期任务', 'success')
      })
    },
    async updateUserStatus(status) {
      await this.updateUserRiskStatus(this.userRiskTarget, status, this.userRiskReason)
    },
    async updateListedUserStatus(user, status) {
      const reason = this.userRiskReason || (status === 'blocked' ? '运营风控封禁' : '运营风控解封')
      await this.updateUserRiskStatus(user.id, status, reason)
    },
    async updateUserRiskStatus(userId, status, reason) {
      const confirmed = await this.confirmAction(status === 'blocked' ? '确认封禁该用户？' : '确认解封该用户？')

      if (!confirmed) {
        return
      }

      await this.runAction(async () => {
        await updateOpsUserStatus(userId, {
          status,
          actorId: this.currentActorId(),
          reason
        }, this.secret)
        showToast(status === 'blocked' ? '用户已封禁' : '用户已解封', 'success')
      })
    },
    blockReporter(report) {
      this.userRiskTarget = report.reporter?.id || ''
      this.userRiskReason = `举报风控复核：${report.reason || 'report'}`
      this.updateUserStatus('blocked')
    },
    async runAction(action) {
      if (!this.hasAuth || this.loading) {
        return
      }

      this.loading = true
      try {
        await action()
        await this.refresh()
      } catch (error) {
        showToast(error.message || '操作失败')
      } finally {
        this.loading = false
      }
    },
    confirmAction(content) {
      return new Promise((resolve) => {
        uni.showModal({
          title: '确认操作',
          content,
          confirmText: '确认',
          cancelText: '取消',
          confirmColor: '#1f7a4d',
          success: (res) => resolve(Boolean(res.confirm)),
          fail: () => resolve(false)
        })
      })
    },
    changeDeliveryStatus(status) {
      this.deliveryStatus = status
      this.refresh()
    },
    changeEventLevel(level) {
      this.eventLevel = level
      this.refresh()
    },
    changeUserStatus(status) {
      this.userStatus = status
      this.refresh()
    },
    onUserRiskTargetInput(event) {
      this.userRiskTarget = event.detail?.value || ''
    },
    onUserRiskReasonInput(event) {
      this.userRiskReason = event.detail?.value || ''
    },
    prefillUserRisk(user) {
      this.userRiskTarget = user.id || ''
      this.userRiskReason = user.blockReason || ''
    },
    noteDraft(id) {
      return this.noteDrafts[id] || ''
    },
    currentActorId() {
      return this.opsSession?.operator?.id || this.actorDraft || 'ops-console'
    },
    updateNote(id, event) {
      this.noteDrafts = {
        ...this.noteDrafts,
        [id]: event.detail?.value || ''
      }
    },
    disputeResolutionDraft(id) {
      return this.disputeResolutionDrafts[id] || 'release_item'
    },
    setDisputeResolution(id, resolution) {
      this.disputeResolutionDrafts = {
        ...this.disputeResolutionDrafts,
        [id]: resolution
      }
    },
    itemStatusText(item) {
      return item.reviewStatus || item.status || 'pending'
    },
    reportReasonText(reason) {
      const map = {
        prohibited: '违禁',
        fraud: '诈骗',
        privacy: '隐私',
        other: '其他'
      }

      return map[reason] || reason || '举报'
    },
    disputeSourceText(source) {
      const map = {
        user: '用户争议',
        report: '举报触发',
        moderation: '审核触发'
      }

      return map[source] || source || '争议'
    },
    deliveryStatusText(status) {
      const map = {
        pending: '待发送',
        sent: '已发送',
        failed: '失败'
      }

      return map[status] || status || '-'
    },
    auditActionText(action) {
      const map = {
        'ops.login': '运营登录',
        'ops.report.resolve': '举报处理',
        'ops.item.review': '商品审核',
        'ops.media.review': '图片审核',
        'ops.dispute.resolve': '争议处理',
        'ops.notification.retry': '通知重试',
        'ops.user.status': '用户风控'
      }

      return map[action] || action || '操作'
    },
    userStatusText(status) {
      const map = {
        active: '正常',
        blocked: '封禁',
        deleted: '注销'
      }

      return map[status] || status || '-'
    },
    reasonListText(reasons = []) {
      return Array.isArray(reasons) && reasons.length ? reasons.join('、') : '-'
    },
    formatTime(timestamp) {
      if (!timestamp) {
        return '-'
      }

      const date = new Date(timestamp)
      const month = `${date.getMonth() + 1}`.padStart(2, '0')
      const day = `${date.getDate()}`.padStart(2, '0')
      const hour = `${date.getHours()}`.padStart(2, '0')
      const minute = `${date.getMinutes()}`.padStart(2, '0')

      return `${month}-${day} ${hour}:${minute}`
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 28rpx 48rpx;
}

.panel {
  margin-bottom: 20rpx;
  padding: 24rpx;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.panel-head,
.case-head,
.button-row,
.filter-row,
.segmented-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.panel-head,
.case-head {
  justify-content: space-between;
}

.panel-title {
  display: block;
  color: #17231c;
  font-size: 32rpx;
  font-weight: 800;
}

.panel-desc,
.case-meta,
.empty-text,
.count-text {
  display: block;
  color: #5f6c64;
  font-size: 24rpx;
  line-height: 1.5;
}

.state-pill,
.case-badge {
  flex-shrink: 0;
  padding: 8rpx 12rpx;
  border-radius: 8rpx;
  font-size: 22rpx;
  font-weight: 700;
}

.state-pill.ready,
.case-badge {
  color: #1f7a4d;
  background: #edf6ef;
}

.state-pill.blocked {
  color: #8a3c21;
  background: #fff3ea;
}

.secret-input,
.note-input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 18rpx;
  padding: 18rpx;
  color: #17231c;
  background: #f8faf7;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
  font-size: 26rpx;
}

.note-input {
  min-height: 120rpx;
  line-height: 1.5;
}

.button-row {
  margin-top: 18rpx;
}

.mini-button,
.filter-button,
.segment-button,
.full-button {
  min-height: 68rpx;
  color: #5f6c64;
  background: #f8faf7;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
  font-size: 24rpx;
}

.mini-button {
  flex: 1;
}

.primary,
.filter-button.selected,
.segment-button.selected {
  color: #ffffff;
  background: #1f7a4d;
  border-color: #1f7a4d;
}

.danger {
  color: #8a3c21;
  background: #fff3ea;
  border-color: #e8c1aa;
}

.full-button {
  width: 100%;
  margin-top: 18rpx;
}

.stats-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-bottom: 20rpx;
}

.stat-card {
  flex: 1 0 260rpx;
  padding: 22rpx;
  background: #ffffff;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.stat-value {
  display: block;
  color: #17231c;
  font-size: 38rpx;
  font-weight: 800;
}

.stat-label {
  display: block;
  margin-top: 4rpx;
  color: #5f6c64;
  font-size: 23rpx;
}

.case-list {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  margin-top: 18rpx;
}

.case-card {
  padding: 20rpx;
  background: #f8faf7;
  border: 1rpx solid #dfe6dc;
  border-radius: 8rpx;
}

.case-title {
  flex: 1;
  color: #17231c;
  font-size: 28rpx;
  font-weight: 750;
  line-height: 1.35;
}

.filter-row,
.segmented-row {
  flex-wrap: wrap;
  margin-top: 18rpx;
}

.filter-button,
.segment-button {
  min-width: 150rpx;
}

.empty-text {
  margin-top: 18rpx;
}
</style>
