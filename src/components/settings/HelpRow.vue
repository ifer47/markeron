<script setup lang="ts">
import { computed } from 'vue'
import HelpTruncateLabel from './HelpTruncateLabel.vue'

const props = defineProps<{
  label: string
  tip?: string
  /** Shortcut text, e.g. `Ctrl+Shift+D`, `Q / E`, `Shift+↑↓←→`. `+` joins keys, ` / ` separates alternatives. */
  keys?: string
  /** Visible one-liner for gesture rows that have no key combination. */
  desc?: string
}>()

// Arrow clusters read better as one key cap each: `↑↓←→` → `↑` `↓` `←` `→`.
function splitPart(part: string): string[] {
  return /^[↑↓←→]+$/.test(part) ? [...part] : [part]
}

// `Ctrl+Shift+D` → [['Ctrl', 'Shift', 'D']]; `Q / E` → [['Q'], ['E']]
const combos = computed(() =>
  (props.keys ?? '')
    .split('/')
    .map((combo) =>
      combo
        .split('+')
        .map((part) => part.trim())
        .filter(Boolean)
        .flatMap(splitPart),
    )
    .filter((combo) => combo.length > 0),
)
</script>

<template>
  <div class="help-row">
    <HelpTruncateLabel :text="label" :tip="tip" />
    <div v-if="keys" class="help-keys">
      <template v-for="(combo, comboIndex) in combos" :key="comboIndex">
        <span v-if="comboIndex > 0" class="help-keys-sep">/</span>
        <span class="help-keys-combo">
          <template v-for="(part, partIndex) in combo" :key="partIndex">
            <span v-if="partIndex > 0" class="help-keys-plus">+</span>
            <kbd class="help-kbd">{{ part }}</kbd>
          </template>
        </span>
      </template>
    </div>
    <span v-else-if="desc" class="help-desc">{{ desc }}</span>
  </div>
</template>
