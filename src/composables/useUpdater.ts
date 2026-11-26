import { ref } from 'vue'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { isInstalledMode } from '../utils/portable'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'up-to-date' | 'error'

/**
 * Let the "installing" message paint before the installer takes over and this
 * process exits (Windows). The installer then owns the UI until the relaunch.
 */
const INSTALL_HANDOFF_DELAY_MS = 1500
/** Marker so the relaunched build can confirm the update once. */
const PENDING_UPDATE_KEY = 'markeron:pending-update-version'

const status = ref<UpdateStatus>('idle')
const newVersion = ref('')
const progress = ref(0)
const errorMessage = ref('')

let pendingUpdate: Update | null = null

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function rememberUpdateTarget(version: string) {
  try {
    storage()?.setItem(PENDING_UPDATE_KEY, version)
  } catch {
    /* storage unavailable — the post-update notice is optional */
  }
}

/**
 * Clears the pending marker and returns the version only when this app now runs
 * the build that was just installed, so the notice is shown exactly once.
 */
export function consumeUpdatedVersion(currentVersion: string): string | null {
  const store = storage()
  if (!store) return null
  try {
    const target = store.getItem(PENDING_UPDATE_KEY)
    if (!target) return null
    store.removeItem(PENDING_UPDATE_KEY)
    return target === currentVersion ? target : null
  } catch {
    return null
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export function useUpdater() {
  async function checkForUpdate(silent = false) {
    if (status.value === 'checking' || status.value === 'downloading' || status.value === 'installing') return
    // Only run NSIS-oriented updater when we know this is a normal install.
    if (!(await isInstalledMode())) return

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
    // Two clicks in the same tick could otherwise download twice on one Update.
    if (status.value === 'downloading' || status.value === 'installing') return
    if (!(await isInstalledMode())) return

    const update = pendingUpdate
    status.value = 'downloading'
    progress.value = 0

    try {
      let totalLength = 0
      let downloaded = 0

      await update.download((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          totalLength = event.data.contentLength
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          if (totalLength > 0) {
            progress.value = Math.round((downloaded / totalLength) * 100)
          }
        }
      })

      // Show the handoff state instead of freezing at "100%": on Windows the
      // installer replaces this process, so this is the last frame we own.
      progress.value = 100
      status.value = 'installing'
      rememberUpdateTarget(update.version)
      await delay(INSTALL_HANDOFF_DELAY_MS)

      await update.install()
      // Never reached on Windows: install() exits the process. On macOS the
      // bundle is already swapped, so restart into the new build.
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
