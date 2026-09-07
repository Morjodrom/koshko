import { normalizeOrigin, originToMatchPattern } from './origins';
import { requestSitePermission } from './permission-coordinator';
import {
  PANEL_MESSAGE_ACTIVATE_ORIGIN,
  type ActivationResponse,
} from './shared';

export interface InspectedSite {
  origin: string;
  matchPattern: string;
}

export type PanelAccessSnapshot =
  | { supported: true; site: InspectedSite; granted: boolean }
  | { supported: false; message: string };

export type PanelGrantResult =
  | { granted: false; message: string }
  | { granted: true; captureStarted: boolean; message?: string };

export type PanelAccessChange =
  | { kind: 'navigation'; url: string }
  | { kind: 'permission-added'; origins: string[] }
  | { kind: 'permission-removed' };

export interface PanelAccessController {
  inspect(url?: string): Promise<PanelAccessSnapshot>;
  grant(site: InspectedSite): Promise<PanelGrantResult>;
  activate(site: InspectedSite): Promise<PanelGrantResult>;
  reload(): void;
  subscribe(listener: (change: PanelAccessChange) => void): () => void;
}

export function createPanelAccessController(tabId: number): PanelAccessController {
  const activate = async (site: InspectedSite): Promise<PanelGrantResult> => {
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: PANEL_MESSAGE_ACTIVATE_ORIGIN,
        origin: site.origin,
        tabId,
      });
      if (!isActivationResponse(response)) {
        return {
          granted: true,
          captureStarted: false,
          message: 'Access was granted, but the capture response was invalid.',
        };
      }
      return {
        granted: true,
        captureStarted: response.ok && response.captureStarted,
        message: response.error,
      };
    } catch (error) {
      return {
        granted: true,
        captureStarted: false,
        message: getErrorMessage(
          error,
          'Access was granted, but capture could not start.',
        ),
      };
    }
  };

  return {
    async inspect(url?: string): Promise<PanelAccessSnapshot> {
      let pageUrl: string;
      try {
        pageUrl = url ?? await getInspectedPageUrl();
      } catch (error) {
        return {
          supported: false,
          message: error instanceof Error
            ? error.message
            : 'Could not read the inspected page address.',
        };
      }

      try {
        const origin = normalizeOrigin(pageUrl);
        const matchPattern = originToMatchPattern(origin);
        const granted = await chrome.permissions.contains({
          origins: [matchPattern],
        });
        return {
          supported: true,
          site: { origin, matchPattern },
          granted,
        };
      } catch (error) {
        return {
          supported: false,
          message: error instanceof Error
            ? error.message
            : 'Koshko can inspect only http and https pages.',
        };
      }
    },

    grant(site: InspectedSite): Promise<PanelGrantResult> {
      let permissionRequest: Promise<boolean>;
      try {
        // Do not insert an await before this call: Chrome requires the request
        // to be made directly from the Grant button's user gesture.
        permissionRequest = requestSitePermission(site.origin);
      } catch (error) {
        return Promise.resolve({
          granted: false,
          message: getErrorMessage(error, 'Could not request site access.'),
        });
      }

      return permissionRequest.then(async (granted): Promise<PanelGrantResult> => {
        if (!granted) {
          return {
            granted: false,
            message: 'Access was not granted. Koshko did not read this page.',
          };
        }

        return activate(site);
      }, (error): PanelGrantResult => ({
        granted: false,
        message: getErrorMessage(error, 'Could not request site access.'),
      }));
    },

    activate,

    reload(): void {
      chrome.devtools.inspectedWindow.reload();
    },

    subscribe(listener: (change: PanelAccessChange) => void): () => void {
      const onNavigation = (url: string): void => listener({
        kind: 'navigation',
        url,
      });
      const onPermissionAdded = (permissions: chrome.permissions.Permissions): void => listener({
        kind: 'permission-added',
        origins: permissions.origins ?? [],
      });
      const onPermissionRemoved = (): void => listener({
        kind: 'permission-removed',
      });
      chrome.devtools.network.onNavigated.addListener(onNavigation);
      chrome.permissions.onAdded.addListener(onPermissionAdded);
      chrome.permissions.onRemoved.addListener(onPermissionRemoved);

      return () => {
        chrome.devtools.network.onNavigated.removeListener(onNavigation);
        chrome.permissions.onAdded.removeListener(onPermissionAdded);
        chrome.permissions.onRemoved.removeListener(onPermissionRemoved);
      };
    },
  };
}

function getInspectedPageUrl(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(
      'location.href',
      (result, exceptionInfo) => {
        if (exceptionInfo?.isException || typeof result !== 'string') {
          reject(new Error('Could not read the inspected page address.'));
          return;
        }
        resolve(result);
      },
    );
  });
}

function isActivationResponse(value: unknown): value is ActivationResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const response = value as Partial<ActivationResponse>;
  return typeof response.ok === 'boolean'
    && typeof response.captureStarted === 'boolean'
    && (response.error == null || typeof response.error === 'string');
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
