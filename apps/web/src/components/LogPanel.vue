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
      <div v-for="(e, i) in log" :key="i" data-log-row :class="kindClass(e.kind)">{{ e.text }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { gsap, motionOK } from '../lib/animations';
import type { LogEntry } from '@auctioneer/shared';

const props = withDefaults(defineProps<{ log: LogEntry[]; collapsible?: boolean }>(), {
  collapsible: false,
});

const open = ref(false);
const list = ref<HTMLElement | null>(null);

/**
 * Новые записи журнала подсвечиваются вспышкой по типу события:
 * результат — зелёная, ставка — голубая, реплика — сиреневая.
 */
function flashEntries(els: HTMLElement[], kind: string): void {
  if (!motionOK || els.length === 0) return;
  const color =
    kind === 'result'
      ? 'rgba(52,211,153,0.7)'
      : kind === 'bid'
        ? 'rgba(56,189,248,0.7)'
        : kind === 'chat'
          ? 'rgba(232,121,249,0.7)'
          : 'rgba(251,191,36,0.6)';
  gsap.fromTo(
    els,
    { backgroundColor: 'rgba(0,0,0,0)', x: -6 },
    {
      backgroundColor: color,
      x: 0,
      duration: 0.3,
      stagger: 0.03,
      yoyo: true,
      repeat: 1,
      ease: 'power2.out',
      clearProps: 'backgroundColor,x',
    },
  );
}

watch(
  () => props.log.length,
  async (len, prevLen) => {
    await nextTick();
    if (list.value) list.value.scrollTop = list.value.scrollHeight;
    // подсвечиваем именно те записи, что добавились
    const added = Math.max(0, len - (prevLen ?? 0));
    if (added === 0 || !list.value) return;
    const rows = [...list.value.querySelectorAll<HTMLElement>('[data-log-row]')].slice(-added);
    const last = props.log[props.log.length - 1];
    flashEntries(rows, last?.kind ?? 'system');
  },
);

function kindClass(kind: LogEntry['kind']): string {
  if (kind === 'result') return 'text-emerald-300';
  if (kind === 'reveal') return 'text-amber-200';
  if (kind === 'bid') return 'text-sky-300';
  if (kind === 'chat') return 'text-fuchsia-300';
  return 'text-slate-400';
}
</script>
