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
        const lines = buffer.split(/\r?\n/)
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
  let chatId = 'chatcmpl-' + Date.now()
  let model = ''

  return (line) => {
    if (!line.trim()) return ''

    try {
      if (line.startsWith('event: ')) return ''

      if (!line.startsWith('data: ')) return ''
      const data = JSON.parse(line.slice(6))

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
        return ''
      }

      if (data.type === 'message_delta') {
        const reason = data.delta?.stop_reason
        return fmtOpenAISSE({ id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now()), model, choices: [{ index: 0, delta: {}, finish_reason: reason === 'end_turn' ? 'stop' : reason }] })
      }

      if (data.type === 'message_stop') {
        return 'data: [DONE]\n\n'
      }

      return ''
    } catch {
      return ''
    }
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

    try {
      if (line.startsWith('event: ')) return ''

      if (!line.startsWith('data: ')) return ''
      const data = JSON.parse(line.slice(6))

      if (data.type === 'message_start') {
        model = data.message?.model || model
        return fmtOpenAISSE({ type: 'response.created', response: { id: responseId, model } })
      }

      if (data.type === 'content_block_delta') {
        return fmtOpenAISSE({ type: 'response.output_text.delta', item_id: responseId, output_index: 0, content_index: 0, delta: data.delta?.text || '' })
      }

      if (data.type === 'message_stop') {
        return fmtOpenAISSE({ type: 'response.completed', response: { id: responseId } }) + 'data: [DONE]\n\n'
      }

      return ''
    } catch {
      return ''
    }
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
