<script setup>
import { ref, onMounted, inject, computed } from 'vue'

const navigate = inject('navigate')

// --- Settings ---
const port = ref(9999)
const autoStart = ref(false)
const logEnabled = ref(false)
const saved = ref(false)

// --- Stats ---
const stats = ref(null)
const logs = ref([])

function loadSettings() {
  const settings = window.services.getSettings()
  port.value = settings.port || 9999
  autoStart.value = settings.autoStart || false
  logEnabled.value = window.services.getLogEnabled()
}

function saveSettings() {
  const portNum = parseInt(port.value, 10)
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) { port.value = 9999; return }
  window.services.setSettings({ port: portNum, autoStart: autoStart.value })
  saved.value = true
  setTimeout(() => saved.value = false, 1500)
}

function toggleLogging() {
  window.services.setLogEnabled(logEnabled.value)
}

function loadStats() {
  stats.value = window.services.getStats()
  logs.value = window.services.getLogs(200)
}

function statusLabel(code) {
  if (code >= 200 && code < 300) return 'success'
  if (code >= 400 && code < 500) return 'warn'
  return 'error'
}

function endpointLabel(ep) {
  const map = {
    '/v1/chat/completions': 'Chat Completions',
    '/v1/responses': 'Responses',
    '/v1/messages': 'Messages',
    '/v1/models': 'Models'
  }
  return map[ep] || ep
}

function timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return sec + 's'
  if (sec < 3600) return Math.floor(sec / 60) + 'm'
  if (sec < 86400) return Math.floor(sec / 3600) + 'h'
  return Math.floor(sec / 86400) + 'd'
}

const maxTrend = computed(() => {
  if (!stats.value || !stats.value.trend.length) return 1
  return Math.max(...stats.value.trend.map(d => d.count), 1)
})

onMounted(() => {
  loadSettings()
  loadStats()
})
</script>

<template>
  <div class="settings">
    <!-- Header -->
    <div class="page-header">
      <button class="back-link" @click="navigate('ai')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        返回
      </button>
      <h2>设置与统计</h2>
    </div>

    <!-- Settings Card -->
    <div class="card">
      <div class="card-header"><h3>代理端口</h3></div>
      <div class="card-body">
        <div class="field-row">
          <input v-model.number="port" type="number" min="1" max="65535" @change="saveSettings" />
          <span class="saved" v-if="saved">&check; 已保存</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <label class="check-field" @change="saveSettings">
          <input type="checkbox" v-model="autoStart" />
          <span>启动 uTools 时自动开启代理</span>
        </label>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <label class="check-field" @change="toggleLogging">
          <input type="checkbox" v-model="logEnabled" />
          <span>记录请求参数与返回参数</span>
        </label>
        <p class="field-hint">开启后会在请求日志中记录请求体和响应体内容（最多 500 字符），代理重载后生效</p>
      </div>
    </div>

    <!-- Stats Section -->
    <template v-if="stats">
      <!-- Overview -->
      <div class="card">
        <div class="card-header">
          <h3>请求统计（近 30 天）</h3>
          <button class="refresh-btn" @click="loadStats">刷新</button>
        </div>
        <div class="card-body">
          <div class="stat-big">{{ stats.totalRequests }}</div>
          <div class="stat-label">总请求数</div>
        </div>
      </div>

      <!-- Per Endpoint -->
      <div class="card" v-if="stats.byEndpoint.length">
        <div class="card-header"><h3>接口调用次数</h3></div>
        <div class="card-body">
          <div class="stat-row" v-for="e in stats.byEndpoint" :key="e.endpoint">
            <span class="stat-name">{{ endpointLabel(e.endpoint) }}</span>
            <span class="stat-val">{{ e.count }}</span>
          </div>
        </div>
      </div>

      <!-- Per Model -->
      <div class="card" v-if="stats.byModel.length">
        <div class="card-header"><h3>模型调用次数</h3></div>
        <div class="card-body">
          <div class="stat-row" v-for="m in stats.byModel" :key="m.model">
            <span class="stat-name">{{ m.model }}</span>
            <span class="stat-val">{{ m.count }}</span>
          </div>
        </div>
      </div>

      <!-- 30-Day Trend -->
      <div class="card" v-if="stats.trend.length">
        <div class="card-header"><h3>30 天调用趋势</h3></div>
        <div class="card-body">
          <div class="trend-chart">
            <div
              v-for="d in stats.trend"
              :key="d.date"
              class="trend-bar"
              :style="{ height: Math.max(4, (d.count / maxTrend) * 80) + 'px' }"
              :title="d.date + ': ' + d.count + ' 次'"
            ></div>
          </div>
          <div class="trend-labels">
            <span>{{ stats.trend[0]?.date?.slice(5) || '' }}</span>
            <span>{{ stats.trend[stats.trend.length-1]?.date?.slice(5) || '' }}</span>
          </div>
        </div>
      </div>

      <!-- Errors -->
      <div class="card" v-if="stats.errors.length">
        <div class="card-header"><h3>异常记录</h3></div>
        <div class="log-list">
          <div class="log-item" v-for="(e, i) in stats.errors" :key="i">
            <div class="log-top">
              <span class="log-badge" :class="statusLabel(e.statusCode)">{{ e.statusCode }}</span>
              <span class="log-ep">{{ endpointLabel(e.endpoint) }}</span>
              <span class="log-time">{{ timeAgo(e.timestamp) }}前</span>
            </div>
            <div class="log-err" v-if="e.error">{{ e.error }}</div>
          </div>
        </div>
      </div>

      <!-- Recent Logs -->
      <div class="card">
        <div class="card-header"><h3>请求日志</h3></div>
        <div class="log-list" v-if="logs.length">
          <div class="log-item" v-for="l in logs" :key="l.timestamp">
            <div class="log-top">
              <span class="log-badge" :class="statusLabel(l.statusCode)">{{ l.statusCode }}</span>
              <span class="log-ep">{{ endpointLabel(l.endpoint) }}</span>
              <span class="log-time">{{ timeAgo(l.timestamp) }}前</span>
            </div>
            <div class="log-meta">
              <span>{{ l.model }}</span>
              <span class="log-dur">{{ l.duration }}ms</span>
            </div>
            <details class="log-detail" v-if="l.requestBody || l.responseBody">
              <summary>查看参数</summary>
              <div class="log-body" v-if="l.requestBody">
                <span class="log-body-label">请求</span>
                <pre>{{ l.requestBody }}</pre>
              </div>
              <div class="log-body" v-if="l.responseBody">
                <span class="log-body-label">响应</span>
                <pre>{{ l.responseBody }}</pre>
              </div>
            </details>
          </div>
        </div>
        <div class="card-empty" v-else>暂无日志记录</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.settings {
  padding: 16px;
  max-width: 540px;
  margin: 0 auto;
  padding-bottom: 40px;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.page-header h2 { font-size: 18px; font-weight: 700; color: #1e293b; margin: 0; }

.back-link {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 10px; border: none; border-radius: 8px;
  background: #f1f5f9; font-size: 13px; color: #64748b;
  cursor: pointer; transition: all .15s;
}
.back-link:hover { background: #e2e8f0; color: #334155; }

/* Card */
.card {
  margin-bottom: 12px;
  border: 1px solid #e2e8f0; border-radius: 14px;
  background: #fff; overflow: hidden;
}
.card-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 16px 0;
}
.card-header h3 {
  font-size: 12px; font-weight: 700; color: #94a3b8;
  text-transform: uppercase; letter-spacing: .6px;
}
.card-body { padding: 12px 16px 16px; }
.card-empty { padding: 20px 16px; text-align: center; color: #cbd5e1; font-size: 13px; }

.field-row { display: flex; align-items: center; gap: 12px; }
.field-row input[type="number"] {
  padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 10px;
  font-size: 15px; font-weight: 500; font-family: 'SF Mono', 'Fira Code', monospace;
  outline: none; width: 130px; transition: all .15s; background: #f8fafc;
}
.field-row input[type="number"]:focus {
  border-color: #a5b4fc; background: #fff;
  box-shadow: 0 0 0 3px rgba(165,180,252,.15);
}
.saved { font-size: 13px; color: #22c55e; font-weight: 500; }

.check-field {
  display: flex; align-items: center; gap: 10px;
  cursor: pointer; font-size: 14px; color: #334155;
}
.check-field input[type="checkbox"] {
  width: 18px; height: 18px; accent-color: #6366f1; cursor: pointer;
}

/* Stats */
.stat-big {
  font-size: 32px; font-weight: 800; color: #1e293b; line-height: 1;
}
.stat-label { font-size: 13px; color: #94a3b8; margin-top: 4px; }

.stat-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0;
}
.stat-row + .stat-row { border-top: 1px solid #f1f5f9; }
.stat-name { font-size: 13px; color: #334155; font-weight: 500; }
.stat-val { font-size: 14px; font-weight: 700; color: #6366f1; font-family: 'SF Mono', monospace; }

/* Trend Chart */
.trend-chart {
  display: flex; align-items: flex-end; gap: 2px; height: 80px;
}
.trend-bar {
  flex: 1; border-radius: 2px 2px 0 0;
  background: #6366f1; opacity: .7; transition: opacity .15s;
  min-width: 3px;
}
.trend-bar:hover { opacity: 1; }
.trend-labels {
  display: flex; justify-content: space-between;
  font-size: 11px; color: #cbd5e1; margin-top: 6px;
}

/* Logs */
.log-list { max-height: 320px; overflow-y: auto; }
.log-item {
  padding: 10px 16px; border-top: 1px solid #f1f5f9;
}
.log-top {
  display: flex; align-items: center; gap: 8px;
}
.log-badge {
  display: inline-block; padding: 1px 6px; border-radius: 4px;
  font-size: 11px; font-weight: 700; font-family: 'SF Mono', monospace;
}
.log-badge.success { background: #dcfce7; color: #16a34a; }
.log-badge.warn { background: #fef9c3; color: #ca8a04; }
.log-badge.error { background: #fee2e2; color: #dc2626; }

.log-ep { font-size: 13px; color: #334155; }
.log-time { font-size: 11px; color: #cbd5e1; margin-left: auto; }
.log-meta {
  display: flex; gap: 12px; margin-top: 3px;
  font-size: 12px; color: #94a3b8;
}
.log-dur { font-family: 'SF Mono', monospace; }
.log-err { font-size: 12px; color: #dc2626; margin-top: 3px; }

.link-btn {
  padding: 0; border: none; background: transparent;
  font-size: 12px; font-weight: 500; color: #6366f1; cursor: pointer;
  transition: color .15s;
}
.link-btn:hover { color: #4f46e5; }

.refresh-btn {
  padding: 3px 8px; border: 1px solid #e2e8f0; border-radius: 6px;
  background: #fff; font-size: 12px; color: #64748b; cursor: pointer;
  transition: all .15s;
}
.refresh-btn:hover { background: #f1f5f9; }

.field-hint {
  font-size: 12px; color: #94a3b8; margin: 6px 0 0;
}

/* Log Detail */
.log-detail {
  margin-top: 6px;
}
.log-detail summary {
  font-size: 12px; color: #6366f1; cursor: pointer; user-select: none;
}
.log-body {
  margin-top: 8px;
}
.log-body-label {
  font-size: 10px; font-weight: 700; color: #94a3b8;
  text-transform: uppercase; letter-spacing: .5px;
}
.log-body pre {
  margin-top: 4px; padding: 8px 10px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 11px; font-family: 'SF Mono', monospace; color: #475569;
  white-space: pre-wrap; word-break: break-all; max-height: 200px;
  overflow-y: auto;
}
</style>
