<script setup lang="ts">
import { computed } from 'vue';
import { fmt } from '@auctioneer/shared';
import currencyIcon from '../assets/currency.png';

const props = withDefaults(
  defineProps<{ value: number; sign?: string; signed?: boolean }>(),
  { signed: false },
);

const text = computed(() => {
  if (props.sign) return props.sign + fmt(Math.abs(props.value));
  if (props.signed && props.value > 0) return '+' + fmt(props.value);
  if (props.signed && props.value < 0) return '−' + fmt(Math.abs(props.value));
  return fmt(props.value);
});
</script>

<template>
  <span class="inline-flex items-center gap-[0.35em] whitespace-nowrap">
    <img :src="currencyIcon" alt="" aria-hidden="true" class="h-[0.85em] w-[0.85em] rounded-full shrink-0" />
    <span>{{ text }}</span>
  </span>
</template>
