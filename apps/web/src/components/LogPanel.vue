<template>
  <div class="panel flex flex-col min-h-0">
    <h3 class="text-sm font-semibold mb-2">Журнал</h3>
    <div ref="list" class="flex-1 overflow-y-auto text-xs flex flex-col gap-1 min-h-24 max-h-56">
      <div v-for="(e, i) in log" :key="i" :class="kindClass(e.kind)">{{ e.text }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { LogEntry } from '@auctioneer/shared';

const props = defineProps<{ log: LogEntry[] }>();
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
