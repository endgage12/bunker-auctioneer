import { defineStore } from 'pinia';
import { get, setApiToken } from '../lib/api';
import type { Profile } from '@auctioneer/shared';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('auctioneer_token') ?? '',
    user: null as Profile | null,
  }),
  getters: {
    isAuthed: (s) => !!s.token,
    meId: (s) => s.user?.id ?? '',
  },
  actions: {
    setToken(token: string) {
      this.token = token;
      localStorage.setItem('auctioneer_token', token);
      setApiToken(token);
    },
    async fetchMe(): Promise<Profile> {
      const user = await get<Profile>('/api/me');
      this.user = user;
      return user;
    },
    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('auctioneer_token');
      setApiToken('');
    },
  },
});
