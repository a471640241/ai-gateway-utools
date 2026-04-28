<script setup>
import { ref, onMounted, inject } from 'vue'

const navigate = inject('navigate')

const port = ref(9999)
const autoStart = ref(false)
const saved = ref(false)

function loadSettings() {
  const settings = window.services.getSettings()
  port.value = settings.port || 9999
  autoStart.value = settings.autoStart || false
}

function saveSettings() {
  const portNum = parseInt(port.value, 10)
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) { port.value = 9999; return }
  window.services.setSettings({ port: portNum, autoStart: autoStart.value })
  saved.value = true
  setTimeout(() => saved.value = false, 1500)
}

onMounted(loadSettings)
</script>

<template>
  <div class="settings">
    <div class="page-header">
      <button class="back-link" @click="navigate('ai')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        返回
      </button>
      <h2>设置</h2>
    </div>

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
  </div>
</template>

<style scoped>
.settings {
  padding: 16px;
  max-width: 540px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.page-header h2 {
  font-size: 18px;
  font-weight: 700;
  color: #1e293b;
  margin: 0;
}

.back-link {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: none;
  border-radius: 8px;
  background: #f1f5f9;
  font-size: 13px;
  color: #64748b;
  cursor: pointer;
  transition: all .15s;
}
.back-link:hover { background: #e2e8f0; color: #334155; }

/* Card */
.card {
  margin-bottom: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #fff;
}

.card-header {
  padding: 16px 16px 0;
}

.card-header h3 {
  font-size: 12px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: .6px;
}

.card-body {
  padding: 14px 16px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field-row input[type="number"] {
  padding: 10px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 500;
  font-family: 'SF Mono', 'Fira Code', monospace;
  outline: none;
  width: 130px;
  transition: all .15s;
  background: #f8fafc;
}
.field-row input[type="number"]:focus {
  border-color: #a5b4fc;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(165,180,252,.15);
}

.saved {
  font-size: 13px;
  color: #22c55e;
  font-weight: 500;
}

.check-field {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 14px;
  color: #334155;
}
.check-field input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: #6366f1;
  cursor: pointer;
}
</style>
