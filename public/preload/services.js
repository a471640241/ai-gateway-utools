// public/preload/services.js
// 通过 window.services 向渲染进程暴露 Node.js 能力
// 运行在 uTools preload 环境

const { execSync } = require('child_process')
const http = require('http')
const https = require('https')
const { URL } = require('url')
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
    const activeIds = configStore.getActiveProfiles()
    if (activeIds.length === 0) {
      configStore.setActiveProfiles([saved.id])
      proxyManager.reload()
    }
    return saved
  },

  updateProfile(id, updates) {
    const saved = configStore.updateProfile(id, updates)
    const activeIds = configStore.getActiveProfiles()
    if (activeIds.includes(id) && proxyManager.getStatus() === 'running') {
      proxyManager.reload()
    }
    return saved
  },

  deleteProfile(id) {
    configStore.deleteProfile(id)
  },

  // --- Active profile (legacy single) ---
  getActiveProfile() {
    return configStore.getActiveProfile()
  },

  setActiveProfile(id) {
    configStore.setActiveProfile(id)
    if (proxyManager.getStatus() === 'running') {
      proxyManager.reload()
    }
  },

  // --- Active profiles (multi-select) ---
  getActiveProfiles() {
    return configStore.getActiveProfiles()
  },

  setActiveProfiles(ids) {
    configStore.setActiveProfiles(ids)
    if (proxyManager.getStatus() === 'running') {
      proxyManager.reload()
    }
  },

  toggleProfile(id, enabled) {
    const ids = configStore.getActiveProfiles()
    if (enabled) {
      if (!ids.includes(id)) {
        configStore.setActiveProfiles([...ids, id])
      }
    } else {
      configStore.setActiveProfiles(ids.filter(i => i !== id))
    }
    if (proxyManager.getStatus() === 'running') {
      proxyManager.reload()
    }
  },

  reorderProfiles(orderedIds) {
    configStore.reorderProfiles(orderedIds)
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

  // --- Model Mappings ---
  getModelMappings() {
    return configStore.getModelMappings()
  },

  setModelMappings(mappings) {
    const saved = configStore.setModelMappings(mappings)
    if (proxyManager.getStatus() === 'running') {
      proxyManager.reload()
    }
    return saved
  },

  // 从上游提供商获取模型列表
  fetchProviderModels(profile) {
    return new Promise((resolve, reject) => {
      const baseUrl = profile.baseUrl.replace(/\/+$/, '')
      const url = `${baseUrl}/v1/models`
      const parsed = new URL(url)
      const isHttps = parsed.protocol === 'https:'
      const transport = isHttps ? https : http

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${profile.apiKey}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      }

      const req = transport.request(options, (res) => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString()
          const status = res.statusCode
          const statusMessages = {
            401: 'API Key 无效或无权限访问',
            403: '无权限访问该接口',
            404: '该提供商不支持 /v1/models 端点',
            429: '请求过于频繁，请稍后重试',
            500: '上游服务器内部错误',
            502: '上游网关错误',
            503: '上游服务暂不可用'
          }
          if (status !== 200) {
            const tip = statusMessages[status] || `HTTP 状态码 ${status}`
            reject(new Error(`${tip}\n${raw.slice(0, 200)}`))
            return
          }
          try {
            const body = JSON.parse(raw)
            if (body.data && Array.isArray(body.data)) {
              resolve(body.data.map(m => m.id || m).filter(Boolean))
            } else if (body.models && Array.isArray(body.models)) {
              resolve(body.models.map(m => m.id || m).filter(Boolean))
            } else {
              reject(new Error(`未知响应格式: ${JSON.stringify(body).slice(0, 300)}`))
            }
          } catch (e) {
            reject(new Error(`JSON解析失败: ${raw.slice(0, 500)}`))
          }
        })
      })

      req.on('error', (err) => {
        reject(new Error('请求失败: ' + err.message))
      })
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('请求超时'))
      })
      req.end()
    })
  },

  // --- Stats & Logs ---
  getStats() {
    return proxyManager.getStats()
  },

  getLogs(limit) {
    return proxyManager.getLogs(limit)
  },

  clearLogs() {
    proxyManager.clearLogs()
  },

  clearAllData() {
    proxyManager.clearAllData()
  },

  clearLogsBodies() {
    proxyManager.clearLogsBodies()
  },

  getLogEnabled() {
    return proxyManager.getLogEnabled()
  },

  setLogEnabled(enabled) {
    return proxyManager.setLogEnabled(enabled)
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
