import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: '.output/chrome-mv3-dev',
  manifest: {
    name: 'Actor Flow DevTools',
    description: 'Disposable Chrome DevTools prototype for Actor Flow signals.',
    permissions: ['scripting', 'storage'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  },
});
