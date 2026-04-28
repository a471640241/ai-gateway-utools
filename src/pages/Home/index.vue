<script setup>
import { ref, onMounted, computed, inject } from 'vue'

const navigate = inject('navigate')

const proxyStatus = ref('stopped')
const proxyPort = ref(9999)
const profiles = ref([])
const activeProfileId = ref(null)
const models = ref([])
const newModelId = ref('')
const toast = ref('')

const proxyUrl = computed(() => `http://127.0.0.1:${proxyPort.value}`)

function maskApiKey(key) {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '***' + key.slice(-4)
}

function loadData() {
  profiles.value = window.services.getProfiles()
  const active = window.services.getActiveProfile()
  activeProfileId.value = active ? active.id : null
  const status = window.services.getProxyStatus()
  proxyStatus.value = status.status
  proxyPort.value = status.port
  models.value = window.services.getModels()
}

async function toggleProxy() {
  if (proxyStatus.value === 'running') {
    await window.services.stopProxy()
  } else {
    try { await window.services.startProxy() } catch (e) {
      showToast('启动失败: ' + e.message)
      return
    }
  }
  loadData()
}

function selectProfile(id) {
  window.services.setActiveProfile(id)
  loadData()
}

function copyUrl() {
  const el = document.createElement('textarea')
  el.value = proxyUrl.value
  el.style.position = 'fixed'; el.style.left = '-9999px'
  document.body.appendChild(el)
  el.select(); document.execCommand('copy')
  document.body.removeChild(el)
  showToast('已复制代理地址')
}

function copyProfile(p) {
  window.services.addProfile({
    name: `${p.name} (副本)`,
    providerType: p.providerType,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    defaultModel: p.defaultModel
  })
  loadData()
  showToast(`已复制「${p.name}」`)
}

function confirmDelete(id) {
  if (window.confirm('确定要删除该提供商吗？')) {
    window.services.deleteProfile(id)
    loadData()
  }
}

function addModel() {
  const id = newModelId.value.trim()
  if (!id || models.value.includes(id)) return
  models.value = window.services.addModel(id)
  newModelId.value = ''
}

function removeModel(id) {
  models.value = window.services.removeModel(id)
}

function providerLabel(type) {
  const map = { 'openai-chat': 'Chat', 'openai-response': 'Response', 'anthropic-message': 'Anthropic' }
  return map[type] || type
}

function providerColor(type) {
  const map = { 'openai-chat': '#10b981', 'openai-response': '#f59e0b', 'anthropic-message': '#8b5cf6' }
  return map[type] || '#6b7280'
}

let toastTimer = 0
function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2200)
}

onMounted(loadData)
</script>

<template>
  <div class="home">
    <!-- Toast -->
    <Transition name="fade">
      <div class="toast" v-if="toast">{{ toast }}</div>
    </Transition>

    <!-- Header Card -->
    <div class="header-card" :class="{ running: proxyStatus === 'running' }">
      <div class="hc-left">
        <span class="status-dot"></span>
        <div class="hc-info">
          <span class="hc-label">{{ proxyStatus === 'running' ? '代理运行中' : '代理已停止' }}</span>
          <span class="hc-addr" @click="copyUrl" title="点击复制">{{ proxyUrl }}</span>
        </div>
      </div>
      <div class="hc-right">
        <button class="hc-btn-toggle" @click="toggleProxy">
          {{ proxyStatus === 'running' ? '停止' : '启动' }}
        </button>
        <button class="hc-btn-copy" @click="copyUrl" title="复制地址">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="hc-btn-settings" @click="navigate('ai-set')" title="设置">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </div>

    <!-- 提供商 -->
    <div class="card">
      <div class="card-header">
        <h3>提供商</h3>
        <button class="link-btn" @click="navigate('ai-add')">+ 添加</button>
      </div>
      <div class="card-body" v-if="profiles.length > 0">
        <div
          v-for="p in profiles"
          :key="p.id"
          class="provider-row"
          :class="{ active: p.id === activeProfileId }"
        >
          <div class="pr-left" @click="selectProfile(p.id)">
            <span class="pr-radio" :class="{ on: p.id === activeProfileId }"></span>
            <div class="pr-info">
              <span class="pr-name">{{ p.name }}</span>
              <span class="pr-meta">
                <span class="pr-tag" :style="{ background: providerColor(p.providerType) + '18', color: providerColor(p.providerType) }">
                  {{ providerLabel(p.providerType) }}
                </span>
                <span class="pr-key">{{ maskApiKey(p.apiKey) }}</span>
              </span>
            </div>
          </div>
          <div class="pr-actions">
            <button class="act-btn" @click="copyProfile(p)">复制</button>
            <button class="act-btn" @click="navigate('ai-add', { editId: p.id })">编辑</button>
            <button class="act-btn danger" @click="confirmDelete(p.id)">删除</button>
          </div>
        </div>
      </div>
      <div class="card-empty" v-else>
        尚未添加提供商，点击「+ 添加」开始配置
      </div>
    </div>

    <!-- 全局模型 -->
    <div class="card">
      <div class="card-header">
        <h3>全局模型
          <span class="tip-icon">
            ?
            <span class="tip-pop">此处添加的模型 ID 仅用于 <code>/v1/models</code> 接口返回，客户端通过该接口获取可用模型列表</span>
          </span>
        </h3>
      </div>
      <div class="card-body">
        <div class="model-chips" v-if="models.length > 0">
          <span v-for="m in models" :key="m" class="chip">
            {{ m }}
            <button class="chip-x" @click="removeModel(m)">&times;</button>
          </span>
        </div>
        <input
          class="model-input"
          v-model="newModelId"
          type="text"
          placeholder="输入模型 ID，回车添加"
          @keyup.enter="addModel"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== Page ===== */
.home {
  padding: 16px;
  max-width: 540px;
  margin: 0 auto;
  min-height: 100vh;
  position: relative;
}

/* ===== Toast ===== */
.toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 24px;
  background: #1e293b;
  color: #f1f5f9;
  font-size: 13px;
  font-weight: 500;
  border-radius: 10px;
  z-index: 999;
  box-shadow: 0 8px 24px rgba(0,0,0,.18);
  pointer-events: none;
}
.fade-enter-active { transition: all .2s ease-out; }
.fade-leave-active { transition: all .18s ease-in; }
.fade-enter-from,
.fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(-6px); }

/* ===== Header Card ===== */
.header-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: 14px;
  margin-bottom: 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  gap: 12px;
}
.header-card.running {
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.hc-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #cbd5e1;
  transition: all .3s;
}
.running .status-dot {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34,197,94,.2);
}

.hc-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.hc-label {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}
.running .hc-label { color: #166534; }

.hc-addr {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 11.5px;
  color: #94a3b8;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color .15s;
  user-select: all;
}
.hc-addr:hover { color: #64748b; }

.hc-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.hc-btn-toggle {
  padding: 6px 16px;
  border: none;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
  background: #334155;
  color: #f1f5f9;
}
.hc-btn-toggle:hover { background: #1e293b; }
.running .hc-btn-toggle {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}
.running .hc-btn-toggle:hover {
  background: #fee2e2;
}

.hc-btn-copy,
.hc-btn-settings {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  transition: all .15s;
}
.hc-btn-copy:hover,
.hc-btn-settings:hover {
  background: #e2e8f0;
  color: #475569;
}

/* ===== Card ===== */
.card {
  margin-bottom: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px 0;
}

.card-header h3 {
  font-size: 12px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: .6px;
}

.card-body {
  padding: 12px 16px 16px;
}

.card-empty {
  padding: 32px 16px;
  text-align: center;
  color: #cbd5e1;
  font-size: 13px;
}

.link-btn {
  padding: 0;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: #6366f1;
  cursor: pointer;
  transition: color .15s;
}
.link-btn:hover { color: #4f46e5; }

/* ===== Provider Row ===== */
.provider-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-radius: 10px;
  transition: all .15s;
  border: 1px solid transparent;
}
.provider-row + .provider-row { margin-top: 4px; }
.provider-row:hover { background: #f8fafc; }
.provider-row.active {
  background: #eef2ff;
  border-color: #c7d2fe;
}

.pr-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.pr-radio {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #d1d5db;
  flex-shrink: 0;
  transition: all .2s;
}
.pr-radio.on {
  border-color: #6366f1;
  border-width: 5px;
  box-shadow: 0 0 0 2px rgba(99,102,241,.15);
}

.pr-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.pr-name {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pr-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pr-tag {
  font-size: 10.5px;
  padding: 1.5px 7px;
  border-radius: 5px;
  font-weight: 600;
  letter-spacing: .2px;
}

.pr-key {
  font-size: 11px;
  color: #cbd5e1;
  font-family: 'SF Mono', monospace;
}

.pr-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 10px;
}

.act-btn {
  padding: 4px 9px;
  border: none;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all .12s;
  background: #f1f5f9;
  color: #475569;
}
.act-btn:hover { background: #e2e8f0; }
.act-btn.danger { color: #ef4444; }
.act-btn.danger:hover { background: #fef2f2; }

/* ===== Model Section ===== */
.model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: #f1f5f9;
  border-radius: 8px;
  font-size: 12.5px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #334155;
  border: 1px solid #e2e8f0;
}

.chip-x {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #94a3b8;
  font-size: 14px;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  transition: all .12s;
}
.chip-x:hover { background: #fee2e2; color: #ef4444; }

.model-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 13px;
  outline: none;
  background: #f8fafc;
  transition: all .15s;
  color: #334155;
}
.model-input:focus {
  border-color: #a5b4fc;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(165,180,252,.15);
}
.model-input::placeholder { color: #cbd5e1; }

/* ===== Tip Icon ===== */
.tip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1px solid #cbd5e1;
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  cursor: help;
  vertical-align: middle;
  text-transform: none;
  letter-spacing: 0;
  position: relative;
}
.tip-icon:hover { background: #e2e8f0; color: #64748b; }

.tip-pop {
  display: none;
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 260px;
  padding: 10px 13px;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
  border-radius: 10px;
  white-space: normal;
  z-index: 100;
  pointer-events: none;
  text-transform: none;
  letter-spacing: 0;
}
.tip-pop::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -5px;
  border: 5px solid transparent;
  border-top-color: #1e293b;
}
.tip-pop code {
  font-family: monospace;
  background: rgba(255,255,255,.12);
  padding: 1px 5px;
  border-radius: 4px;
  color: #fbbf24;
}
.tip-icon:hover .tip-pop { display: block; }
</style>
