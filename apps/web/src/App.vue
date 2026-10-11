<template>
  <div class="h-full min-h-screen bg-slate-950 text-slate-100">
    <router-view />
    <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      <TransitionGroup name="toast">
        <div
          v-for="t in gameStore.toasts"
          :key="t.id"
          :ref="(el) => setToastEl(el as Element | null)"
          class="toast-item px-4 py-2 rounded-lg text-sm shadow-lg pointer-events-auto relative overflow-hidden"
          :class="t.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-100'"
        >
          {{ t.text }}
          <!-- полоска жизни тоста: видно, сколько он ещё провисит -->
          <span
            class="toast-life absolute bottom-0 left-0 h-[2px] w-full"
            :class="t.kind === 'error' ? 'bg-rose-300/70' : 'bg-amber-400/70'"
          ></span>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useGameStore } from './stores/game';
import { gsap, motionOK } from './lib/animations';

const gameStore = useGameStore();
const toastEls = ref<HTMLElement[]>([]);
/** v-for с TransitionGroup: собираем узлы вручную */
function setToastEl(el: Element | null): void {
  if (!el) {
    toastEls.value = [];
    return;
  }
  const node = el as HTMLElement;
  if (!toastEls.value.includes(node)) toastEls.value.push(node);
}
/** сколько миллисекунд тост живёт (синхронно с pushToast в сторе) */
const TOAST_LIFE_MS = 4000;

/** Новые тосты въезжают снизу и «проживают» полоску до исчезновения. */
function animateToasts(): void {
  if (!motionOK) return;
  for (const el of toastEls.value) {
    if (!el || el.dataset.animated === '1') continue;
    el.dataset.animated = '1';
    gsap.fromTo(
      el,
      { y: 18, opacity: 0, scale: 0.94 },
      { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(1.7)' },
    );
    const life = el.querySelector('.toast-life');
    if (life) {
      gsap.fromTo(life, { scaleX: 1 }, { scaleX: 0, duration: TOAST_LIFE_MS / 1000, ease: 'none' });
    }
  }
}

watch(() => gameStore.toasts.length, () => void Promise.resolve().then(animateToasts));
onMounted(animateToasts);
</script>

<style scoped>
/* leave-анимацию ведёт GSAP через хук TransitionGroup */
.toast-leave-active {
  transition: none;
}
.toast-leave-to {
  opacity: 0;
}
.toast-move {
  transition: transform 0.25s ease;
}
.toast-item {
  transform-origin: center bottom;
}
</style>
