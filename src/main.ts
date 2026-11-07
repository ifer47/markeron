import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { installDiagnosticCapture } from './utils/installDiagnosticCapture'

installDiagnosticCapture()
createApp(App).mount('#app')
