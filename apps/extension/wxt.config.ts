import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: '.output/chrome-mv3-dev',
  manifest: {
    name: 'Koshko Dev Tools',
    description: 'Disposable Chrome DevTools prototype for koshko signals.',
    permissions: ['scripting', 'storage'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
});
