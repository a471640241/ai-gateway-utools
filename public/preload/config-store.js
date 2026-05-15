// public/preload/config-store.js
// utools.db 配置读写封装。注意：此文件运行在 preload Node.js 环境。

const DB_KEYS = {
  PROXY_SETTINGS: 'config/proxy-settings',
  PROFILES: 'config/profiles',
  ACTIVE_PROFILE: 'config/active-profile',
  ACTIVE_PROFILES: 'config/active-profiles',
  MODELS: 'config/models',
  MODEL_MAPPINGS: 'config/model-mappings'
}

// --- Proxy Settings ---

function getProxySettings() {
  const doc = window.utools.db.get(DB_KEYS.PROXY_SETTINGS)
  return doc ? doc.data : { port: 9999, autoStart: false }
}

function setProxySettings(settings) {
  const existing = window.utools.db.get(DB_KEYS.PROXY_SETTINGS)
  if (existing) {
    window.utools.db.put({ _id: DB_KEYS.PROXY_SETTINGS, _rev: existing._rev, data: settings })
  } else {
    window.utools.db.put({ _id: DB_KEYS.PROXY_SETTINGS, data: settings })
  }
  return settings
}

// --- Profiles ---

function getProfiles() {
  const doc = window.utools.db.get(DB_KEYS.PROFILES)
  const profiles = doc?.data?.profiles
  return Array.isArray(profiles) ? profiles : []
}

function saveProfiles(profiles) {
  const existing = window.utools.db.get(DB_KEYS.PROFILES)
  const data = { profiles }
  if (existing) {
    window.utools.db.put({ _id: DB_KEYS.PROFILES, _rev: existing._rev, data })
  } else {
    window.utools.db.put({ _id: DB_KEYS.PROFILES, data })
  }
}

function addProfile(profile) {
  const profiles = getProfiles()
  const newProfile = { ...profile, id: generateId() }
  profiles.push(newProfile)
  saveProfiles(profiles)
  return newProfile
}

function updateProfile(id, updates) {
  const profiles = getProfiles()
  const idx = profiles.findIndex(p => p.id === id)
  if (idx === -1) throw new Error('Profile not found: ' + id)
  profiles[idx] = { ...profiles[idx], ...updates }
  saveProfiles(profiles)
  return profiles[idx]
}

function deleteProfile(id) {
  // 若删除的是当前启用的配置，先取消启用
  const activeId = getActiveProfileId()
  if (activeId === id) {
    clearActiveProfile()
  }
  // 从多选启用列表中也移除
  const activeIds = getActiveProfiles()
  if (activeIds.includes(id)) {
    setActiveProfiles(activeIds.filter(i => i !== id))
  }
  const profiles = getProfiles().filter(p => p.id !== id)
  saveProfiles(profiles)
}

// --- Active Profile ---

function getActiveProfileId() {
  const doc = window.utools.db.get(DB_KEYS.ACTIVE_PROFILE)
  return doc ? doc.data.id : null
}

function getActiveProfile() {
  const id = getActiveProfileId()
  if (!id) return null
  return getProfiles().find(p => p.id === id) || null
}

function setActiveProfile(id) {
  const existing = window.utools.db.get(DB_KEYS.ACTIVE_PROFILE)
  const data = { id }
  if (existing) {
    window.utools.db.put({ _id: DB_KEYS.ACTIVE_PROFILE, _rev: existing._rev, data })
  } else {
    window.utools.db.put({ _id: DB_KEYS.ACTIVE_PROFILE, data })
  }
}

function clearActiveProfile() {
  const existing = window.utools.db.get(DB_KEYS.ACTIVE_PROFILE)
  if (existing) {
    window.utools.db.remove(existing._id, existing._rev)
  }
}

// --- Active Profiles (multi-select) ---

function getActiveProfiles() {
  const doc = window.utools.db.get(DB_KEYS.ACTIVE_PROFILES)
  return doc ? (doc.data.ids || []) : []
}

function setActiveProfiles(ids) {
  const existing = window.utools.db.get(DB_KEYS.ACTIVE_PROFILES)
  const data = { ids }
  if (existing) {
    window.utools.db.put({ _id: DB_KEYS.ACTIVE_PROFILES, _rev: existing._rev, data })
  } else {
    window.utools.db.put({ _id: DB_KEYS.ACTIVE_PROFILES, data })
  }
}

function reorderProfiles(orderedIds) {
  const profiles = getProfiles()
  const map = {}
  for (const p of profiles) map[p.id] = p
  const reordered = orderedIds.map(id => map[id]).filter(Boolean)
  // 保留不在 orderedIds 中的 profiles（追加到末尾）
  const remaining = profiles.filter(p => !orderedIds.includes(p.id))
  saveProfiles([...reordered, ...remaining])
}

// --- Models ---

function getModels() {
  const doc = window.utools.db.get(DB_KEYS.MODELS)
  const models = doc?.data?.models
  return Array.isArray(models) ? models : []
}

function setModels(models) {
  const existing = window.utools.db.get(DB_KEYS.MODELS)
  const data = { models }
  if (existing) {
    window.utools.db.put({ _id: DB_KEYS.MODELS, _rev: existing._rev, data })
  } else {
    window.utools.db.put({ _id: DB_KEYS.MODELS, data })
  }
  return models
}

// --- Model Mappings ---

function getModelMappings() {
  const doc = window.utools.db.get(DB_KEYS.MODEL_MAPPINGS)
  return doc ? doc.data : { enabled: false, rules: [] }
}

function setModelMappings(mappings) {
  const existing = window.utools.db.get(DB_KEYS.MODEL_MAPPINGS)
  if (existing) {
    window.utools.db.put({ _id: DB_KEYS.MODEL_MAPPINGS, _rev: existing._rev, data: mappings })
  } else {
    window.utools.db.put({ _id: DB_KEYS.MODEL_MAPPINGS, data: mappings })
  }
  return mappings
}

// --- Helpers ---

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// --- Exports ---

module.exports = {
  getProxySettings,
  setProxySettings,
  getProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
  getActiveProfileId,
  getActiveProfile,
  setActiveProfile,
  clearActiveProfile,
  getActiveProfiles,
  setActiveProfiles,
  reorderProfiles,
  getModels,
  setModels,
  getModelMappings,
  setModelMappings
}
