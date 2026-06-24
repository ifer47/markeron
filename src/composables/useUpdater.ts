import { ref } from 'vue'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'up-to-date' | 'error'

const status = ref<UpdateStatus>('idle')
const newVersion = ref('')
const progress = ref(0)
const errorMessage = ref('')

let pendingUpdate: Update | null = null

export function useUpdater() {
  async function checkForUpdate(silent = false) {
    if (status.value === 'checking' || status.value === 'downloading') return

    status.value = 'checking'
    errorMessage.value = ''

    try {
      const update = await check()

      if (update) {
        pendingUpdate = update
        newVersion.value = update.version
        status.value = 'available'
      } else {
        pendingUpdate = null
        status.value = 'up-to-date'
        if (!silent) {
          setTimeout(() => {
            if (status.value === 'up-to-date') status.value = 'idle'
          }, 3000)
        }
      }
    } catch (e) {
      if (silent) {
        status.value = 'idle'
      } else {
        status.value = 'error'
        errorMessage.value = e instanceof Error ? e.message : String(e)
      }
    }
  }

  async function downloadAndInstall() {
    if (!pendingUpdate) return

    status.value = 'downloading'
    progress.value = 0

    try {
      let totalLength = 0
      let downloaded = 0

      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          totalLength = event.data.contentLength
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          if (totalLength > 0) {
            progress.value = Math.round((downloaded / totalLength) * 100)
          }
        }
      })

      await relaunch()
    } catch (e) {
      status.value = 'error'
      errorMessage.value = e instanceof Error ? e.message : String(e)
    }
  }

  return {
    status,
    newVersion,
    progress,
    errorMessage,
    checkForUpdate,
    downloadAndInstall,
  }
}
