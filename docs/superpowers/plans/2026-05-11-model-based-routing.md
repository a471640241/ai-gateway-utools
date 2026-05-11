# 基于模型 ID 的自动提供商路由

## Context

当前代理每次只能激活一个 profile，客户端调用时必须在 UI 手动切换。改为：同时启用多个提供商，每个提供商配置可用模型列表，客户端请求时代理按首页列表顺序匹配 model → profile，匹配到即调用，报错直接返回不 fallback。全局模型列表保留不变。

## 实施步骤

### Step 1: config-store.js — 新增多选启用 + 排序 API

**文件**: `public/preload/config-store.js`

新增：
- `getActiveProfiles(): string[]` — 从 `config/active-profiles` 读取已启用的 profile ID 列表
- `setActiveProfiles(ids: string[])` — 保存启用的 profile ID 列表
- `reorderProfiles(orderedIds: string[])` — 按 orderedIds 重排 profiles 数组并保存到 `config/profiles`

DB Key: `config/active-profiles`，数据格式 `{ ids: ['id1', 'id2'] }`

保留原有 `getActiveProfile` / `setActiveProfile` 不删除（不破坏旧数据）。

### Step 2: proxy-server.js — 核心路由改造

**文件**: `public/preload/proxy-server.js`

**currentConfig 格式变更**：
```js
// 旧: { profile: {...}, settings, models }
// 新: { profiles: [...], settings, models }
```
profiles 数组由 preload 层按 active-profiles 的顺序过滤拼装好传入。

**`handleApiRequest` 改造**：
1. 读取 `body.model`
2. 若 `body.model` 为空且只有一个 profile → 用该 profile 的 `defaultModel`
3. 遍历 `currentConfig.profiles`（按首页排列顺序）：
   - 跳过 `profile.models` 为空数组的 profile（不参与路由）
   - 检查 `profile.models.includes(body.model)`
   - 匹配 → 用该 profile 的 providerType 做协议转换并转发
4. 所有 profile 都不匹配 → 503 `{ error: "No provider available for model: xxx" }`
5. 不做 fallback，上游错误原样返回

**`handleModels` 改造**：
- 收集所有已启用 profile 的 `models` 字段的去重并集
- 合并全局 `currentConfig.models`（保留不变）
- 返回聚合后的完整列表

### Step 3: proxy-manager.js — 适配 config 传递格式

**文件**: `public/preload/proxy-manager.js`

`start()` 和 `reload()` 中：
```js
// 旧
const profile = configStore.getActiveProfile()
child.send({ type: 'init', config: { profile, settings, models } })

// 新
const activeIds = configStore.getActiveProfiles()
const allProfiles = configStore.getProfiles()
const profiles = activeIds.map(id => allProfiles.find(p => p.id === id)).filter(Boolean)
child.send({ type: 'init', config: { profiles, settings, models } })
```

### Step 4: services.js — 暴露新 API

**文件**: `public/preload/services.js`

新增：
- `getActiveProfiles()` → `configStore.getActiveProfiles()`
- `setActiveProfiles(ids)` → `configStore.setActiveProfiles(ids)` + reload
- `reorderProfiles(ids)` → `configStore.reorderProfiles(ids)` + reload
- `toggleProfile(id, enabled)` — 切换启用/禁用并 reload

### Step 5: ProfileEdit/index.vue — 增加可用模型多选配置

**文件**: `src/pages/ProfileEdit/index.vue`

在「默认模型」字段下方增加「可用模型」区域：

- **获取模型按钮**：复用 `fetchProviderModels()`，拉取上游模型列表
- **多选 Modal**：复用 Home 页的 checkbox modal 模式（搜索、全选、反选）
- **已选模型展示**：chip 标签形式，每个有 × 删除按钮
- **手动输入**：输入框 + 回车添加
- `form.value.models = []` 默认空数组

UI 位置：在默认模型下方，结构为：
```
可用模型 (可选)
┌─────────────────────────────────┐
│ [chip1 ×] [chip2 ×] [chip3 ×]  │
│ [输入模型 ID 回车添加]  [获取模型]│
└─────────────────────────────────┘
```

### Step 6: Home/index.vue — 多选启用 + 拖拽排序

**文件**: `src/pages/Home/index.vue`

**移除**：
- `activeProfileId` 单选逻辑
- `selectProfile(id)` 单选方法

**新增**：
- `activeProfileIds: ref([])` — 已启用的 profile ID 列表
- `toggleProfile(id)` — 切换启用/禁用
- `loadData()` 中读取 `getActiveProfiles()`

**UI 改造**：
- 原 radio 圆点 → checkbox 复选框（已启用打勾）
- 点击 checkbox 区域切换启用，不再需要点击整行
- 每行增加拖拽手柄（≡ 图标），左侧显示

**拖拽排序**：原生 HTML5 drag & drop
- `draggable="true"` 在 provider-row 上
- `@dragstart` 记录拖拽源 index
- `@dragover` 计算插入位置，显示插入指示线
- `@drop` 重排 profiles 数组 → 调用 `reorderProfiles(ids)` → reload

**显示增强**：
- 每个 provider-row 显示已配置的模型数量（如「12 个模型」），或者显示前 2-3 个模型名

**数据迁移**：
- `loadData()` 中检查：如果 `activeProfileIds` 为空但旧的 `activeProfileId` 存在 → 自动迁移为 `setActiveProfiles([oldId])`

## 关键决策

- 全局模型列表：完全保留，`/v1/models` 返回全局模型 + 各已启用提供商模型的并集
- 空 models 的提供商：不参与路由匹配
- 无 fallback：匹配到哪个就用哪个，报错直接返回
- 旧数据兼容：`loadData` 时自动从 `active-profile` 迁移到 `active-profiles`

## 验证

1. `npm run build` 无编译错误
2. uTools 开发模式测试：
   - 创建 2 个提供商，分别配置不同模型列表
   - 首页启用多个，拖拽排序
   - curl 请求匹配模型 → 验证路由到正确提供商
   - 请求不匹配的模型 → 503
   - 空 models 提供商 → 不匹配任何模型
   - `/v1/models` 返回全局 + 聚合模型
