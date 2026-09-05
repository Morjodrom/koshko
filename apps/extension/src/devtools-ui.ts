const tabId = chrome.devtools.inspectedWindow.tabId;
const panelUrl = new URL(chrome.runtime.getURL('panel.html'));
panelUrl.searchParams.set('tabId', String(tabId));

chrome.devtools.panels.create('Actor Flow', '', panelUrl.toString());
