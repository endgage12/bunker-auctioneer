import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { setApiToken } from './lib/api';
import './style.css';

setApiToken(localStorage.getItem('auctioneer_token') ?? '');

createApp(App).use(createPinia()).use(router).mount('#app');
