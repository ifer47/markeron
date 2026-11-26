import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { installContextMenuGuard } from './utils/contextMenuGuard'
import { installDiagnosticCapture } from './utils/installDiagnosticCapture'
import { migrateToolbarPositionsToLocalStorage } from './utils/toolbarPosition'

installDiagnosticCapture()
// Packaged builds hide the WebView's browser context menu (Reload / Inspect).
if (import.meta.env.PROD) installContextMenuGuard()

// Restore the toolbar position before the first paint so an update cannot make
// the panel jump from its default corner to the saved spot.
void migrateToolbarPositionsToLocalStorage().finally(() => {
  createApp(App).mount('#app')
})
