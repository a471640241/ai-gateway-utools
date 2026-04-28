<script setup>
import { ref, onMounted, computed, inject } from 'vue'

const navigate = inject('navigate')

const proxyStatus = ref('stopped')
const proxyPort = ref(9999)
const profiles = ref([])
const activeProfileId = ref(null)

const proxyUrl = computed(() => `http://127.0.0.1:${proxyPort.value}`)

function maskApiKey(key) {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return key.slice(0, 3) + '***' + key.slice(-3)
}

function loadData() {
  profiles.value = window.services.getProfiles()
  const active = window.services.getActiveProfile()
  activeProfileId.value = active ? active.id : null
  const status = window.services.getProxyStatus()
  proxyStatus.value = status.status
  proxyPort.value = status.port
}

async function toggleProxy() {
  if (proxyStatus.value === 'running') {
    await window.services.stopProxy()
  } else {
    await window.services.startProxy()
  }
  loadData()
}

function selectProfile(id) {
  window.services.setActiveProfile(id)
  loadData()
}

function copyUrl() {
  window.utools.copyText(proxyUrl.value)
  window.utools.showNotification('已复制代理地址')
}

function goAdd() {
  navigate('ai-add')
}

function goSettings() {
  navigate('ai-set')
}

function goEdit(id) {
  navigate('ai-add', { editId: id })
}

function deleteProfile(id) {
  window.services.deleteProfile(id)
  loadData()
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
  <div class="page home">
    <div class="status-bar" :class="proxyStatus">
      <div class="status-indicator">
        <span class="dot"></span>
        <span>{{ proxyStatus === 'running' ? '运行中' : '已停止' }}</span>
      </div>
      <span class="port" @click="copyUrl" title="点击复制">{{ proxyUrl }}</span>
      <button class="btn-copy" @click="copyUrl">复制</button>
    </div>

    <div class="section">
      <div class="section-header">
        <h3>服务配置</h3>
      </div>
      <div class="profile-list" v-if="profiles.length > 0">
        <div
          v-for="p in profiles"
          :key="p.id"
          class="profile-item"
          :class="{ active: p.id === activeProfileId }"
        >
          <div class="profile-main" @click="selectProfile(p.id)">
            <span class="profile-name">{{ p.name }}</span>
            <span class="profile-tag">{{ providerLabel(p.providerType) }}</span>
            <span class="profile-key">{{ maskApiKey(p.apiKey) }}</span>
          </div>
          <div class="profile-actions">
            <button class="btn-sm" @click.stop="goEdit(p.id)">编辑</button>
            <button class="btn-sm btn-danger" @click.stop="deleteProfile(p.id)">删除</button>
          </div>
        </div>
      </div>
      <div class="empty" v-else>
        <p>暂无配置，点击下方按钮添加</p>
      </div>
    </div>

    <div class="actions">
      <button class="btn-primary" @click="toggleProxy">
        {{ proxyStatus === 'running' ? '停止代理' : '启动代理' }}
      </button>
      <button class="btn" @click="goAdd">添加配置</button>
      <button class="btn" @click="goSettings">设置</button>
    </div>
  </div>
</template>

<style scoped>
.home {
  padding: 16px;
  max-width: 480px;
  margin: 0 auto;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 14px;
}
.status-bar.running {
  background: #e8f5e9;
  border: 1px solid #a5d6a7;
}
.status-bar.stopped {
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.running .dot { background: #4caf50; }
.stopped .dot { background: #9e9e9e; }

.port {
  flex: 1;
  font-family: monospace;
  font-size: 13px;
  color: #555;
  cursor: pointer;
  user-select: all;
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.profile-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.profile-item:hover { border-color: #90caf9; }
.profile-item.active {
  border-color: #1976d2;
  background: #e3f2fd;
}
.profile-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.profile-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.profile-tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #e0e0e0;
  color: #555;
  flex-shrink: 0;
}
.profile-key {
  font-size: 11px;
  color: #999;
  font-family: monospace;
}
.profile-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.empty {
  text-align: center;
  color: #999;
  padding: 24px 0;
}
</style>
