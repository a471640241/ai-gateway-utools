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

// --- Request logs (in-memory, max 1000 entries) ---
const MAX_LOGS = 1000
const logs = []

function addLog(entry) {
  logs.push(entry)
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
}

function getLogs(limit) {
  return logs.slice(-(limit || 100))
}

function getStats() {
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000
  const recentLogs = logs.filter(l => l.timestamp >= thirtyDaysAgo)

  // 按接口统计
  const byEndpoint = {}
  // 按模型统计
  const byModel = {}
  // 按天统计（近30天趋势）
  const byDay = {}
  // 异常统计
  const errors = []

  for (const l of recentLogs) {
    const ep = l.endpoint || '-'
    byEndpoint[ep] = (byEndpoint[ep] || 0) + 1

    const m = l.model || '-'
    byModel[m] = (byModel[m] || 0) + 1

    // 按天聚合
    const day = new Date(l.timestamp).toISOString().slice(0, 10)
    byDay[day] = (byDay[day] || 0) + 1

    // 异常收集（非 2xx 且非 404）
    if (l.statusCode && (l.statusCode < 200 || l.statusCode >= 300) && l.statusCode !== 404) {
      errors.push({
        timestamp: l.timestamp,
        endpoint: l.endpoint,
        statusCode: l.statusCode,
        error: l.error
      })
    }
  }

  // 按天排序
  const trend = Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }))

  return {
    totalRequests: recentLogs.length,
    byEndpoint: Object.entries(byEndpoint).map(([k, v]) => ({ endpoint: k, count: v })),
    byModel: Object.entries(byModel).map(([k, v]) => ({ model: k, count: v })),
    trend,
    errors: errors.slice(-50) // 最近50条异常
  }
}

function setCrashCallback(fn) { crashCallback = fn }

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

    const profile = configStore.getActiveProfile()
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
    child.send({ type: 'init', config: { profile, settings, models } })
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
  const profile = configStore.getActiveProfile()
  const settings = configStore.getProxySettings()
  const models = configStore.getModels()
  child.send({ type: 'reload', config: { profile, settings, models } })
}

function restart() {
  return stop().then(() => start())
}

module.exports = { start, stop, reload, restart, getStatus, getPort, setCrashCallback, getLogs, getStats }
