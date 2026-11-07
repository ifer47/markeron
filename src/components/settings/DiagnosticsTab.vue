<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../../i18n'
import type { DiagnosticSummary } from '../../types/diagnostics'

const { t } = useI18n()

const description = ref('')
const exporting = ref(false)
const reporting = ref(false)
const revealing = ref(false)
const lastExportPath = ref<string | null>(null)
const message = ref<{ type: 'success' | 'error' | 'warn'; text: string } | null>(null)

const charCount = computed(() => description.value.length)
const maxDescription = 500

let messageTimer: ReturnType<typeof setTimeout> | null = null

function showMessage(type: 'success' | 'error' | 'warn', text: string) {
  message.value = { type, text }
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => {
    message.value = null
  }, 5000)
}

async function fetchSummary(): Promise<DiagnosticSummary | null> {
  try {
    return await invoke<DiagnosticSummary>('get_diagnostics_summary')
  } catch {
    return null
  }
}

async function exportDiagnostics() {
  if (exporting.value) return
  exporting.value = true
  message.value = null
  const summary = await fetchSummary()
  const emptyThisSession = !!summary && summary.sinceLaunch === 0
  try {
    const path = await invoke<string | null>('export_diagnostics', {
      description: description.value.trim() || null,
    })
    if (path) {
      lastExportPath.value = path
      if (emptyThisSession) {
        showMessage('warn', t('diagnostics.exportSuccessEmpty', { path }))
      } else {
        showMessage('success', t('diagnostics.exportSuccess', { path }))
      }
    } else if (emptyThisSession) {
      showMessage('warn', t('diagnostics.emptyEventsHint'))
    }
  } catch (error) {
    console.error('Export diagnostics failed:', error)
    showMessage('error', t('diagnostics.exportFailed'))
  } finally {
    exporting.value = false
  }
}

async function revealExport() {
  const path = lastExportPath.value
  if (!path || revealing.value) return
  revealing.value = true
  try {
    await invoke('reveal_diagnostics_file', { path })
  } catch (error) {
    console.error('Reveal diagnostics file failed:', error)
    showMessage('error', t('diagnostics.revealFailed'))
  } finally {
    revealing.value = false
  }
}

async function openGithubIssue() {
  if (reporting.value) return
  reporting.value = true
  message.value = null
  try {
    await invoke('open_github_issue_report', {
      title: t('diagnostics.defaultIssueTitle'),
      description: description.value.trim() || null,
    })
    showMessage('success', t('diagnostics.issueOpened'))
  } catch (error) {
    console.error('Open GitHub issue failed:', error)
    showMessage('error', t('diagnostics.issueFailed'))
  } finally {
    reporting.value = false
  }
}

onUnmounted(() => {
  if (messageTimer) clearTimeout(messageTimer)
})
</script>

<template>
  <div class="flex-1 flex flex-col px-7 py-6 overflow-y-auto settings-scroll">
    <h2 class="font-semibold settings-text-title mb-1">{{ t('diagnostics.title') }}</h2>
    <div class="mb-5">
      <p class="settings-text-body leading-[1.7] m-0">{{ t('diagnostics.intro') }}</p>
      <p class="settings-text-subtle leading-[1.6] mt-2 mb-0">
        {{ t('diagnostics.privacyNotice') }}
      </p>
    </div>

    <div class="mb-4">
      <label class="block font-medium settings-text-label mb-2" for="diag-description">
        {{ t('diagnostics.descriptionTitle') }}
      </label>
      <div class="relative">
        <textarea
          id="diag-description"
          v-model="description"
          :maxlength="maxDescription"
          rows="4"
          class="diag-textarea w-full resize-none rounded-lg px-3 py-2.5 settings-text-value outline-none transition-colors"
          :placeholder="t('diagnostics.descriptionPlaceholder')"
        />
        <span class="absolute right-2.5 bottom-2 settings-text-faint font-mono">
          {{ charCount }}/{{ maxDescription }}
        </span>
      </div>
    </div>

    <div class="flex items-center gap-2 flex-wrap">
      <button
        class="settings-btn-accent-primary px-4 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
        :disabled="exporting || reporting"
        @click="openGithubIssue"
      >
        {{ reporting ? t('diagnostics.reporting') : t('diagnostics.reportGithub') }}
      </button>
      <button
        class="settings-btn-accent-outline px-4 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
        :disabled="exporting || reporting"
        @click="exportDiagnostics"
      >
        {{ exporting ? t('diagnostics.exporting') : t('diagnostics.export') }}
      </button>
      <button
        v-if="lastExportPath"
        class="settings-btn-accent-outline px-4 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
        :disabled="revealing"
        @click="revealExport"
      >
        {{ revealing ? t('diagnostics.revealing') : t('diagnostics.revealFolder') }}
      </button>
    </div>

    <div class="min-h-9 mt-3 flex items-center">
      <Transition name="msg">
        <div
          v-if="message"
          class="px-3 py-1.5 rounded-md"
          :class="{
            'settings-msg-success': message.type === 'success',
            'settings-msg-error': message.type === 'error',
            'settings-msg-warn': message.type === 'warn',
          }"
        >
          {{ message.text }}
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.diag-textarea {
  background: var(--ui-control-bg-soft);
  border: 1px solid var(--ui-control-border);
}

.diag-textarea:focus {
  border-color: var(--ui-accent-border);
}

.msg-enter-active,
.msg-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.msg-enter-from,
.msg-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
