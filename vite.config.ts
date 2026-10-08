import { defineConfig } from 'vite';

export default defineConfig({
  base: '/onni/digger/',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
