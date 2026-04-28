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
