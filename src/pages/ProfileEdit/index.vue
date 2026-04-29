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

const fetchingModels = ref(false)
const fetchedModels = ref([])
const showModelDropdown = ref(false)

const title = computed(() => isEdit.value ? '编辑提供商' : '添加提供商')

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

function canFetchModels() {
  return form.value.providerType && form.value.baseUrl.trim() && form.value.apiKey.trim()
}

async function fetchModels() {
  if (!canFetchModels()) {
    error.value = '请先填写提供商类型、Base URL 和 API Key'
    return
  }
  fetchingModels.value = true
  error.value = ''
  fetchedModels.value = []
  showModelDropdown.value = false
  try {
    const models = await window.services.fetchProviderModels(form.value)
    if (models.length === 0) {
      error.value = '该提供商返回了空的模型列表'
      return
    }
    fetchedModels.value = models
    showModelDropdown.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    fetchingModels.value = false
  }
}

function selectModel(modelId) {
  form.value.defaultModel = modelId
  showModelDropdown.value = false
}

onMounted(() => {
  if (pagePayload.value && pagePayload.value.editId) {
    loadProfile(pagePayload.value.editId)
  }
})
</script>

<template>
  <div class="editor">
    <div class="page-header">
      <button class="back-link" @click="navigate('ai')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        返回
      </button>
      <h2>{{ title }}</h2>
    </div>

    <div class="card">
      <div class="card-body">
        <div class="fields">
          <div class="field">
            <label>配置名称 <span class="req">*</span></label>
            <input v-model="form.name" type="text" placeholder="如：我的 OpenAI" />
          </div>

          <div class="field">
            <label>提供商类型 <span class="req">*</span></label>
            <select v-model="form.providerType">
              <option value="openai-chat">OpenAI Chat Completions</option>
              <option value="openai-response">OpenAI Responses</option>
              <option value="anthropic-message">Anthropic Messages</option>
              <option value="newapi">NEW API</option>
            </select>
          </div>

          <div class="field">
            <label>Base URL <span class="req">*</span></label>
            <input v-model="form.baseUrl" type="text" placeholder="如：https://api.openai.com" />
          </div>

          <div class="field">
            <label>API Key <span class="opt">(可选)</span></label>
            <div class="key-row">
              <input v-model="form.apiKey" :type="showKey ? 'text' : 'password'" placeholder="sk-..." />
              <button type="button" class="toggle-key" @click="showKey = !showKey">
                {{ showKey ? '隐藏' : '显示' }}
              </button>
            </div>
          </div>

          <div class="field">
            <label>默认模型 <span class="opt">(可选)</span></label>
            <div class="model-row">
              <input v-model="form.defaultModel" type="text" placeholder="如：gpt-4o" />
              <button type="button" class="btn-fetch" :disabled="fetchingModels || !canFetchModels()" @click="fetchModels">
                {{ fetchingModels ? '获取中...' : '获取模型' }}
              </button>
            </div>
            <div class="model-dropdown" v-if="showModelDropdown && fetchedModels.length">
              <div class="model-option" v-for="m in fetchedModels" :key="m" @click="selectModel(m)">{{ m }}</div>
            </div>
          </div>

          <div class="error" v-if="error">{{ error }}</div>

          <div class="actions">
            <button type="button" class="btn-cancel" @click="navigate('ai')">取消</button>
            <button type="button" class="btn-save" :disabled="saving" @click="save">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor {
  padding: 16px;
  max-width: 780px;
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

.card {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #fff;
}

.card-body { padding: 20px; }

.fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

.req { color: #ef4444; font-weight: 700; }
.opt { font-weight: 400; color: #94a3b8; font-size: 12px; }

.field input,
.field select {
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 14px;
  outline: none;
  transition: all .15s;
  background: #f8fafc;
  color: #334155;
}
.field input:focus,
.field select:focus {
  border-color: #a5b4fc;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(165,180,252,.15);
}

.key-row {
  display: flex;
  gap: 8px;
}
.key-row input { flex: 1; }

.toggle-key {
  padding: 10px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  font-size: 13px;
  color: #64748b;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}
.toggle-key:hover { background: #f1f5f9; }

.model-row {
  display: flex;
  gap: 8px;
}
.model-row input { flex: 1; }

.btn-fetch {
  padding: 10px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  font-size: 13px;
  color: #6366f1;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}
.btn-fetch:hover:not(:disabled) { background: #f0f0ff; border-color: #a5b4fc; }
.btn-fetch:disabled { opacity: .4; cursor: not-allowed; }

.model-dropdown {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  margin-top: 2px;
}

.model-option {
  padding: 8px 12px;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
  transition: background .1s;
}
.model-option:hover { background: #f0f0ff; }
.model-option + .model-option { border-top: 1px solid #f1f5f9; }

.error {
  color: #ef4444;
  font-size: 13px;
  font-weight: 500;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}

.btn-cancel {
  padding: 10px 20px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  transition: all .15s;
}
.btn-cancel:hover { background: #f8fafc; }

.btn-save {
  padding: 10px 24px;
  border: none;
  border-radius: 10px;
  background: #6366f1;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all .15s;
}
.btn-save:hover { background: #4f46e5; }
.btn-save:disabled { opacity: .5; cursor: not-allowed; }
</style>
