<script setup lang="ts">
import { computed } from 'vue';
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, useForwardPropsEmits } from 'reka-ui';
import type { DialogContentEmits, DialogContentProps } from 'reka-ui';
import { cn } from '../../../lib/utils';

export type SheetSide = 'top' | 'bottom' | 'left' | 'right';

const props = withDefaults(defineProps<DialogContentProps & { side?: SheetSide; class?: string }>(), {
  side: 'left',
});
const emits = defineEmits<DialogContentEmits>();

const delegatedProps = computed(() => {
  const { class: _class, side: _side, ...delegated } = props;
  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);

const sideClass: Record<SheetSide, string> = {
  top: 'inset-x-0 top-0 border-b',
  bottom: 'inset-x-0 bottom-0 border-t',
  left: 'inset-y-0 left-0 h-full w-72 max-w-[85vw] border-r',
  right: 'inset-y-0 right-0 h-full w-72 max-w-[85vw] border-l',
};
</script>

<template>
  <DialogPortal>
    <DialogOverlay class="sheet-overlay fixed inset-0 z-50 bg-black/70" />
    <DialogContent
      v-bind="forwarded"
      :data-side="props.side"
      :class="
        cn(
          'sheet-content fixed z-50 flex flex-col bg-slate-900 text-slate-100 shadow-xl outline-none',
          sideClass[props.side],
          props.class,
        )
      "
    >
      <DialogClose
        class="absolute right-3 top-3 z-10 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
        aria-label="Закрыть меню"
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
.sheet-overlay[data-state='open'] {
  animation: sheet-fade-in 0.25s ease;
}
.sheet-overlay[data-state='closed'] {
  animation: sheet-fade-out 0.25s ease;
}

.sheet-content[data-side='left'][data-state='open'] {
  animation: sheet-in-left 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.sheet-content[data-side='left'][data-state='closed'] {
  animation: sheet-out-left 0.25s ease-in;
}
.sheet-content[data-side='right'][data-state='open'] {
  animation: sheet-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.sheet-content[data-side='right'][data-state='closed'] {
  animation: sheet-out-right 0.25s ease-in;
}
.sheet-content[data-side='top'][data-state='open'] {
  animation: sheet-in-top 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.sheet-content[data-side='top'][data-state='closed'] {
  animation: sheet-out-top 0.25s ease-in;
}
.sheet-content[data-side='bottom'][data-state='open'] {
  animation: sheet-in-bottom 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.sheet-content[data-side='bottom'][data-state='closed'] {
  animation: sheet-out-bottom 0.25s ease-in;
}

@keyframes sheet-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes sheet-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
@keyframes sheet-in-left {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}
@keyframes sheet-out-left {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-100%);
  }
}
@keyframes sheet-in-right {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
@keyframes sheet-out-right {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(100%);
  }
}
@keyframes sheet-in-top {
  from {
    transform: translateY(-100%);
  }
  to {
    transform: translateY(0);
  }
}
@keyframes sheet-out-top {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-100%);
  }
}
@keyframes sheet-in-bottom {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
@keyframes sheet-out-bottom {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(100%);
  }
}
</style>
