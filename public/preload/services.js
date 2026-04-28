// public/preload/services.js
// 通过 window.services 向渲染进程暴露 Node.js 能力
// 运行在 uTools preload 环境

const { execSync } = require('child_process')
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
  },

  // --- Stats & Logs ---
  getStats() {
    return proxyManager.getStats()
  },

  getLogs(limit) {
    return proxyManager.getLogs(limit)
  },

  // 复制文本到系统剪贴板
  copyText(text) {
    try {
      if (process.platform === 'darwin') {
        execSync('pbcopy', { input: text })
      } else if (process.platform === 'win32') {
        execSync('clip', { input: text })
      } else {
        execSync('xclip -selection clipboard', { input: text })
      }
    } catch {
      // 系统剪贴板不可用时静默失败
    }
  },

  // 注册状态变更回调（子进程崩溃时自动通知 UI）
  onStatusChange(fn) {
    this._statusListener = fn
  }
}

// 仅在进程退出时清理子进程（isKill=true），插件隐藏时保持代理运行
window.utools.onPluginOut((isKill) => {
  if (isKill) {
    proxyManager.stop()
  }
})
