// public/preload/services.js
// 通过 window.services 向渲染进程暴露 Node.js 能力
// 运行在 uTools preload 环境

const proxyManager = require('./proxy-manager')
const configStore = require('./config-store')

window.services = {
  // --- Proxy control ---
  startProxy() {
    return proxyManager.start()
  },

  stopProxy() {
    return proxyManager.stop()
  },

  getProxyStatus() {
    return { status: proxyManager.getStatus(), port: proxyManager.getPort() }
  },

  // --- Profile CRUD ---
  getProfiles() {
    return configStore.getProfiles()
  },

  addProfile(profile) {
    const saved = configStore.addProfile(profile)
    const activeId = configStore.getActiveProfileId()
    if (!activeId) {
      configStore.setActiveProfile(saved.id)
      proxyManager.reload()
    }
    return saved
  },

  updateProfile(id, updates) {
    const saved = configStore.updateProfile(id, updates)
    const activeId = configStore.getActiveProfileId()
    if (activeId === id && proxyManager.getStatus() === 'running') {
      proxyManager.reload()
    }
    return saved
  },

  deleteProfile(id) {
    configStore.deleteProfile(id)
  },

  // --- Active profile ---
  getActiveProfile() {
    return configStore.getActiveProfile()
  },

  setActiveProfile(id) {
    configStore.setActiveProfile(id)
    if (proxyManager.getStatus() === 'running') {
      proxyManager.reload()
    }
  },

  // --- Settings ---
  getSettings() {
    return configStore.getProxySettings()
  },

  setSettings(settings) {
    const saved = configStore.setProxySettings(settings)
    proxyManager.reload()
    return saved
  },

  // --- Models ---
  getModels() {
    return configStore.getModels()
  },

  addModel(modelId) {
    const models = configStore.getModels()
    if (models.includes(modelId)) return models
    const updated = [...models, modelId]
    configStore.setModels(updated)
    if (proxyManager.getStatus() === 'running') {
      proxyManager.reload()
    }
    return updated
  },

  removeModel(modelId) {
    const models = configStore.getModels().filter(m => m !== modelId)
    configStore.setModels(models)
    if (proxyManager.getStatus() === 'running') {
      proxyManager.reload()
    }
    return models
  }
}

// 插件退出时清理子进程
window.utools.onPluginOut(() => {
  proxyManager.stop()
})
