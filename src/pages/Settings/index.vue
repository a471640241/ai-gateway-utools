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
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    port.value = 9999
    return
  }
  window.services.setSettings({ port: portNum, autoStart: autoStart.value })
  saved.value = true
  setTimeout(() => saved.value = false, 1500)
}

onMounted(loadSettings)
</script>

<template>
  <div class="settings">
    <div class="settings-header">
      <h3>设置</h3>
      <button class="btn-back" @click="navigate('ai')">&larr; 返回</button>
    </div>

    <div class="form">
      <div class="field">
        <label>代理端口</label>
        <div class="field-row">
          <input v-model.number="port" type="number" min="1" max="65535" @change="saveSettings" />
          <span class="saved-hint" v-if="saved">&check; 已保存</span>
        </div>
      </div>

      <div class="field">
        <label class="checkbox-card">
          <input type="checkbox" v-model="autoStart" @change="saveSettings" />
          <span>启动 uTools 时自动开启代理</span>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  padding: 20px;
  max-width: 420px;
  margin: 0 auto;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.settings-header h3 {
  font-size: 18px;
  font-weight: 700;
  color: #1f2937;
  margin: 0;
}

.btn-back {
  padding: 6px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-back:hover {
  background: #f3f4f6;
  color: #374151;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field > label {
  font-size: 13px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.field input[type="number"] {
  padding: 10px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 500;
  font-family: 'SF Mono', 'Fira Code', monospace;
  outline: none;
  width: 140px;
  transition: border-color 0.15s;
  background: #f9fafb;
}
.field input[type="number"]:focus {
  border-color: #2563eb;
  background: #fff;
}

.saved-hint {
  font-size: 12px;
  color: #22c55e;
  font-weight: 500;
}

.checkbox-card {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 400;
  color: #374151;
  padding: 12px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  transition: all 0.15s;
  text-transform: none;
  letter-spacing: 0;
}
.checkbox-card:hover {
  border-color: #d1d5db;
}
.checkbox-card input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: #2563eb;
  cursor: pointer;
}
</style>
