<template>
  <span
    ref="el"
    class="font-mono text-sm px-2 py-1 rounded transition-colors"
    :class="urgent ? 'bg-rose-950 text-rose-300' : 'bg-slate-800 text-amber-300'"
  >
    {{ text }}
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { gsap, motionOK } from '../lib/animations';

const props = defineProps<{ deadline: number }>();

const now = ref(Date.now());
const el = ref<HTMLElement | null>(null);
const timer = setInterval(() => {
  now.value = Date.now();
}, 250);
onBeforeUnmount(() => clearInterval(timer));

const secondsLeft = computed(() => Math.max(0, Math.ceil((props.deadline - now.value) / 1000)));

/** Последние 10 секунд — время поджимает */
const urgent = computed(() => secondsLeft.value > 0 && secondsLeft.value <= 10);

const text = computed(() => {
  const left = secondsLeft.value;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return m + ':' + String(s).padStart(2, '0');
});

// На последних секундах бейдж пульсирует — заметно боковым зрением
watch(urgent, (on) => {
  if (!motionOK || !el.value) return;
  gsap.killTweensOf(el.value);
  if (on) {
    gsap.to(el.value, { scale: 1.08, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  } else {
    gsap.to(el.value, { scale: 1, duration: 0.2 });
  }
});

onBeforeUnmount(() => {
  if (el.value) gsap.killTweensOf(el.value);
});
</script>
