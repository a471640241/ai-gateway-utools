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
