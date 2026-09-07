interface HostAccessRequest {
  tabId: number;
}

interface HostAccessPermissionsAPI {
  addHostAccessRequest?: (request: HostAccessRequest) => Promise<void> | void;
  removeHostAccessRequest?: (request: HostAccessRequest) => Promise<void> | void;
}

interface DevToolsPanelVisibility {
  onShown: chrome.events.Event<(panelWindow: Window) => void>;
  onHidden: chrome.events.Event<() => void>;
}

interface NavigationEvent {
  addListener(listener: (url: string) => void): void;
  removeListener(listener: (url: string) => void): void;
}

export function installNativeHostAccessLifecycle(
  panel: DevToolsPanelVisibility,
  tabId: number,
  permissions: HostAccessPermissionsAPI = chrome.permissions as HostAccessPermissionsAPI,
  navigation: NavigationEvent = chrome.devtools.network.onNavigated,
): () => void {
  let visible = false;
  let disposed = false;
  let queue = Promise.resolve();
  const request = { tabId };

  const enqueue = (operation: () => Promise<void> | void): void => {
    queue = queue.then(async () => {
      if (!disposed) {
        await operation();
      }
    }).catch(() => {
      // Unsupported/restricted pages should not make the DevTools page fail.
    });
  };
  const addRequest = (): void => {
    if (permissions.addHostAccessRequest) {
      enqueue(() => permissions.addHostAccessRequest!(request));
    }
  };
  const removeRequest = (): void => {
    if (permissions.removeHostAccessRequest) {
      enqueue(() => permissions.removeHostAccessRequest!(request));
    }
  };
  const onShown = (): void => {
    visible = true;
    addRequest();
  };
  const onHidden = (): void => {
    visible = false;
    removeRequest();
  };
  const onNavigated = (): void => {
    if (!visible) {
      return;
    }
    removeRequest();
    addRequest();
  };

  panel.onShown.addListener(onShown);
  panel.onHidden.addListener(onHidden);
  navigation.addListener(onNavigated);

  return () => {
    panel.onShown.removeListener(onShown);
    panel.onHidden.removeListener(onHidden);
    navigation.removeListener(onNavigated);
    visible = false;
    if (permissions.removeHostAccessRequest) {
      try {
        void Promise.resolve(permissions.removeHostAccessRequest(request)).catch(() => {});
      } catch {
        // The DevTools page may be tearing down with the API unavailable.
      }
    }
    disposed = true;
  };
}
