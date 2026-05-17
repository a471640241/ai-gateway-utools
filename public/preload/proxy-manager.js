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
// --- Stats snapshot: persisted independently so clearing logs preserves stats ---
const DB_KEY_LOGS = 'config/request-logs'
const DB_KEY_STATS = 'config/stats-snapshot'

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

// --- Stats snapshot persistence ---

function fmtLocalDate(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

function loadStatsSnapshot() {
  try {
    const doc = window.utools.db.get(DB_KEY_STATS)
    if (doc && doc.data) return doc.data
  } catch {}
  return null
}

function saveStatsSnapshot(snapshot) {
  try {
    const existing = window.utools.db.get(DB_KEY_STATS)
    if (existing) {
      window.utools.db.put({ _id: DB_KEY_STATS, _rev: existing._rev, data: snapshot })
    } else {
      window.utools.db.put({ _id: DB_KEY_STATS, data: snapshot })
    }
  } catch {}
}

function mergeIntoSnapshot(snapshot, entry) {
  snapshot.totalRequests += 1

  const ep = entry.endpoint || '-'
  snapshot.byEndpoint[ep] = (snapshot.byEndpoint[ep] || 0) + 1

  const m = entry.model || '-'
  snapshot.byModel[m] = (snapshot.byModel[m] || 0) + 1

  const pv = entry.provider || '-'
  if (!snapshot.byProviderModel[pv]) snapshot.byProviderModel[pv] = {}
  snapshot.byProviderModel[pv][m] = (snapshot.byProviderModel[pv][m] || 0) + 1

  if (entry.totalTokens) {
    snapshot.totalPromptTokens += entry.promptTokens || 0
    snapshot.totalCompletionTokens += entry.completionTokens || 0
    snapshot.totalTokens += entry.totalTokens

    if (!snapshot.byModelTokens[m]) snapshot.byModelTokens[m] = { prompt: 0, completion: 0, total: 0 }
    snapshot.byModelTokens[m].prompt += entry.promptTokens || 0
    snapshot.byModelTokens[m].completion += entry.completionTokens || 0
    snapshot.byModelTokens[m].total += entry.totalTokens

    if (!snapshot.byProviderTokens[pv]) snapshot.byProviderTokens[pv] = { prompt: 0, completion: 0, total: 0 }
    snapshot.byProviderTokens[pv].prompt += entry.promptTokens || 0
    snapshot.byProviderTokens[pv].completion += entry.completionTokens || 0
    snapshot.byProviderTokens[pv].total += entry.totalTokens
  }

  const day = fmtLocalDate(entry.timestamp)
  snapshot.yearMap[day] = (snapshot.yearMap[day] || 0) + 1
  snapshot.yearMapTokens[day] = (snapshot.yearMapTokens[day] || 0) + (entry.totalTokens || 0)
}

const statsSnapshot = loadStatsSnapshot() || {
  totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0,
  byEndpoint: {}, byModel: {}, byProviderModel: {},
  byModelTokens: {}, byProviderTokens: {},
  yearMap: {}, yearMapTokens: {}
}

// Migrate: if snapshot is fresh but logs exist, build snapshot from existing logs
if (statsSnapshot.totalRequests === 0 && logs.length > 0) {
  for (const l of logs) mergeIntoSnapshot(statsSnapshot, l)
  saveStatsSnapshot(statsSnapshot)
}

let statsSaveTimer = null
function scheduleStatsSave() {
  clearTimeout(statsSaveTimer)
  statsSaveTimer = setTimeout(() => saveStatsSnapshot(statsSnapshot), 2000)
}

function addLog(entry) {
  logs.push(entry)
  mergeIntoSnapshot(statsSnapshot, entry)
  saveLogsToDb()
  scheduleStatsSave()
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

function clearAllData() {
  clearLogs()
  // Reset stats snapshot
  statsSnapshot.totalRequests = 0
  statsSnapshot.totalPromptTokens = 0
  statsSnapshot.totalCompletionTokens = 0
  statsSnapshot.totalTokens = 0
  statsSnapshot.byEndpoint = {}
  statsSnapshot.byModel = {}
  statsSnapshot.byProviderModel = {}
  statsSnapshot.byModelTokens = {}
  statsSnapshot.byProviderTokens = {}
  statsSnapshot.yearMap = {}
  statsSnapshot.yearMapTokens = {}
  try {
    const existing = window.utools.db.get(DB_KEY_STATS)
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

function getStats() {
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000
  const yearAgo = now - 365 * 24 * 3600 * 1000
  const errors = []

  // 30-day trend: computed from logs only (cleared logs reset trend)
  const byDay = {}
  const byDayTokens = {}

  for (const l of logs) {
    if (l.statusCode && (l.statusCode < 200 || l.statusCode >= 300) && l.statusCode !== 404) {
      errors.push({
        timestamp: l.timestamp,
        endpoint: l.endpoint,
        statusCode: l.statusCode,
        error: l.error
      })
    }

    if (l.timestamp >= thirtyDaysAgo) {
      const day = fmtLocalDate(l.timestamp)
      byDay[day] = (byDay[day] || 0) + 1
      byDayTokens[day] = (byDayTokens[day] || 0) + (l.totalTokens || 0)
    }
  }

  // Fill missing days
  const today = new Date(); today.setHours(0, 0, 0, 0)
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    const ds = fmtLocalDate(d.getTime())
    if (!byDay[ds]) byDay[ds] = 0
    if (!byDayTokens[ds]) byDayTokens[ds] = 0
  }

  const trend = Object.entries(byDay)
    .filter(([date]) => {
      const d = new Date(date); d.setHours(0, 0, 0, 0)
      return d >= new Date(today.getTime() - 29 * 86400000)
    })
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count, tokens: byDayTokens[date] || 0 }))

  // Cumulative stats from snapshot (survives log clearing)
  const s = statsSnapshot
  const byProviderModelList = Object.entries(s.byProviderModel)
    .map(([provider, models]) => ({
      provider,
      count: Object.values(models).reduce((a, b) => a + b, 0),
      models: Object.entries(models)
        .map(([model, count]) => ({ model, count }))
        .sort((a, b) => b.count - a.count)
    }))
    .sort((a, b) => b.count - a.count)

  // Year heatmap: filter snapshot to last 365 days
  const yearMap = {}
  const yearMapTokens = {}
  for (const [day, count] of Object.entries(s.yearMap)) {
    const ts = new Date(day).getTime()
    if (ts >= yearAgo) {
      yearMap[day] = count
      yearMapTokens[day] = s.yearMapTokens[day] || 0
    }
  }

  return {
    totalRequests: s.totalRequests,
    totalPromptTokens: s.totalPromptTokens,
    totalCompletionTokens: s.totalCompletionTokens,
    totalTokens: s.totalTokens,
    byEndpoint: Object.entries(s.byEndpoint).map(([k, v]) => ({ endpoint: k, count: v })),
    byProviderModel: byProviderModelList,
    byProviderTokens: Object.entries(s.byProviderTokens).map(([provider, t]) => ({ provider, ...t })),
    byModel: Object.entries(s.byModel).map(([k, v]) => ({ model: k, count: v, tokens: s.byModelTokens[k] || null })).sort((a, b) => b.count - a.count),
    byModelTokens: Object.entries(s.byModelTokens).map(([model, t]) => ({ model, ...t })).sort((a, b) => b.total - a.total),
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
    const modelMappings = configStore.getModelMappings()

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
    child.send({ type: 'init', config: { profiles, settings, models, modelMappings } })
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
  const modelMappings = configStore.getModelMappings()
  child.send({ type: 'reload', config: { profiles, settings, models, modelMappings } })
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
      models: configStore.getModels(),
      modelMappings: configStore.getModelMappings()
    }})
  }
}

module.exports = { start, stop, reload, restart, getStatus, getPort, setCrashCallback, getLogs, clearLogs, clearAllData, clearLogsBodies, getStats, getLogEnabled, setLogEnabled }
