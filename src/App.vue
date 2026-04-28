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
  if (!window.utools) {
    // 非 uTools 环境（浏览器直接打开），显示占位提示
    route.value = 'no-utools'
    return
  }
  window.utools.onPluginEnter((action) => {
    navigate(action.code, action.payload)
    if (window.services) {
      const settings = window.services.getSettings()
      const status = window.services.getProxyStatus()
      if (settings.autoStart && status.status !== 'running') {
        window.services.startProxy().catch(() => {})
      }
    }
  })
  // 插件退出时停止代理子进程，避免遗留孤进程
  // 注意：isKill=false 仅是插件隐藏，不应停代理；isKill=true 才是进程退出
  window.utools.onPluginOut((isKill) => {
    if (isKill && window.services) {
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
  <template v-else-if="route === 'ai-add'">
    <ProfileEdit />
  </template>
  <template v-else-if="route === 'ai-set'">
    <Settings />
  </template>
  <div v-else class="placeholder">
    <p v-if="route === 'no-utools'">请在 uTools 中打开此插件</p>
  </div>
</template>

<style scoped>
.placeholder {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  color: #999;
  font-size: 14px;
}
</style>
