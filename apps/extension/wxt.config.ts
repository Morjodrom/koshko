import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: '.output/chrome-mv3-dev',
  manifest: {
    name: 'Koshko Dev Tools',
    description: 'Disposable Chrome DevTools prototype for koshko signals.',
    permissions: ['scripting', 'storage'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  },
});
