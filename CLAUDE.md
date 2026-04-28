# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

uTools 插件 — 本地 AI API 统一代理/切换器。提供统一的本地 HTTP 代理入口（默认 `localhost:9999`），通过 uTools UI 快速切换当前启用的 AI 服务配置，代理根据 providerType 做协议转换转发到上游 API。

## Commands

```bash
npm run dev      # 启动 Vite 开发服务器（端口 5173）
npm run build    # 构建生产版本
```

无测试框架、无 linter 配置。

## Architecture

三层架构，通过 uTools preload bridge 连接：

- **UI 层**（`src/`）：Vue 3 + Vite，原生 CSS。`App.vue` 根据 uTools `onPluginEnter` 的 `action.code` 路由到不同页面组件
- **Preload 层**（`public/preload/`）：Node.js，通过 `window.services` 向渲染进程注入 Node 能力。注意 `preload/package.json` 使用 `"type": "commonjs"`
- **Proxy 层**（子进程）：Node.js 原生 `http` 模块，不使用 Express。通过 `child_process.fork` 启动，IPC 通信接收 reload 指令

### 数据存储

使用 `utools.db`（PouchDB），存储 key：
- `config/proxy-settings` — 代理设置（port, autoStart）
- `config/profiles` — 服务配置列表
- `config/active-profile` — 当前启用的配置 ID
- `config/models` — 全局模型列表

### 请求转换矩阵

代理对外暴露 `/v1/chat/completions`、`/v1/messages`、`/v1/models` 三种接口。根据客户端请求接口 × 当前启用配置的 `providerType`（`openai-chat`、`openai-response`、`anthropic-message`）做交叉协议转换。

## Key Files

- `public/plugin.json` — uTools 插件配置（features、cmds、preload 路径）
- `docs/superpowers/specs/2026-04-28-ai-api-switch-design.md` — 完整设计文档，包含数据结构、转换矩阵、UI 规划、错误处理规则

## uTools Development

`plugin.json` 中 `"development.main": "http://localhost:5173"` 使 uTools 开发模式连接 Vite dev server。在 uTools 中导入项目目录即可调试。
