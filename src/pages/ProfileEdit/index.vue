<script setup>
import { ref, onMounted, computed, inject } from 'vue'

const navigate = inject('navigate')
const pagePayload = inject('pagePayload')

const isEdit = ref(false)
const editId = ref(null)

const form = ref({
  name: '',
  providerType: 'openai-chat',
  baseUrl: '',
  apiKey: '',
  defaultModel: ''
})

const showKey = ref(false)
const saving = ref(false)
const error = ref('')

const title = computed(() => isEdit.value ? '编辑配置' : '添加配置')

function loadProfile(id) {
  const profiles = window.services.getProfiles()
  const p = profiles.find(p => p.id === id)
  if (p) {
    editId.value = p.id
    isEdit.value = true
    form.value = { ...p }
  }
}

function save() {
  error.value = ''

  if (!form.value.name.trim()) { error.value = '请输入配置名称'; return }
  if (!form.value.baseUrl.trim()) { error.value = '请输入 Base URL'; return }

  form.value.baseUrl = form.value.baseUrl.replace(/\/+$/, '')

  saving.value = true
  try {
    if (isEdit.value) {
      window.services.updateProfile(editId.value, form.value)
    } else {
      window.services.addProfile(form.value)
    }
    navigate('ai')
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

function cancel() {
  navigate('ai')
}

onMounted(() => {
  if (pagePayload.value && pagePayload.value.editId) {
    loadProfile(pagePayload.value.editId)
  }
})
</script>

<template>
  <div class="page profile-edit">
    <h3>{{ title }}</h3>

    <div class="form">
      <div class="field">
        <label>配置名称 <span class="required">*</span></label>
        <input v-model="form.name" type="text" placeholder="如：我的 OpenAI" />
      </div>

      <div class="field">
        <label>提供商类型 <span class="required">*</span></label>
        <select v-model="form.providerType">
          <option value="openai-chat">OpenAI Chat Completions</option>
          <option value="openai-response">OpenAI Responses</option>
          <option value="anthropic-message">Anthropic Messages</option>
        </select>
      </div>

      <div class="field">
        <label>Base URL <span class="required">*</span></label>
        <input v-model="form.baseUrl" type="text" placeholder="如：https://api.openai.com" />
      </div>

      <div class="field">
        <label>API Key <span class="optional">(可选)</span></label>
        <div class="key-input">
          <input
            v-model="form.apiKey"
            :type="showKey ? 'text' : 'password'"
            placeholder="sk-..."
          />
          <button type="button" class="btn-toggle" @click="showKey = !showKey">
            {{ showKey ? '隐藏' : '显示' }}
          </button>
        </div>
      </div>

      <div class="field">
        <label>默认模型（可选）</label>
        <input v-model="form.defaultModel" type="text" placeholder="如：gpt-4o" />
      </div>

      <div class="field error-msg" v-if="error">{{ error }}</div>

      <div class="form-actions">
        <button class="btn" @click="cancel">取消</button>
        <button class="btn-primary" @click="save" :disabled="saving">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-edit {
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
  gap: 4px;
}

.field label {
  font-size: 13px;
  font-weight: 500;
  color: #555;
}

.field input, .field select {
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}

.field input:focus, .field select:focus {
  border-color: #1976d2;
}

.key-input {
  display: flex;
  gap: 6px;
}

.key-input input {
  flex: 1;
}

.btn-toggle {
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.required {
  color: #ef4444;
  font-weight: 700;
}

.optional {
  font-weight: 400;
  color: #9ca3af;
  font-size: 12px;
}

.error-msg {
  color: #d32f2f;
  font-size: 13px;
}

.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
