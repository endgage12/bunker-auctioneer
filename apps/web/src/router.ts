import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'lobby', component: () => import('./views/LobbyView.vue') },
    { path: '/market', name: 'market', component: () => import('./views/MarketView.vue') },
    { path: '/inventory', name: 'inventory', component: () => import('./views/InventoryView.vue') },
    { path: '/santa', name: 'santa', component: () => import('./views/SantaView.vue') },
    { path: '/sets', name: 'sets', component: () => import('./views/HideoutView.vue') },
    // старый адрес раздела «Убежище» — редирект на «Сеты»
    { path: '/hideout', redirect: '/sets' },
    { path: '/library', name: 'library', component: () => import('./views/LibraryView.vue') },
    { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue') },
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue') },
    { path: '/game/:code', name: 'game', component: () => import('./views/GameView.vue') },
    { path: '/profile/:id', name: 'profile', component: () => import('./views/ProfileView.vue') },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.name !== 'login' && !auth.isAuthed) return { name: 'login' };
  if (to.name === 'login' && auth.isAuthed && !to.query.token && !to.query.error) return { name: 'lobby' };
  return true;
});

export default router;
