const tabId = chrome.devtools.inspectedWindow.tabId;
const panelUrl = new URL(chrome.runtime.getURL('panel.html'));
panelUrl.searchParams.set('tabId', String(tabId));

chrome.devtools.panels.create('Koshko', 'icons/icon-16.png', panelUrl.toString());
