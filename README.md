# AI API Switch

本地 AI API 统一代理/切换器，uTools 插件。提供统一的本地 HTTP 代理入口，通过 uTools 快速切换当前启用的 AI 服务配置，代理根据提供商类型做协议转换转发到上游 API。

## 功能特性

- 统一代理入口（默认 `localhost:9999`），支持 OpenAI Chat/Responses 和 Anthropic Messages 三种协议
- 自动协议转换：客户端请求格式 × 提供商类型交叉转换
- SSE 流式响应实时转换
- 全局模型列表接口（`GET /v1/models`）
- 一键切换启用的 AI 服务配置
- API Key 掩码显示与安全管理

## 快速开始

1. 在 uTools 中导入本插件
2. 输入关键字 `AI网关` 进入主页
3. 添加提供商配置（名称、类型、Base URL、API Key、默认模型）
4. 点击「启动」开启代理
5. 在客户端中设置代理地址 `http://127.0.0.1:9999`

## 关键字

| 关键字 | 功能 |
|---|---|
| `AI网关` / `gw` / `gateway` | 代理主页：切换配置、启停代理 |
| `gw add` | 添加/编辑提供商配置 |
| `gw set` | 代理设置：端口、自动启动 |

## 代理接口

代理对外暴露以下接口供客户端使用：

| 接口 | 说明 |
|---|---|
| `POST /v1/chat/completions` | OpenAI Chat Completions 格式 |
| `POST /v1/responses` | OpenAI Responses 格式 |
| `POST /v1/messages` | Anthropic Messages 格式 |
| `GET /v1/models` | 全局模型列表（OpenAI 兼容格式） |

## 提供商类型

| providerType | 上游接口 | 说明 |
|---|---|---|
| `openai-chat` | `/v1/chat/completions` | OpenAI Chat Completions API |
| `openai-response` | `/v1/responses` | OpenAI Responses API |
| `anthropic-message` | `/v1/messages` | Anthropic Messages API |

## 协议转换矩阵

代理根据客户端请求接口 × 当前启用配置的 providerType 做交叉转换：

| 客户端请求 | openai-chat | openai-response | anthropic-message |
|---|---|---|---|
| `/v1/chat/completions` | 直接转发 | 转换到 `/v1/responses` | 转换到 `/v1/messages` |
| `/v1/responses` | 转换到 `/v1/chat/completions` | 直接转发 | 转换到 `/v1/messages` |
| `/v1/messages` | 转换到 `/v1/chat/completions` | 转换到 `/v1/responses` | 直接转发 |

## 配置数据结构

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

## 技术栈

- **前端**：Vue 3 + Vite
- **Preload**：Node.js（CommonJS）
- **代理服务器**：Node.js 原生 `http` 模块
- **数据存储**：utools.db（PouchDB）

## 项目结构

```
ai-api-switch/
├── public/
│   ├── plugin.json           # uTools 插件配置
│   └── preload/
│       ├── services.js       # preload 入口
│       ├── proxy-manager.js  # 子进程生命周期管理
│       ├── config-store.js   # 配置读写封装
│       └── proxy-server.js   # 代理服务器 + 转换层
├── src/
│   ├── App.vue               # 路由入口
│   └── pages/
│       ├── Home/             # 主页
│       ├── ProfileEdit/      # 配置编辑
│       └── Settings/         # 设置
└── package.json
```
