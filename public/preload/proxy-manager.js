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

module.exports = { start, stop, reload, restart, getStatus, getPort, setCrashCallback }
