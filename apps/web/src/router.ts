import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'lobby', component: () => import('./views/LobbyView.vue') },
    { path: '/market', name: 'market', component: () => import('./views/MarketView.vue') },
    { path: '/inventory', name: 'inventory', component: () => import('./views/InventoryView.vue') },
    { path: '/hideout', name: 'hideout', component: () => import('./views/HideoutView.vue') },
    { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue') },
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue') },
    { path: '/game/:code', name: 'game', component: () => import('./views/GameView.vue') },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.name !== 'login' && !auth.isAuthed) return { name: 'login' };
  if (to.name === 'login' && auth.isAuthed && !to.query.token && !to.query.error) return { name: 'lobby' };
  return true;
});

export default router;
