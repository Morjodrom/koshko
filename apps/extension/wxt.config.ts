import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: '.output/chrome-mv3-dev',
  manifest: {
    name: 'Koshko Dev Tools',
    description: 'Disposable Chrome DevTools prototype for actor-flow signals.',
    permissions: ['scripting', 'storage'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  },
});
