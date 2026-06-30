import { createApp } from 'vue'
import App from './App.vue'
import { isMacOS } from './utils/platform'
import './style.css'

if (isMacOS()) {
  document.documentElement.classList.add('platform-macos')
}

createApp(App).mount('#app')
