# AI API Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 uTools AI API 统一代理插件，提供本地代理入口（`localhost:9999`），支持 OpenAI Chat/Responses/Anthropic Messages 三种协议转换和多配置热切换。

**Architecture:** Vue 3 前端通过 preload bridge 控制 Node.js 子进程代理服务器。代理内部维护 Converter Layer 做跨协议转换。配置通过 utools.db 存储，通过 IPC 传递给子进程。

**Tech Stack:** Vue 3 + Vite + 原生 CSS（前端），Node.js 原生 http 模块（代理），utools.db（存储），child_process.fork + IPC（进程通信）

---

### Task 1: 项目基础重构

**Files:**
- Modify: `public/plugin.json`
- Modify: `src/App.vue`
- Delete: `src/Hello/index.vue`
- Delete: `src/Read/index.vue`
- Delete: `src/Write/index.vue`

- [ ] **Step 1: 更新 plugin.json features**

```json
{
  "main": "index.html",
  "preload": "preload/services.js",
  "logo": "logo.png",
  "development": {
    "main": "http://localhost:5173"
  },
  "features": [
    {
      "code": "ai",
      "explain": "AI API 代理主页：切换服务配置、启停代理",
      "cmds": ["ai"]
    },
    {
      "code": "ai-add",
      "explain": "添加或编辑 AI 服务配置",
      "cmds": ["ai add", "ai 添加"]
    },
    {
      "code": "ai-set",
      "explain": "代理设置：端口、自动启动、全局模型列表管理",
      "cmds": ["ai set", "ai 设置"]
    }
  ]
}
```

- [ ] **Step 2: 删除旧页面文件**

```bash
rm src/Hello/index.vue
rm src/Read/index.vue
rm src/Write/index.vue
rmdir src/Hello src/Read src/Write 2>/dev/null || true
```

- [ ] **Step 3: 重写 App.vue（provide/inject 路由 + onPluginOut 停代理）**

```vue
<script setup>
import { onMounted, ref, provide } from 'vue'
import Home from './pages/Home/index.vue'
import ProfileEdit from './pages/ProfileEdit/index.vue'
import Settings from './pages/Settings/index.vue'

const route = ref('')
const pagePayload = ref(null)

// 应用内导航函数，通过 provide/inject 传递给子组件
// 避免依赖 utools.redirect 在 features 之间跳转（有传参限制且会触发重载）
function navigate(page, payload) {
  route.value = page
  pagePayload.value = payload ?? null
}

provide('navigate', navigate)
provide('pagePayload', pagePayload)

onMounted(() => {
  window.utools.onPluginEnter((action) => {
    navigate(action.code, action.payload)
  })
  // 插件退出时停止代理子进程，避免遗留孤进程
  window.utools.onPluginOut(() => {
    if (window.services) {
      window.services.stopProxy()
    }
    route.value = ''
  })
})
</script>

<template>
  <template v-if="route === 'ai'">
    <Home />
  </template>
  <template v-if="route === 'ai-add'">
    <ProfileEdit />
  </template>
  <template v-if="route === 'ai-set'">
    <Settings />
  </template>
</template>
```

- [ ] **Step 4: 验证项目结构**

```bash
ls src/pages/Home/index.vue src/pages/ProfileEdit/index.vue src/pages/Settings/index.vue 2>&1
# 预期：No such file or directory（页面尚未创建，后续任务创建）
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: restructure project for AI API switch - update plugin.json, App.vue, remove template pages"
```

---

### Task 2: Config Store（utools.db 封装）

**Files:**
- Create: `public/preload/config-store.js`

- [ ] **Step 1: 创建 config-store.js**

```javascript
// public/preload/config-store.js
// utools.db 配置读写封装。注意：此文件运行在 preload Node.js 环境。

const DB_KEYS = {
  PROXY_SETTINGS: 'config/proxy-settings',
  PROFILES: 'config/profiles',
  ACTIVE_PROFILE: 'config/active-profile',
  MODELS: 'config/models'
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
  return doc ? doc.data.profiles : []
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

// --- Models ---

function getModels() {
  const doc = window.utools.db.get(DB_KEYS.MODELS)
  return doc ? doc.data.models : []
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
  getModels,
  setModels
}
```

- [ ] **Step 2: 验证模块可加载**

在 `public/preload/` 目录下运行 Node 检查语法：

```bash
cd public/preload && node -e "const m = require('./config-store.js'); console.log(Object.keys(m))"
# 预期输出（在 uTools 外部运行会因 window.utools 未定义而报错，这是正常的；检查语法无报错即可）
# 实际上在非 uTools 环境下无法测试，这里是语法校验：
node --check config-store.js && echo "Syntax OK"
```

- [ ] **Step 3: Commit**

```bash
git add public/preload/config-store.js
git commit -m "feat: add config-store for utools.db CRUD operations"
```

---

### Task 3: Proxy Server 核心（HTTP 服务 + 路由 + IPC + 转发）

**Files:**
- Create: `public/preload/proxy-server.js`

- [ ] **Step 1: 创建 proxy-server.js 骨架（HTTP 服务器 + IPC + 转发，不含转换器）**

```javascript
// public/preload/proxy-server.js
// 代理服务器子进程入口。通过 child_process.fork 启动，IPC 接收配置。
// 对外暴露 /v1/chat/completions, /v1/responses, /v1/messages, /v1/models

const http = require('http')
const https = require('https')
const { URL } = require('url')

// --- State ---

let currentConfig = null // { profile: {...}, models: [...] }

// --- Path → source format mapping ---

const PATH_TO_SOURCE = {
  '/v1/chat/completions': 'chat_completions',
  '/v1/responses': 'responses',
  '/v1/messages': 'messages'
}

// --- Provider type → target format + upstream path ---

const PROVIDER_META = {
  'openai-chat':        { target: 'chat_completions', path: '/v1/chat/completions' },
  'openai-response':    { target: 'responses',        path: '/v1/responses' },
  'anthropic-message':  { target: 'messages',          path: '/v1/messages' }
}

// --- Read request body ---

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

// --- Forward request to upstream ---

function forwardRequest(clientReq, clientRes, upstreamUrl, apiKey, body, sseConverter) {
  const parsed = new URL(upstreamUrl)
  const isHttps = parsed.protocol === 'https:'
  const transport = isHttps ? https : http

  const bodyStr = JSON.stringify(body)

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: clientReq.method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(bodyStr)
    }
  }

  const upstreamReq = transport.request(options, (upstreamRes) => {
    const isStreaming = upstreamRes.headers['content-type']?.includes('text/event-stream')

    if (!isStreaming || !sseConverter) {
      // Non-streaming or no conversion needed — pipe through
      clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers)
      upstreamRes.pipe(clientRes)
    } else {
      // SSE streaming with conversion
      clientRes.writeHead(upstreamRes.statusCode, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      let buffer = ''
      upstreamRes.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const result = sseConverter(line)
          if (result) clientRes.write(result)
        }
      })

      upstreamRes.on('end', () => {
        if (buffer.trim()) {
          const result = sseConverter(buffer)
          if (result) clientRes.write(result)
        }
        clientRes.end()
      })
    }
  })

  upstreamReq.on('error', (err) => {
    clientRes.writeHead(502, { 'Content-Type': 'application/json' })
    clientRes.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }))
  })

  upstreamReq.write(bodyStr)
  upstreamReq.end()
}

// --- Route: /v1/models ---

function handleModels(_, res) {
  const models = (currentConfig && currentConfig.models) ? currentConfig.models : []
  const data = models.map(id => ({ id, object: 'model', owned_by: 'ai-api-switch' }))
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ object: 'list', data }))
}

// --- Converters (stubs — filled in Task 4) ---

// body converters: (body) => convertedBody
// sse converters: (line) => convertedLine(s) — factory functions returning (line) => string
const converters = {}

// placeholder — real converters in Task 4
function getBodyConverter(source, target) {
  if (source === target) return null
  const key = `${source}->${target}`
  return converters[key] ? converters[key].body : null
}

function createSSEConverter(source, target) {
  if (source === target) return null
  const key = `${source}->${target}`
  return converters[key] ? converters[key].sseFactory() : null
}

// --- Handle API request ---

async function handleApiRequest(req, res) {
  // Check active profile
  if (!currentConfig || !currentConfig.profile) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Service Unavailable: no active profile configured' }))
    return
  }

  const { profile } = currentConfig
  const source = PATH_TO_SOURCE[req.url]
  const meta = PROVIDER_META[profile.providerType]

  if (!source || !meta) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
    return
  }

  let body
  try {
    body = await readBody(req)
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  // Fill default model
  if (!body.model && profile.defaultModel) {
    body.model = profile.defaultModel
  }

  // Apply body converter
  const bodyConverter = getBodyConverter(source, meta.target)
  if (bodyConverter) {
    body = bodyConverter(body)
  }

  const upstreamUrl = `${profile.baseUrl}${meta.path}`
  const sseConverter = req.headers.accept?.includes('text/event-stream') || body.stream
    ? createSSEConverter(source, meta.target)
    : null

  forwardRequest(req, res, upstreamUrl, profile.apiKey, body, sseConverter)
}

// --- HTTP Server ---

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/v1/models' && req.method === 'GET') {
      handleModels(req, res)
    } else if (PATH_TO_SOURCE[req.url]) {
      await handleApiRequest(req, res)
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not Found' }))
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }))
  }
})

// --- IPC: receive config from parent (preload) ---

process.on('message', (msg) => {
  if (msg.type === 'init') {
    currentConfig = msg.config
    const port = msg.config.settings?.port || 9999
    server.listen(port, '127.0.0.1', () => {
      process.send({ type: 'started', port })
    })
  } else if (msg.type === 'reload') {
    currentConfig = msg.config
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.send({ type: 'error', error: 'EADDRINUSE', message: err.message })
  }
})
```

- [ ] **Step 2: 验证语法**

```bash
node --check public/preload/proxy-server.js && echo "Syntax OK"
```

- [ ] **Step 3: Commit**

```bash
git add public/preload/proxy-server.js
git commit -m "feat: add proxy server core - HTTP routing, upstream forwarding, IPC init/reload"
```

---

### Task 4: Converter Layer（Body + SSE 转换器）

**Files:**
- Modify: `public/preload/proxy-server.js`

- [ ] **Step 1: 添加 Body 转换器到 proxy-server.js**

替换 converter 占位部分（`const converters = {}` 及后面的 helper 函数）为以下完整实现：

```javascript
// --- Converter Registry ---

const converters = {}

// === Body Converters ===

function convertChatToMessages(body) {
  const { messages, ...rest } = body
  const systemMsg = messages.find(m => m.role === 'system')
  const nonSystem = messages.filter(m => m.role !== 'system')
  const result = { ...rest, messages: nonSystem }
  if (systemMsg) result.system = typeof systemMsg.content === 'string' ? systemMsg.content : ''
  return result
}

function convertMessagesToChat(body) {
  const { messages, system, ...rest } = body
  const result = { ...rest, messages: [...messages] }
  if (system) {
    result.messages.unshift({ role: 'system', content: system })
  }
  return result
}

function convertChatToResponses(body) {
  const { messages, ...rest } = body
  const result = { ...rest, input: messages }
  delete result.messages
  return result
}

function convertResponsesToChat(body) {
  const { input, ...rest } = body
  const result = { ...rest, messages: input || [] }
  delete result.input
  return result
}

function convertMessagesToResponses(body) {
  const { messages, system, ...rest } = body
  const input = [...messages]
  if (system) {
    input.unshift({ role: 'system', content: system })
  }
  const result = { ...rest, input }
  delete result.messages
  return result
}

function convertResponsesToMessages(body) {
  const { input, ...rest } = body
  const msgs = input || []
  const systemMsg = msgs.find(m => m.role === 'system')
  const nonSystem = msgs.filter(m => m.role !== 'system')
  const result = { ...rest, messages: nonSystem }
  if (systemMsg) result.system = typeof systemMsg.content === 'string' ? systemMsg.content : ''
  return result
}

// Register body converters
converters['chat_completions->messages']   = { body: convertChatToMessages }
converters['chat_completions->responses']  = { body: convertChatToResponses }
converters['messages->chat_completions']   = { body: convertMessagesToChat }
converters['messages->responses']          = { body: convertMessagesToResponses }
converters['responses->chat_completions']  = { body: convertResponsesToChat }
converters['responses->messages']          = { body: convertResponsesToMessages }

// === SSE Helpers ===

function counter() {
  return () => {
    counter._id = (counter._id || 0) + 1
    return 'evt-' + Date.now() + '-' + counter._id
  }
}

function fmtAnthropicSSE(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function fmtOpenAISSE(data) {
  return `data: ${JSON.stringify(data)}\n\n`
}

function mapFinishReason(reason) {
  const map = { 'stop': 'end_turn', 'length': 'max_tokens', 'tool_calls': 'tool_use' }
  return map[reason] || reason
}

// === SSE Converters (factory functions — each returns (line) => string) ===

function chatToMessagesSSEFactory() {
  let started = false
  let messageId = 'msg_' + Date.now()
  let model = ''

  return (line) => {
    if (!line.startsWith('data: ')) return ''
    if (line.startsWith('data: [DONE]')) return ''

    try {
      const data = JSON.parse(line.slice(6))
      const choice = data.choices?.[0]
      if (!choice) return ''

      if (!started && data.model) model = data.model

      if (!started) {
        started = true
        const role = choice.delta?.role || 'assistant'
        return fmtAnthropicSSE('message_start', { type: 'message_start', message: { id: messageId, type: 'message', role, model, content: [] } }) +
               fmtAnthropicSSE('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
               fmtAnthropicSSE('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: choice.delta?.content || '' } })
      }

      if (choice.finish_reason) {
        return fmtAnthropicSSE('content_block_stop', { type: 'content_block_stop', index: 0 }) +
               fmtAnthropicSSE('message_delta', { type: 'message_delta', delta: { stop_reason: mapFinishReason(choice.finish_reason) }, usage: { output_tokens: 0 } }) +
               fmtAnthropicSSE('message_stop', { type: 'message_stop' })
      }

      return fmtAnthropicSSE('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: choice.delta?.content || '' } })
    } catch {
      return ''
    }
  }
}

function messagesToChatSSEFactory() {
  let started = false
  let chatId = 'chatcmpl-' + Date.now()
  let model = ''
  const gen = counter()

  return (line) => {
    if (!line.trim()) return ''

    const lines = line.split('\n')
    let result = ''
    for (const l of lines) {
      if (l.startsWith('event: ')) {
        // store event type for next data line? simplified: handle data lines
        continue
      }
      if (!l.startsWith('data: ')) continue

      try {
        const data = JSON.parse(l.slice(6))

        if (data.type === 'message_start') {
          model = data.message?.model || model
          chatId = 'chatcmpl-' + Date.now()
          return fmtOpenAISSE({ id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now()), model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
        }

        if (data.type === 'content_block_delta') {
          const text = data.delta?.text || ''
          return fmtOpenAISSE({ id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now()), model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
        }

        if (data.type === 'content_block_stop') {
          return '' // no equivalent single event
        }

        if (data.type === 'message_delta') {
          const reason = data.delta?.stop_reason
          return fmtOpenAISSE({ id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now()), model, choices: [{ index: 0, delta: {}, finish_reason: reason === 'end_turn' ? 'stop' : reason }] })
        }

        if (data.type === 'message_stop') {
          return 'data: [DONE]\n\n'
        }
      } catch {
        continue
      }
    }
    return ''
  }
}

function chatToResponsesSSEFactory() {
  let responseId = 'resp_' + Date.now()
  let model = ''

  return (line) => {
    if (!line.startsWith('data: ')) return ''
    if (line.startsWith('data: [DONE]')) return ''

    try {
      const data = JSON.parse(line.slice(6))
      const choice = data.choices?.[0]
      if (!choice) return ''

      if (data.model) model = data.model

      // OpenAI Responses API SSE uses similar format with different event names
      // Simplified: map to response.output_text.delta events
      const delta = choice.delta
      if (delta?.role) {
        return fmtOpenAISSE({ type: 'response.created', response: { id: responseId, model } })
      }
      if (delta?.content) {
        return fmtOpenAISSE({ type: 'response.output_text.delta', item_id: responseId, output_index: 0, content_index: 0, delta: delta.content })
      }
      if (choice.finish_reason) {
        return fmtOpenAISSE({ type: 'response.completed', response: { id: responseId } }) + 'data: [DONE]\n\n'
      }
      return ''
    } catch {
      return ''
    }
  }
}

function responsesToChatSSEFactory() {
  let chatId = 'chatcmpl-' + Date.now()
  let model = ''

  return (line) => {
    if (!line.startsWith('data: ')) return ''
    if (line.startsWith('data: [DONE]')) return ''

    try {
      const data = JSON.parse(line.slice(6))

      if (data.type === 'response.created') {
        model = data.response?.model || model
        return fmtOpenAISSE({ id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now()), model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
      }

      if (data.type === 'response.output_text.delta') {
        return fmtOpenAISSE({ id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now()), model, choices: [{ index: 0, delta: { content: data.delta }, finish_reason: null }] })
      }

      if (data.type === 'response.completed') {
        return fmtOpenAISSE({ id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now()), model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'
      }

      return ''
    } catch {
      return ''
    }
  }
}

function messagesToResponsesSSEFactory() {
  let responseId = 'resp_' + Date.now()
  let model = ''

  return (line) => {
    if (!line.trim()) return ''
    const lines = line.split('\n')
    let result = ''
    for (const l of lines) {
      if (!l.startsWith('data: ')) continue
      try {
        const data = JSON.parse(l.slice(6))
        if (data.type === 'message_start') {
          model = data.message?.model || model
          result += fmtOpenAISSE({ type: 'response.created', response: { id: responseId, model } })
        } else if (data.type === 'content_block_delta') {
          result += fmtOpenAISSE({ type: 'response.output_text.delta', item_id: responseId, output_index: 0, content_index: 0, delta: data.delta?.text || '' })
        } else if (data.type === 'message_stop') {
          result += fmtOpenAISSE({ type: 'response.completed', response: { id: responseId } }) + 'data: [DONE]\n\n'
        }
      } catch { continue }
    }
    return result
  }
}

function responsesToMessagesSSEFactory() {
  let messageId = 'msg_' + Date.now()
  let model = ''

  return (line) => {
    if (!line.startsWith('data: ')) return ''
    if (line.startsWith('data: [DONE]')) return ''

    try {
      const data = JSON.parse(line.slice(6))

      if (data.type === 'response.created') {
        model = data.response?.model || model
        return fmtAnthropicSSE('message_start', { type: 'message_start', message: { id: messageId, type: 'message', role: 'assistant', model, content: [] } }) +
               fmtAnthropicSSE('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      }

      if (data.type === 'response.output_text.delta') {
        return fmtAnthropicSSE('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: data.delta } })
      }

      if (data.type === 'response.completed') {
        return fmtAnthropicSSE('content_block_stop', { type: 'content_block_stop', index: 0 }) +
               fmtAnthropicSSE('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } }) +
               fmtAnthropicSSE('message_stop', { type: 'message_stop' })
      }

      return ''
    } catch {
      return ''
    }
  }
}

// Register SSE converters
converters['chat_completions->messages'].sseFactory   = chatToMessagesSSEFactory
converters['chat_completions->responses'].sseFactory   = chatToResponsesSSEFactory
converters['messages->chat_completions'].sseFactory    = messagesToChatSSEFactory
converters['messages->responses'].sseFactory           = messagesToResponsesSSEFactory
converters['responses->chat_completions'].sseFactory   = responsesToChatSSEFactory
converters['responses->messages'].sseFactory           = responsesToMessagesSSEFactory
```

- [ ] **Step 2: 验证语法**

```bash
node --check public/preload/proxy-server.js && echo "Syntax OK"
```

- [ ] **Step 3: Commit**

```bash
git add public/preload/proxy-server.js
git commit -m "feat: add converter layer - body converters and SSE stream converters for all 6 cross-protocol combinations"
```

---

### Task 5: Proxy Manager（子进程生命周期管理）

**Files:**
- Create: `public/preload/proxy-manager.js`
- Note: `package.json` at `public/preload/package.json` already exists with `"type": "commonjs"`

- [ ] **Step 1: 创建 proxy-manager.js**

```javascript
// public/preload/proxy-manager.js
// 管理代理子进程生命周期：start/stop/restart
// 通过 IPC 向子进程传递配置

const { fork } = require('child_process')
const path = require('path')
const configStore = require('./config-store')

let child = null
let status = 'stopped' // 'stopped' | 'running'

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
      status = 'stopped'
      child = null
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

module.exports = { start, stop, reload, restart, getStatus, getPort }
```

- [ ] **Step 2: 验证语法**

```bash
node --check public/preload/proxy-manager.js && echo "Syntax OK"
```

- [ ] **Step 3: Commit**

```bash
git add public/preload/proxy-manager.js
git commit -m "feat: add proxy-manager for child process lifecycle and IPC config delivery"
```

---

### Task 6: Preload Services（向 Vue 层暴露 API）

**Files:**
- Modify: `public/preload/services.js`

- [ ] **Step 1: 重写 services.js**

```javascript
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
    // Auto-reload if adding while proxy is running and no active profile
    const activeId = configStore.getActiveProfileId()
    if (!activeId) {
      configStore.setActiveProfile(saved.id)
      proxyManager.reload()
    }
    return saved
  },

  updateProfile(id, updates) {
    const saved = configStore.updateProfile(id, updates)
    // Auto-reload if updating the active profile while proxy is running
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
    // When switching active profile while proxy is running, reload
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
    // If port changed and proxy is running, restart
    // Otherwise just reload
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
```

- [ ] **Step 2: 删除旧的 preload/services.js 内容**

旧文件含 `readFile`/`writeTextFile`/`writeImageFile` 函数，全部替换为上述内容。

- [ ] **Step 3: 验证语法**

```bash
node --check public/preload/services.js && echo "Syntax OK"
```

- [ ] **Step 4: Commit**

```bash
git add public/preload/services.js
git commit -m "feat: rewrite preload services - proxy control, config CRUD, model management APIs"
```

---

### Task 7: Home 页面（主页）

**Files:**
- Create: `src/pages/Home/index.vue`

- [ ] **Step 1: 创建 Home/index.vue**

```vue
<script setup>
import { ref, onMounted, computed, inject } from 'vue'

const navigate = inject('navigate')

const proxyStatus = ref('stopped')
const proxyPort = ref(9999)
const profiles = ref([])
const activeProfileId = ref(null)

const proxyUrl = computed(() => `http://127.0.0.1:${proxyPort.value}`)

function maskApiKey(key) {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return key.slice(0, 3) + '***' + key.slice(-3)
}

function loadData() {
  profiles.value = window.services.getProfiles()
  const active = window.services.getActiveProfile()
  activeProfileId.value = active ? active.id : null
  const status = window.services.getProxyStatus()
  proxyStatus.value = status.status
  proxyPort.value = status.port
}

async function toggleProxy() {
  if (proxyStatus.value === 'running') {
    await window.services.stopProxy()
  } else {
    await window.services.startProxy()
  }
  loadData()
}

function selectProfile(id) {
  window.services.setActiveProfile(id)
  loadData()
}

function copyUrl() {
  window.utools.copyText(proxyUrl.value)
  window.utools.showNotification('已复制代理地址')
}

function goAdd() {
  navigate('ai-add')
}

function goSettings() {
  navigate('ai-set')
}

function goEdit(id) {
  navigate('ai-add', { editId: id })
}

function deleteProfile(id) {
  window.services.deleteProfile(id)
  loadData()
}

function providerLabel(type) {
  const map = {
    'openai-chat': 'Chat',
    'openai-response': 'Response',
    'anthropic-message': 'Anthropic'
  }
  return map[type] || type
}

onMounted(loadData)
</script>

<template>
  <div class="page home">
    <!-- Status Bar -->
    <div class="status-bar" :class="proxyStatus">
      <div class="status-indicator">
        <span class="dot"></span>
        <span>{{ proxyStatus === 'running' ? '运行中' : '已停止' }}</span>
      </div>
      <span class="port" @click="copyUrl" title="点击复制">{{ proxyUrl }}</span>
      <button class="btn-copy" @click="copyUrl">复制</button>
    </div>

    <!-- Profile List -->
    <div class="section">
      <div class="section-header">
        <h3>服务配置</h3>
      </div>
      <div class="profile-list" v-if="profiles.length > 0">
        <div
          v-for="p in profiles"
          :key="p.id"
          class="profile-item"
          :class="{ active: p.id === activeProfileId }"
        >
          <div class="profile-main" @click="selectProfile(p.id)">
            <span class="profile-name">{{ p.name }}</span>
            <span class="profile-tag">{{ providerLabel(p.providerType) }}</span>
            <span class="profile-key">{{ maskApiKey(p.apiKey) }}</span>
          </div>
          <div class="profile-actions">
            <button class="btn-sm" @click.stop="goEdit(p.id)">编辑</button>
            <button class="btn-sm btn-danger" @click.stop="deleteProfile(p.id)">删除</button>
          </div>
        </div>
      </div>
      <div class="empty" v-else>
        <p>暂无配置，点击下方按钮添加</p>
      </div>
    </div>

    <!-- Actions -->
    <div class="actions">
      <button class="btn-primary" @click="toggleProxy">
        {{ proxyStatus === 'running' ? '停止代理' : '启动代理' }}
      </button>
      <button class="btn" @click="goAdd">添加配置</button>
      <button class="btn" @click="goSettings">设置</button>
    </div>
  </div>
</template>

<style scoped>
.home {
  padding: 16px;
  max-width: 480px;
  margin: 0 auto;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 14px;
}
.status-bar.running {
  background: #e8f5e9;
  border: 1px solid #a5d6a7;
}
.status-bar.stopped {
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.running .dot { background: #4caf50; }
.stopped .dot { background: #9e9e9e; }

.port {
  flex: 1;
  font-family: monospace;
  font-size: 13px;
  color: #555;
  cursor: pointer;
  user-select: all;
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.profile-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.profile-item:hover { border-color: #90caf9; }
.profile-item.active {
  border-color: #1976d2;
  background: #e3f2fd;
}
.profile-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.profile-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.profile-tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #e0e0e0;
  color: #555;
  flex-shrink: 0;
}
.profile-key {
  font-size: 11px;
  color: #999;
  font-family: monospace;
}
.profile-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.empty {
  text-align: center;
  color: #999;
  padding: 24px 0;
}
</style>
```

- [ ] **Step 2: 验证文件存在**

```bash
ls -la src/pages/Home/index.vue
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/Home/index.vue
git commit -m "feat: add Home page - proxy status, profile list, start/stop, navigation"
```

---

### Task 8: ProfileEdit 页面（配置编辑）

**Files:**
- Create: `src/pages/ProfileEdit/index.vue`

- [ ] **Step 1: 创建 ProfileEdit/index.vue**

```vue
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

  // Validation
  if (!form.value.name.trim()) { error.value = '请输入配置名称'; return }
  if (!form.value.baseUrl.trim()) { error.value = '请输入 Base URL'; return }
  if (!form.value.apiKey.trim()) { error.value = '请输入 API Key'; return }

  // Strip trailing slash from baseUrl
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
  // 从 pagePayload 获取编辑目标配置 ID（由 Home 页 goEdit 传入）
  if (pagePayload?.value?.editId) {
    loadProfile(pagePayload.value.editId)
  }
})
</script>

<template>
  <div class="page profile-edit">
    <h3>{{ title }}</h3>

    <div class="form">
      <div class="field">
        <label>配置名称</label>
        <input v-model="form.name" type="text" placeholder="如：我的 OpenAI" />
      </div>

      <div class="field">
        <label>提供商类型</label>
        <select v-model="form.providerType">
          <option value="openai-chat">OpenAI Chat Completions</option>
          <option value="openai-response">OpenAI Responses</option>
          <option value="anthropic-message">Anthropic Messages</option>
        </select>
      </div>

      <div class="field">
        <label>Base URL</label>
        <input v-model="form.baseUrl" type="text" placeholder="如：https://api.openai.com" />
      </div>

      <div class="field">
        <label>API Key</label>
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
```

- [ ] **Step 2: 验证文件存在**

```bash
ls -la src/pages/ProfileEdit/index.vue
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/ProfileEdit/index.vue
git commit -m "feat: add ProfileEdit page - config form with provider type, API key show/hide toggle, validation"
```

---

### Task 9: Settings 页面（设置）

**Files:**
- Create: `src/pages/Settings/index.vue`

- [ ] **Step 1: 创建 Settings/index.vue**

```vue
<script setup>
import { ref, onMounted } from 'vue'

const port = ref(9999)
const autoStart = ref(false)
const models = ref([])
const newModelId = ref('')
const error = ref('')

function loadSettings() {
  const settings = window.services.getSettings()
  port.value = settings.port || 9999
  autoStart.value = settings.autoStart || false
  models.value = window.services.getModels()
}

function saveSettings() {
  error.value = ''
  const portNum = parseInt(port.value, 10)
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    error.value = '端口号需在 1-65535 之间'
    return
  }
  window.services.setSettings({ port: portNum, autoStart: autoStart.value })
  window.utools.showNotification('设置已保存')
}

function addModel() {
  const id = newModelId.value.trim()
  if (!id) return
  if (models.value.includes(id)) {
    error.value = '模型 ID 已存在'
    return
  }
  models.value = window.services.addModel(id)
  newModelId.value = ''
  error.value = ''
}

function removeModel(id) {
  models.value = window.services.removeModel(id)
}

onMounted(loadSettings)
</script>

<template>
  <div class="page settings">
    <h3>代理设置</h3>

    <div class="form">
      <div class="field">
        <label>代理端口</label>
        <input v-model.number="port" type="number" min="1" max="65535" @change="saveSettings" />
      </div>

      <div class="field">
        <label class="checkbox-label">
          <input type="checkbox" v-model="autoStart" @change="saveSettings" />
          启动 uTools 时自动开启代理
        </label>
      </div>

      <div class="divider"></div>

      <div class="field">
        <label>全局模型列表</label>
        <div class="model-list" v-if="models.length > 0">
          <div v-for="m in models" :key="m" class="model-item">
            <span class="model-id">{{ m }}</span>
            <button class="btn-sm btn-danger" @click="removeModel(m)">删除</button>
          </div>
        </div>
        <div class="empty-hint" v-else>暂无模型</div>
        <div class="add-model">
          <input v-model="newModelId" type="text" placeholder="输入模型 ID（如 gpt-4o）" @keyup.enter="addModel" />
          <button class="btn" @click="addModel">添加</button>
        </div>
      </div>

      <div class="field error-msg" v-if="error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
.settings {
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
  gap: 6px;
}

.field label {
  font-size: 13px;
  font-weight: 500;
  color: #555;
}

.field input[type="number"],
.field input[type="text"] {
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
}

.field input:focus {
  border-color: #1976d2;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 400;
}

.divider {
  height: 1px;
  background: #e0e0e0;
  margin: 8px 0;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
}

.model-id {
  font-family: monospace;
  font-size: 13px;
}

.add-model {
  display: flex;
  gap: 6px;
}

.add-model input {
  flex: 1;
}

.empty-hint {
  font-size: 13px;
  color: #999;
  padding: 8px 0;
}

.error-msg {
  color: #d32f2f;
  font-size: 13px;
}
</style>
```

- [ ] **Step 2: 验证文件存在**

```bash
ls -la src/pages/Settings/index.vue
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/Settings/index.vue
git commit -m "feat: add Settings page - port config, auto-start toggle, global model list management"
```

---

### Task 10: 全局样式与最终集成

**Files:**
- Modify: `src/main.css`

- [ ] **Step 1: 重写 main.css**

```css
/* src/main.css — Global styles */

:root {
  --color-primary: #1976d2;
  --color-primary-hover: #1565c0;
  --color-danger: #d32f2f;
  --color-danger-hover: #c62828;
  --color-bg: #ffffff;
  --color-border: #e0e0e0;
  --color-text: #333333;
  --color-text-secondary: #555555;
  --radius: 6px;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
  -webkit-font-smoothing: antialiased;
}

/* Buttons */

.btn {
  padding: 8px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.btn:hover {
  background: #f5f5f5;
}

.btn-primary {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius);
  background: var(--color-primary);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-primary:hover {
  background: var(--color-primary-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-sm {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}

.btn-sm:hover {
  background: #f5f5f5;
}

.btn-danger {
  color: var(--color-danger);
  border-color: var(--color-danger);
}

.btn-danger:hover {
  background: #ffebee;
}

.btn-copy {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}

/* Section */

.section {
  margin-bottom: 16px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.section-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
}
```

- [ ] **Step 2: 运行开发服务器验证编译**

```bash
npm run dev
# 确认 Vite 启动成功，无编译错误
# 预期输出：VITE v6.x.x  ready in xxx ms
# ➜  Local:   http://localhost:5173/
```

- [ ] **Step 3: 生产构建验证**

```bash
npm run build
# 确认构建成功，无错误
# 预期输出：✓ built in xxx ms
# 产物位于 dist/ 目录
```

在 uTools 中导入项目目录，验证：
- 输入 `ai` 进入主页
- 输入 `ai add` 进入配置编辑
- 输入 `ai set` 进入设置

- [ ] **Step 4: Commit**

```bash
git add src/main.css
git commit -m "feat: add global styles - CSS variables, button variants, layout utilities"
```

---

### 验证清单

完成所有 Task 后，按以下清单在 uTools 中手动功能测试：

- [ ] 输入 `ai` 进入主页，显示"已停止"状态
- [ ] 输入 `ai add` 添加一个配置（填写完整表单 → 保存 → 回到主页）
- [ ] 主页显示刚添加的配置，点击切换为启用（高亮）
- [ ] 点击「启动代理」，状态变为"运行中"
- [ ] 用 curl 测试：`curl http://127.0.0.1:9999/v1/models`
- [ ] 用 curl 测试 chat completions：`curl -X POST http://127.0.0.1:9999/v1/chat/completions -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'`
- [ ] 输入 `ai set` 修改端口，保存后验证新端口生效
- [ ] 设置页添加/删除模型，验证 `/v1/models` 返回更新
- [ ] 未启用配置时，API 请求返回 503
- [ ] 编辑当前启用配置后，代理自动 reload 使用新配置
- [ ] 停止代理后 API 请求被拒绝（端口不可达）
