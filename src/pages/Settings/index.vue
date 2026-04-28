<script setup>
import { ref, onMounted, inject } from 'vue'

const navigate = inject('navigate')

const port = ref(9999)
const autoStart = ref(false)
const models = ref([])
const newModelId = ref('')
const error = ref('')

function loadSettings() {
  const settings = window.services.getSettings()
  port.value = settings.port || 9999
  autoStart.value = settings.autoStart || false
  models.value = window.services.getModels()
}

function saveSettings() {
  error.value = ''
  const portNum = parseInt(port.value, 10)
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    error.value = '端口号需在 1-65535 之间'
    return
  }
  window.services.setSettings({ port: portNum, autoStart: autoStart.value })
  window.utools.showNotification('设置已保存')
}

function addModel() {
  const id = newModelId.value.trim()
  if (!id) return
  if (models.value.includes(id)) {
    error.value = '模型 ID 已存在'
    return
  }
  models.value = window.services.addModel(id)
  newModelId.value = ''
  error.value = ''
}

function removeModel(id) {
  models.value = window.services.removeModel(id)
}

onMounted(loadSettings)
</script>

<template>
  <div class="page settings">
    <h3>代理设置</h3>

    <div class="form">
      <div class="field">
        <label>代理端口</label>
        <input v-model.number="port" type="number" min="1" max="65535" @change="saveSettings" />
      </div>

      <div class="field">
        <label class="checkbox-label">
          <input type="checkbox" v-model="autoStart" @change="saveSettings" />
          启动 uTools 时自动开启代理
        </label>
      </div>

      <div class="divider"></div>

      <div class="field">
        <label>全局模型列表</label>
        <div class="model-list" v-if="models.length > 0">
          <div v-for="m in models" :key="m" class="model-item">
            <span class="model-id">{{ m }}</span>
            <button class="btn-sm btn-danger" @click="removeModel(m)">删除</button>
          </div>
        </div>
        <div class="empty-hint" v-else>暂无模型</div>
        <div class="add-model">
          <input v-model="newModelId" type="text" placeholder="输入模型 ID（如 gpt-4o）" @keyup.enter="addModel" />
          <button class="btn" @click="addModel">添加</button>
        </div>
      </div>

      <div class="field error-msg" v-if="error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  padding: 16px;
  max-width: 480px;
  margin: 0 auto;
}

h3 {
  margin: 0 0 16px;
  font-size: 18px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 13px;
  font-weight: 500;
  color: #555;
}

.field input[type="number"],
.field input[type="text"] {
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
}

.field input:focus {
  border-color: #1976d2;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 400;
}

.divider {
  height: 1px;
  background: #e0e0e0;
  margin: 8px 0;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
}

.model-id {
  font-family: monospace;
  font-size: 13px;
}

.add-model {
  display: flex;
  gap: 6px;
}

.add-model input {
  flex: 1;
}

.empty-hint {
  font-size: 13px;
  color: #999;
  padding: 8px 0;
}

.error-msg {
  color: #d32f2f;
  font-size: 13px;
}
</style>
