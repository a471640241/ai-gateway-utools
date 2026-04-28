# AI API Switch - uTools 插件设计文档

## 概述

一个 uTools 插件，作为本地 AI API 统一代理/切换器。解决本地多个 AI 客户端需要分别配置不同模型 API 的问题。提供统一的本地代理入口，通过 uTools 快速切换当前启用的 AI 服务配置。

## 架构

```
┌─────────────────────────────────────────┐
│           uTools Plugin (UI)            │
│  Vue 3 前端：配置管理 + 服务开关 + 状态  │
└──────────────┬──────────────────────────┘
               │ preload bridge (Node.js)
               │ start/stop/reload (IPC 传配置)
┌──────────────▼──────────────────────────┐
│        Proxy Server (子进程)             │
│  监听 localhost:{port}                   │
│  对外暴露 OpenAI Chat/Responses +        │
│  Anthropic Messages 接口                 │
│  ┌─────────────────────────────────┐    │
│  │        Converter Layer          │    │
│  │  根据 source × target 组合选择   │    │
│  │  body 转换器 + SSE chunk 转换器  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
        │           │           │
        ▼           ▼           ▼
   OpenAI Chat  OpenAI Resp  Anthropic
   /v1/chat/    /v1/         /v1/messages
   completions  responses
```

三个核心模块：

- **UI 层**（Vue 3）：配置管理界面，显示代理状态，切换/启动/停止
- **Preload 层**（`public/preload/`，Node.js）：管理代理子进程生命周期，读写配置，通过 IPC 向子进程传递配置
- **Proxy 层**（Node.js 子进程）：HTTP 代理服务器，协议转换（通过 Converter Layer），请求转发

### 代理启动流程

1. 用户在 UI 点击「启动」→ preload 通过 `window.services.startProxy()` 触发
2. Preload 从 `utools.db` 读取 `config/active-profile` 和 `config/proxy-settings`
3. Preload 通过 `child_process.fork` 启动 `proxy-server.js`，通过 IPC `send({ type: 'init', config })` 传递初始配置
4. 用户切换配置/修改配置 → preload 通过 IPC `send({ type: 'reload', config })` 通知子进程热更新
5. uTools 插件退出 → `onPluginOut` 中 kill 子进程

## 提供商类型（providerType）

每个服务配置必须指定 providerType，决定上游 API 的协议格式：

| providerType | 上游接口 | 说明 |
|---|---|---|
| `openai-chat` | `/v1/chat/completions` | OpenAI Chat Completions API |
| `openai-response` | `/v1/responses` | OpenAI Responses API |
| `anthropic-message` | `/v1/messages` | Anthropic Messages API |

## 代理对外接口

代理对外暴露四种接口，供不同客户端使用：

- `/v1/chat/completions` — OpenAI Chat Completions 格式
- `/v1/responses` — OpenAI Responses 格式
- `/v1/messages` — Anthropic Messages 格式
- `/v1/models` — 返回全局模型列表（OpenAI 兼容格式）

### 模型列表接口

`GET /v1/models` 返回后台配置的全局模型列表，格式兼容 OpenAI `/v1/models`：

```json
{
  "object": "list",
  "data": [
    { "id": "gpt-4o", "object": "model", "owned_by": "ai-api-switch" },
    { "id": "claude-sonnet-4-20250514", "object": "model", "owned_by": "ai-api-switch" }
  ]
}
```

模型 ID 在后台统一管理，不区分属于哪个服务配置。客户端请求中传入的 model ID 直接透传到上游。

### 请求转换矩阵

代理根据客户端请求接口 × 当前启用配置的 providerType 做交叉转换：

| 客户端请求 | providerType | 处理方式 |
|---|---|---|
| `/v1/chat/completions` | `openai-chat` | 直接转发到上游 `/v1/chat/completions` |
| `/v1/chat/completions` | `openai-response` | 转换 → 转发到上游 `/v1/responses` |
| `/v1/chat/completions` | `anthropic-message` | 转换 → 转发到上游 `/v1/messages` |
| `/v1/responses` | `openai-response` | 直接转发到上游 `/v1/responses` |
| `/v1/responses` | `openai-chat` | 转换 → 转发到上游 `/v1/chat/completions` |
| `/v1/responses` | `anthropic-message` | 转换 → 转发到上游 `/v1/messages` |
| `/v1/messages` | `anthropic-message` | 直接转发到上游 `/v1/messages` |
| `/v1/messages` | `openai-chat` | 转换 → 转发到上游 `/v1/chat/completions` |
| `/v1/messages` | `openai-response` | 转换 → 转发到上游 `/v1/responses` |

SSE 流式响应在每个 `data:` 行级别做实时转换。

### Converter Layer（转换层）

`proxy-server.js` 内部维护一个 converter 注册表，按 `(source, target)` 组合查找对应的转换函数：

```
converters = {
  'chat_completions->messages': { body: fn, sse: fn },
  'chat_completions->responses':  { body: fn, sse: fn },
  'messages->chat_completions':   { body: fn, sse: fn },
  'messages->responses':          { body: fn, sse: fn },
  'responses->chat_completions':  { body: fn, sse: fn },
  'responses->messages':          { body: fn, sse: fn },
}
```

每个 converter 是两个纯函数：
- **body converter**：输入源格式请求体 → 输出目标格式请求体。处理字段重命名（`messages` ↔ `input`）、`system` 消息转换、参数映射
- **SSE chunk converter**：输入源格式 SSE data 行 → 输出目标格式 SSE 行。处理事件类型重映射、字段路径转换、delta 格式适配

直通组合（如 `chat_completions→chat_completions`）直接透传，不走转换。

### 请求处理规则

- Body 中无 `model` 字段时，填入配置的 `defaultModel`
- 不设置请求超时，AI 回答可能很慢
- 上游返回的错误原样返回给客户端（状态码、body 均透传）
- 未启用任何配置时返回 `503 Service Unavailable`

## 数据存储

使用 `utools.db`（PouchDB），无需额外数据库。

### 存储 Key

- `config/proxy-settings` — 代理设置
- `config/profiles` — 服务配置列表
- `config/active-profile` — 当前启用的配置 ID
- `config/models` — 全局模型列表

### 服务配置（Profile）数据结构

```json
{
  "id": "uuid",
  "name": "我的 OpenAI",
  "providerType": "openai-chat",
  "baseUrl": "https://api.openai.com",
  "apiKey": "sk-xxx",
  "defaultModel": "gpt-4o"
}
```

字段说明：

- `id`: UUID，唯一标识
- `name`: 配置名称/标签，用于 UI 显示
- `providerType`: 提供商类型，决定上游协议
- `baseUrl`: 上游服务地址（末尾无斜杠）
- `apiKey`: API 密钥（明文存储于 utools.db，UI 列表中以 `****` 掩码显示，编辑时可切换明文/掩码）
- `defaultModel`: 默认模型名称（可选，客户端未指定 model 时回填）

### 代理设置

```json
{
  "port": 9999,
  "autoStart": false
}
```

### 全局模型列表

```json
{
  "models": ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-20250514", "deepseek-chat"]
}
```

- 简单的模型 ID 字符串数组
- 在设置页面管理（增删改）
- 不区分属于哪个服务配置

## UI 界面

### 页面 1 — 主页（关键词 `ai`）

- 顶部：代理状态（运行中/已停止）+ 端口号 + 一键复制代理地址（如 `http://127.0.0.1:9999`）
- 中部：配置列表，每项显示名称、providerType 标签、当前启用高亮
- API Key 在列表中显示为 `****`（取前4后4字符中间掩码，如 `sk-o***A3b2`）
- 点击配置项 → 切换为当前启用（代理即时 reload）
- 底部：启动/停止代理按钮 + 添加配置按钮 + 设置入口

### 页面 2 — 配置编辑（关键词 `ai add` 或从主页进入）

- 表单：配置名称、提供商类型（下拉）、Base URL、API Key（输入框 + 显示/隐藏切换按钮）、默认模型（可选）
- 保存后返回主页。若当前启用的配置被编辑且代理运行中，保存后自动 reload

### 页面 3 — 设置（关键词 `ai set` 或从主页进入）

- 代理端口（默认 9999）
- 自动启动开关
- 全局模型列表管理（增删模型 ID）

## plugin.json 配置

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

- `ai`：进入主页，管理配置和代理状态
- `ai-add`：进入配置编辑页面（新建模式）。也可能从主页点击已有配置进入（编辑模式，通过 `action.payload` 传递配置 ID）
- `ai-set`：进入设置页面

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite |
| 样式 | 原生 CSS |
| Preload | Node.js（`public/preload/`，CommonJS） |
| 代理服务器 | Node.js 原生 `http` 模块 |
| 子进程通信 | `child_process.fork` + IPC message |
| 数据存储 | utools.db |

不引入 Express 等框架，保持轻量。

## 项目结构

```
ai-api-switch/
├── public/
│   ├── plugin.json
│   ├── logo.png
│   └── preload/
│       ├── package.json          # "type": "commonjs"
│       ├── services.js           # preload 入口，暴露 services API
│       ├── proxy-manager.js      # 子进程生命周期管理，IPC 传配置
│       ├── config-store.js       # utools.db 配置读写封装
│       └── proxy-server.js       # 代理服务器 + Converter Layer（子进程入口）
├── src/
│   ├── App.vue                   # 路由：onPluginEnter action.code
│   ├── main.js
│   ├── main.css
│   └── pages/
│       ├── Home/
│       │   └── index.vue
│       ├── ProfileEdit/
│       │   └── index.vue
│       └── Settings/
│           └── index.vue
├── index.html
├── vite.config.js
├── jsconfig.json
└── package.json
```

- `proxy-server.js` 通过 `child_process.fork` 启动，启动时 preload 通过 IPC `send({ type: 'init', config })` 传递配置，后续通过 `send({ type: 'reload', config })` 通知热更新
- `proxy-manager.js` 管理子进程生命周期（start/stop/restart），暴露给 services API
- `config-store.js` 封装 `utools.db` 的 CRUD 操作，供 preload 其他模块调用
- 现有 Hello/Read/Write 页面替换为 Home/ProfileEdit/Settings

## 错误处理

### 代理层

- 端口被占用 → 启动失败，UI 提示修改端口或关闭占用进程
- 上游不可达 → 返回 `502 Bad Gateway`
- 未启用配置 → 返回 `503 Service Unavailable`
- 上游错误 → 状态码和 body 原样返回客户端
- SSE 上游中途断开 → 终止 SSE 流，已传输的 chunk 保持有效

### 配置管理

- 删除当前启用的配置 → 先取消启用再删除
- 编辑启用中的配置且代理运行中 → 保存后自动 reload
- API Key 为空 → 保存时校验提示
- Base URL 末尾斜杠 → 自动去除

### 子进程管理

- 子进程异常退出 → `proxy-manager` 检测 `exit` 事件，更新 UI 状态为已停止
- uTools 插件退出 → `onPluginOut` 中主动 kill 子进程。不使用 `detached` 模式，确保子进程随插件生命周期终止
- uTools 意外崩溃 → 子进程可能遗留为孤进程。此为 uTools 平台限制，不做额外处理（重启插件时若端口被占用会提示用户）

## 扩展性

新增提供商类型只需：

1. 在 `proxy-server.js` 的 converter 注册表中添加该类型与其他格式的双向转换器（body + SSE）
2. 在 UI 的提供商类型下拉中添加选项
