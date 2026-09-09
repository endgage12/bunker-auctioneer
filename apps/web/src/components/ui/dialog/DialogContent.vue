<script setup lang="ts">
import { computed } from 'vue';
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, useForwardPropsEmits } from 'reka-ui';
import type { DialogContentEmits, DialogContentProps } from 'reka-ui';
import { cn } from '../../../lib/utils';

const props = defineProps<DialogContentProps & { class?: string }>();
const emits = defineEmits<DialogContentEmits>();

const delegatedProps = computed(() => {
  const { class: _class, ...delegated } = props;
  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DialogPortal>
    <DialogOverlay class="dialog-overlay fixed inset-0 z-50 bg-black/70" />
    <DialogContent
      v-bind="forwarded"
      :class="
        cn(
          'dialog-content fixed z-50 left-1/2 top-1/2 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-xl outline-none',
          props.class,
        )
      "
    >
      <DialogClose
        class="absolute right-3 top-3 z-10 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
        aria-label="Закрыть"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </DialogClose>
      <slot />
    </DialogContent>
  </DialogPortal>
</template>

<style scoped>
.dialog-overlay[data-state='open'] {
  animation: dialog-fade-in 0.2s ease;
}
.dialog-overlay[data-state='closed'] {
  animation: dialog-fade-out 0.2s ease;
}
.dialog-content[data-state='open'] {
  animation: dialog-zoom-in 0.2s ease;
}
.dialog-content[data-state='closed'] {
  animation: dialog-zoom-out 0.2s ease;
}

@keyframes dialog-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes dialog-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
@keyframes dialog-zoom-in {
  from {
    opacity: 0;
    scale: 0.96;
  }
  to {
    opacity: 1;
    scale: 1;
  }
}
@keyframes dialog-zoom-out {
  from {
    opacity: 1;
    scale: 1;
  }
  to {
    opacity: 0;
    scale: 0.96;
  }
}
</style>
