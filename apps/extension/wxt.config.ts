import { defineConfig } from 'wxt';
import extensionPackage from './package.json';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: '.output/chrome-mv3-dev',
  manifest: {
    name: 'Koshko Dev Tools',
    version: extensionPackage.version,
    description: 'Disposable Chrome DevTools prototype for koshko signals.',
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'Grant Koshko access to this site',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
});
