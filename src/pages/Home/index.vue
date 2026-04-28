<script setup>
import { ref, onMounted, computed, inject } from 'vue'

const navigate = inject('navigate')

const proxyStatus = ref('stopped')
const proxyPort = ref(9999)
const profiles = ref([])
const activeProfileId = ref(null)
const models = ref([])
const newModelId = ref('')

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
    try {
      await window.services.startProxy()
    } catch (e) {
      window.utools.showNotification('启动失败: ' + e.message)
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
  window.utools.copyText(proxyUrl.value)
  window.utools.showNotification('已复制')
}

function copyProfile(p) {
  window.utools.copyText(p.baseUrl)
  window.utools.showNotification('已复制 ' + p.baseUrl)
}

function goAdd() {
  navigate('ai-add')
}

function goEdit(id) {
  navigate('ai-add', { editId: id })
}

function deleteProfile(id) {
  window.services.deleteProfile(id)
  loadData()
}

function addModel() {
  const id = newModelId.value.trim()
  if (!id) return
  if (models.value.includes(id)) return
  models.value = window.services.addModel(id)
  newModelId.value = ''
}

function removeModel(id) {
  models.value = window.services.removeModel(id)
}

function providerLabel(type) {
  const map = {
    'openai-chat': 'Chat',
    'openai-response': 'Response',
    'anthropic-message': 'Anthropic'
  }
  return map[type] || type
}

onMounted(loadData)
</script>

<template>
  <div class="home">
    <!-- Header: 状态栏 + 启停 + 设置 -->
    <div class="header">
      <div class="status-bar" :class="proxyStatus">
        <span class="dot"></span>
        <span class="status-text">{{ proxyStatus === 'running' ? '运行中' : '已停止' }}</span>
        <span class="proxy-addr" @click="copyUrl" title="点击复制">{{ proxyUrl }}</span>
        <button class="btn-toggle" @click="toggleProxy">
          {{ proxyStatus === 'running' ? '停止' : '启动' }}
        </button>
        <button class="btn-icon" @click="copyUrl" title="复制地址">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
      <button class="btn-icon settings-btn" @click="navigate('ai-set')" title="设置">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      </button>
    </div>

    <!-- 提供商列表 -->
    <div class="section">
      <div class="section-header">
        <h3>提供商</h3>
        <button class="btn-add" @click="goAdd">+ 添加</button>
      </div>
      <div class="profile-list" v-if="profiles.length > 0">
        <div
          v-for="p in profiles"
          :key="p.id"
          class="profile-item"
          :class="{ active: p.id === activeProfileId }"
        >
          <div class="profile-left" @click="selectProfile(p.id)">
            <span class="radio" :class="{ checked: p.id === activeProfileId }"></span>
            <div class="profile-info">
              <span class="profile-name">{{ p.name }}</span>
              <span class="profile-meta">
                <span class="profile-tag">{{ providerLabel(p.providerType) }}</span>
                <span class="profile-key">{{ maskApiKey(p.apiKey) }}</span>
              </span>
            </div>
          </div>
          <div class="profile-actions">
            <button class="btn-sm" @click.stop="copyProfile(p)">复制</button>
            <button class="btn-sm" @click.stop="goEdit(p.id)">编辑</button>
            <button class="btn-sm btn-danger" @click.stop="deleteProfile(p.id)">删除</button>
          </div>
        </div>
      </div>
      <div class="empty" v-else>
        <p>暂无提供商，点击右上角「+ 添加」</p>
      </div>
    </div>

    <!-- 全局模型 -->
    <div class="section">
      <div class="section-header">
        <h3>全局模型</h3>
      </div>
      <div class="model-tags" v-if="models.length > 0">
        <span v-for="m in models" :key="m" class="model-tag">
          {{ m }}
          <button class="tag-close" @click="removeModel(m)">&times;</button>
        </span>
      </div>
      <div class="add-model">
        <input v-model="newModelId" type="text" placeholder="输入模型 ID，回车添加" @keyup.enter="addModel" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.home {
  padding: 16px;
  max-width: 520px;
  margin: 0 auto;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}

.status-bar {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
}
.status-bar.running {
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #d1d5db;
}
.running .dot {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34,197,94,0.4);
}

.status-text {
  font-weight: 600;
  color: #374151;
  white-space: nowrap;
}
.running .status-text { color: #166534; }

.proxy-addr {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
  user-select: all;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.proxy-addr:hover { color: #374151; }

.btn-toggle {
  padding: 5px 14px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  background: #374151;
  color: #fff;
}
.btn-toggle:hover { background: #1f2937; }
.running .btn-toggle {
  background: #ef4444;
}
.running .btn-toggle:hover {
  background: #dc2626;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #6b7280;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}
.btn-icon:hover {
  background: #f3f4f6;
  color: #374151;
  border-color: #d1d5db;
}

.settings-btn {
  border-color: transparent;
  color: #9ca3af;
}
.settings-btn:hover {
  background: #f3f4f6;
  color: #374151;
  border-color: #e5e7eb;
}

/* Section */
.section {
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.section-header h3 {
  font-size: 13px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.btn-add {
  padding: 4px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  font-weight: 500;
  color: #374151;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-add:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
}

/* Profile List */
.profile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.profile-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  transition: all 0.15s;
  background: #fff;
}
.profile-item:hover {
  border-color: #d1d5db;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.profile-item.active {
  border-color: #2563eb;
  background: #eff6ff;
  box-shadow: 0 1px 3px rgba(37,99,235,0.08);
}

.profile-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.radio {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #d1d5db;
  flex-shrink: 0;
  transition: all 0.2s;
}
.radio.checked {
  border-color: #2563eb;
  border-width: 5px;
  background: #fff;
}

.profile-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.profile-name {
  font-weight: 600;
  font-size: 14px;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.profile-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #f3f4f6;
  color: #6b7280;
  font-weight: 500;
}
.active .profile-tag {
  background: #dbeafe;
  color: #2563eb;
}

.profile-key {
  font-size: 11px;
  color: #9ca3af;
  font-family: monospace;
}

.profile-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}

/* Model Tags */
.model-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.model-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 20px;
  font-size: 12px;
  font-family: monospace;
  color: #374151;
}

.tag-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #9ca3af;
  font-size: 14px;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  transition: all 0.15s;
}
.tag-close:hover {
  background: #e5e7eb;
  color: #ef4444;
}

.add-model {
  display: flex;
  gap: 8px;
}

.add-model input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
  background: #f9fafb;
}
.add-model input:focus {
  border-color: #2563eb;
  background: #fff;
}
.add-model input::placeholder {
  color: #cbd5e1;
}

.empty {
  text-align: center;
  color: #9ca3af;
  padding: 32px 16px;
  font-size: 13px;
  background: #f9fafb;
  border: 1px dashed #e5e7eb;
  border-radius: 10px;
}
</style>
