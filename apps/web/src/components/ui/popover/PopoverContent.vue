<script setup lang="ts">
import { PopoverContent, useForwardPropsEmits } from 'reka-ui';
import type { PopoverContentEmits, PopoverContentProps } from 'reka-ui';
import { cn } from '../../../lib/utils';

const props = withDefaults(defineProps<PopoverContentProps>(), {
  side: 'bottom',
  align: 'center',
  sideOffset: 6,
});
const emits = defineEmits<PopoverContentEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <PopoverContent
    v-bind="forwarded"
    :class="cn(
      'z-[9999] rounded-lg border border-slate-700 bg-slate-900/95 p-3 text-slate-100 shadow-xl shadow-black/40 outline-none backdrop-blur-sm',
    )"
  >
    <slot />
  </PopoverContent>
</template>
