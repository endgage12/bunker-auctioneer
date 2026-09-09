<template>
  <div class="panel">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold">Журнал</h3>
      <button
        v-if="collapsible && log.length"
        class="text-xs text-slate-400 hover:text-slate-200 transition shrink-0"
        @click="open = !open"
      >
        {{ open ? 'свернуть ▴' : 'развернуть ▾' }}
      </button>
    </div>
    <p
      v-if="collapsible && !open && log.length"
      class="text-xs truncate mt-1.5"
      :class="kindClass(log[log.length - 1].kind)"
    >
      {{ log[log.length - 1].text }}
    </p>
    <div
      v-show="!collapsible || open"
      ref="list"
      class="flex flex-col gap-1 text-xs overflow-y-auto min-h-24 max-h-56 mt-1.5"
    >
      <div v-for="(e, i) in log" :key="i" :class="kindClass(e.kind)">{{ e.text }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { LogEntry } from '@auctioneer/shared';

const props = withDefaults(defineProps<{ log: LogEntry[]; collapsible?: boolean }>(), {
  collapsible: false,
});

const open = ref(false);
const list = ref<HTMLElement | null>(null);

watch(
  () => props.log.length,
  async () => {
    await nextTick();
    if (list.value) list.value.scrollTop = list.value.scrollHeight;
  },
);

function kindClass(kind: LogEntry['kind']): string {
  if (kind === 'result') return 'text-emerald-300';
  if (kind === 'reveal') return 'text-amber-200';
  if (kind === 'bid') return 'text-sky-300';
  return 'text-slate-400';
}
</script>
