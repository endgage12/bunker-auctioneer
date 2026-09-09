<template>
  <span class="font-mono text-sm px-2 py-1 rounded bg-slate-800 text-amber-300">{{ text }}</span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

const props = defineProps<{ deadline: number }>();

const now = ref(Date.now());
const timer = setInterval(() => {
  now.value = Date.now();
}, 250);
onBeforeUnmount(() => clearInterval(timer));

const text = computed(() => {
  const left = Math.max(0, Math.ceil((props.deadline - now.value) / 1000));
  const m = Math.floor(left / 60);
  const s = left % 60;
  return m + ':' + String(s).padStart(2, '0');
});
</script>
