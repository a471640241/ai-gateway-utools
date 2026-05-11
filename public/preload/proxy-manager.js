// public/preload/proxy-manager.js
// 管理代理子进程生命周期：start/stop/restart
// 通过 IPC 向子进程传递配置

const { fork } = require('child_process')
const path = require('path')
const configStore = require('./config-store')

let child = null
let status = 'stopped' // 'stopped' | 'running'
let stopping = false
let crashCallback = null

// --- Request logs (in-memory, max 1000 entries, persisted to utools.db) ---
const DB_KEY_LOGS = 'config/request-logs'

function loadLogsFromDb() {
  try {
    const doc = window.utools.db.get(DB_KEY_LOGS)
    if (doc && Array.isArray(doc.data)) return doc.data
  } catch {}
  return []
}

const logs = loadLogsFromDb()

let saveTimer = null
function saveLogsToDb() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const existing = window.utools.db.get(DB_KEY_LOGS)
      const data = logs
      if (existing) {
        window.utools.db.put({ _id: DB_KEY_LOGS, _rev: existing._rev, data })
      } else {
        window.utools.db.put({ _id: DB_KEY_LOGS, data })
      }
    } catch {}
  }, 2000)
}

function addLog(entry) {
  logs.push(entry)
  saveLogsToDb()
}

function getLogs(limit) {
  return logs.slice(-(limit || 1000)).reverse()
}

function clearLogs() {
  logs.length = 0
  try {
    const existing = window.utools.db.get(DB_KEY_LOGS)
    if (existing) window.utools.db.remove(existing._id, existing._rev)
  } catch {}
}

function clearLogsBodies() {
  for (const log of logs) {
    if (log.requestBody) log.requestBody = '[cleared]'
    if (log.responseBody) log.responseBody = '[cleared]'
  }
  saveLogsToDb()
}

function fmtLocalDate(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

function getStats() {
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000

  // 全量统计（所有日志）
  const byEndpoint = {}
  const byModel = {}
  const byProviderModel = {}
  const errors = []

  // Token 统计
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let totalTokens = 0
  const byModelTokens = {}
  const byProviderTokens = {}

  // 近30天趋势 + 全年热力图
  const byDay = {}
  const yearMap = {}  // YYYY-MM-DD → count，近365天
  const byDayTokens = {}  // 30天 token 趋势
  const yearMapTokens = {}  // 全年 token 热力图

  for (const l of logs) {
    const ep = l.endpoint || '-'
    byEndpoint[ep] = (byEndpoint[ep] || 0) + 1

    const m = l.model || '-'
    byModel[m] = (byModel[m] || 0) + 1

    const pv = l.provider || '-'
    if (!byProviderModel[pv]) byProviderModel[pv] = {}
    byProviderModel[pv][m] = (byProviderModel[pv][m] || 0) + 1

    if (l.statusCode && (l.statusCode < 200 || l.statusCode >= 300) && l.statusCode !== 404) {
      errors.push({
        timestamp: l.timestamp,
        endpoint: l.endpoint,
        statusCode: l.statusCode,
        error: l.error
      })
    }

    // Token 统计
    if (l.totalTokens) {
      totalPromptTokens += l.promptTokens || 0
      totalCompletionTokens += l.completionTokens || 0
      totalTokens += l.totalTokens

      if (!byModelTokens[m]) byModelTokens[m] = { prompt: 0, completion: 0, total: 0 }
      byModelTokens[m].prompt += l.promptTokens || 0
      byModelTokens[m].completion += l.completionTokens || 0
      byModelTokens[m].total += l.totalTokens

      if (!byProviderTokens[pv]) byProviderTokens[pv] = { prompt: 0, completion: 0, total: 0 }
      byProviderTokens[pv].prompt += l.promptTokens || 0
      byProviderTokens[pv].completion += l.completionTokens || 0
      byProviderTokens[pv].total += l.totalTokens
    }

    // 近30天趋势 + 全年热力图
    const day = fmtLocalDate(l.timestamp)
    if (l.timestamp >= thirtyDaysAgo) {
      byDay[day] = (byDay[day] || 0) + 1
      byDayTokens[day] = (byDayTokens[day] || 0) + (l.totalTokens || 0)
    }
    const yearAgo = now - 365 * 24 * 3600 * 1000
    if (l.timestamp >= yearAgo) {
      yearMap[day] = (yearMap[day] || 0) + 1
      yearMapTokens[day] = (yearMapTokens[day] || 0) + (l.totalTokens || 0)
    }
  }

  // 补全近30天空数据
  const today = new Date(); today.setHours(0,0,0,0)
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    const ds = fmtLocalDate(d.getTime())
    if (!byDay[ds]) byDay[ds] = 0
    if (!byDayTokens[ds]) byDayTokens[ds] = 0
  }

  const trend = Object.entries(byDay)
    .filter(([date]) => {
      const d = new Date(date); d.setHours(0,0,0,0)
      return d >= new Date(today.getTime() - 29 * 86400000)
    })
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count, tokens: byDayTokens[date] || 0 }))

  const byProviderModelList = Object.entries(byProviderModel)
    .map(([provider, models]) => ({
      provider,
      count: Object.values(models).reduce((a, b) => a + b, 0),
      models: Object.entries(models)
        .map(([model, count]) => ({ model, count }))
        .sort((a, b) => b.count - a.count)
    }))
    .sort((a, b) => b.count - a.count)

  return {
    totalRequests: logs.length,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    byEndpoint: Object.entries(byEndpoint).map(([k, v]) => ({ endpoint: k, count: v })),
    byProviderModel: byProviderModelList,
    byProviderTokens: Object.entries(byProviderTokens).map(([provider, t]) => ({ provider, ...t })),
    byModel: Object.entries(byModel).map(([k, v]) => ({ model: k, count: v, tokens: byModelTokens[k] || null })).sort((a, b) => b.count - a.count),
    byModelTokens: Object.entries(byModelTokens).map(([model, t]) => ({ model, ...t })).sort((a, b) => b.total - a.total),
    yearMap,
    yearMapTokens,
    trend,
    errors: errors.slice(-50)
  }
}

function setCrashCallback(fn) { crashCallback = fn }

function getActiveProfilesList() {
  const activeIds = configStore.getActiveProfiles()
  const allProfiles = configStore.getProfiles()
  return activeIds.map(id => allProfiles.find(p => p.id === id)).filter(Boolean)
}

function getStatus() {
  return status
}

function getPort() {
  const settings = configStore.getProxySettings()
  return settings.port || 9999
}

function start() {
  return new Promise((resolve, reject) => {
    if (status === 'running') {
      resolve({ port: getPort(), status: 'running' })
      return
    }

    const profiles = getActiveProfilesList()
    const settings = configStore.getProxySettings()
    const models = configStore.getModels()

    const proxyPath = path.join(__dirname, 'proxy-server.js')

    child = fork(proxyPath, [], { silent: false })

    child.on('message', (msg) => {
      if (msg.type === 'started') {
        status = 'running'
        resolve({ port: msg.port, status: 'running' })
      } else if (msg.type === 'error') {
        reject(new Error(msg.error + ': ' + msg.message))
      } else if (msg.type === 'log') {
        addLog(msg.data)
      }
    })

    child.on('exit', (code) => {
      const wasCrash = !stopping
      status = 'stopped'
      child = null
      stopping = false
      if (wasCrash && crashCallback) {
        crashCallback()
      }
    })

    child.on('error', (err) => {
      status = 'stopped'
      child = null
      reject(err)
    })

    // Send init config
    child.send({ type: 'init', config: { profiles, settings, models } })
  })
}

function stop() {
  return new Promise((resolve) => {
    if (child) {
      stopping = true
      child.on('exit', () => {
        status = 'stopped'
        child = null
        resolve()
      })
      child.kill('SIGTERM')
      // Force kill after 3s
      setTimeout(() => {
        if (child) {
          child.kill('SIGKILL')
        }
      }, 3000)
    } else {
      status = 'stopped'
      resolve()
    }
  })
}

function reload() {
  if (!child || status !== 'running') return
  const profiles = getActiveProfilesList()
  const settings = configStore.getProxySettings()
  const models = configStore.getModels()
  child.send({ type: 'reload', config: { profiles, settings, models } })
}

function restart() {
  return stop().then(() => start())
}

function getLogEnabled() {
  return configStore.getProxySettings().logEnabled || false
}

function setLogEnabled(enabled) {
  const settings = configStore.getProxySettings()
  settings.logEnabled = enabled
  configStore.setProxySettings(settings)
  if (child && status === 'running') {
    child.send({ type: 'reload', config: {
      profiles: getActiveProfilesList(),
      settings,
      models: configStore.getModels()
    }})
  }
}

module.exports = { start, stop, reload, restart, getStatus, getPort, setCrashCallback, getLogs, clearLogs, clearLogsBodies, getStats, getLogEnabled, setLogEnabled }
