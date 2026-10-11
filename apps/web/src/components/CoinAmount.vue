<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { fmt } from '@auctioneer/shared';
import { gsap, motionOK } from '../lib/animations';
import currencyIcon from '../assets/currency.png';

const props = withDefaults(
  defineProps<{
    value: number;
    sign?: string;
    signed?: boolean;
    /** анимировать изменение: число «набегает», вспышка в цвет прибыли/убытка */
    animate?: boolean;
  }>(),
  { signed: false, animate: false },
);

/** показанное число: при animate догоняет props.value твином */
const shown = ref(props.value);
let tween: gsap.core.Tween | null = null;
const rootEl = ref<HTMLElement | null>(null);

const text = computed(() => {
  const v = props.animate ? shown.value : props.value;
  if (props.sign) return props.sign + fmt(Math.abs(v));
  if (props.signed && v > 0) return '+' + fmt(v);
  if (props.signed && v < 0) return '−' + fmt(Math.abs(v));
  return fmt(v);
});

/** куда двинулось значение — для цвета вспышки */
const direction = ref(0);

watch(
  () => props.value,
  (next, prev) => {
    if (!props.animate || !motionOK) {
      shown.value = next;
      return;
    }
    direction.value = next > prev ? 1 : next < prev ? -1 : 0;
    tween?.kill();
    const state = { v: shown.value };
    tween = gsap.to(state, {
      v: next,
      duration: Math.min(1.0, 0.35 + Math.abs(next - prev) / 300_000),
      ease: 'power2.out',
      onUpdate: () => {
        shown.value = state.v;
      },
      onComplete: () => {
        shown.value = next;
      },
    });
    // вспышка: зелёная при начислении, красная при списании
    if (rootEl.value && direction.value !== 0) {
      const color = direction.value > 0 ? 'rgba(52,211,153,0.85)' : 'rgba(251,113,133,0.85)';
      gsap.fromTo(
        rootEl.value,
        { filter: `drop-shadow(0 0 0 ${color})`, scale: 1 },
        {
          filter: `drop-shadow(0 0 12px ${color})`,
          scale: 1.12,
          duration: 0.22,
          yoyo: true,
          repeat: 1,
          ease: 'power2.out',
        },
      );
    }
  },
);

onBeforeUnmount(() => {
  tween?.kill();
  tween = null;
});
</script>

<template>
  <span ref="rootEl" class="inline-flex items-center gap-[0.35em] whitespace-nowrap">
    <img :src="currencyIcon" alt="" aria-hidden="true" class="h-[0.85em] w-[0.85em] rounded-full shrink-0" />
    <span>{{ text }}</span>
  </span>
</template>
