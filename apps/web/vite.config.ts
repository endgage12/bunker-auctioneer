import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    // не следить за временными файлами (правки через инструменты создают *.tmpdir/*.tmp —
    // их просмотр на Windows приводит к краху watcher с EBUSY)
    watch: {
      ignored: ['**/*.tmp', '**/*.tmpdir/**', '**/.tmp/**'],
    },
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
