import { defineConfig } from 'wxt';
import extensionPackage from './package.json';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: '.output/chrome-mv3-dev',
  manifest: {
    name: 'Koshko Inspector',
    version: extensionPackage.version,
    description: 'Local browser DevTools inspector for koshko signals and page JavaScript errors.',
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://[::1]:*",
    },
    web_accessible_resources: [{
      resources: ['console-capture.js'],
      matches: ['http://*/*', 'https://*/*'],
    }],
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
