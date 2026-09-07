import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  PANEL_MESSAGE_ACTIVATE_ORIGIN,
  PANEL_MESSAGE_RECONCILE_PERMISSIONS,
} from './shared';
import { getStoredOrigins } from './registry';
import { normalizeOrigin, originToMatchPattern } from './origins';
import { BrandLockup, Icon } from './brand';

export function OptionsApp(): ReactElement {
  const [origins, setOrigins] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const refreshOrigins = async (): Promise<void> =>
    setOrigins(await getStoredOrigins());

  useEffect(() => {
    void refreshOrigins();
    const onPermissionChange = (): void => {
      void refreshOrigins();
    };
    chrome.permissions.onAdded.addListener(onPermissionChange);
    chrome.permissions.onRemoved.addListener(onPermissionChange);

    return () => {
      chrome.permissions.onAdded.removeListener(onPermissionChange);
      chrome.permissions.onRemoved.removeListener(onPermissionChange);
    };
  }, []);

  const grantOrigin = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    try {
      const origin = normalizeOrigin(input.trim());
      const granted = await chrome.permissions.request({
        origins: [originToMatchPattern(origin)],
      });
      if (!granted) {
        setStatus('Permission was not granted.');
        return;
      }
      await chrome.runtime.sendMessage({
        type: PANEL_MESSAGE_ACTIVATE_ORIGIN,
        origin,
      });
      await refreshOrigins();
      setInput('');
      setStatus(`Granted ${origin}. Reload the target frame to capture its startup events.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Could not grant origin.',
      );
    }
  };
  const removeOrigin = async (origin: string): Promise<void> => {
    await chrome.permissions.remove({
      origins: [originToMatchPattern(origin)],
    });
    await chrome.runtime.sendMessage({
      type: PANEL_MESSAGE_RECONCILE_PERMISSIONS,
    });
    await refreshOrigins();
    setStatus(`Removed ${origin}.`);
  };

  return (
    <main className="shell">
      <header className="hero">
        <BrandLockup />
        <h1>Origin access</h1>
        <p className="muted">
          The panel and toolbar can grant the current site. Use this page for
          cross-origin frames or to review and remove access.
        </p>
      </header>
      <form id="origin-form" className="card" onSubmit={grantOrigin}>
        <label className="field">
          <span>Origin</span>
          <input
            id="origin-input"
            type="url"
            placeholder="https://example.com"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <div className="actions">
          <button type="submit" className="primary">
            <Icon name="plus" className="button-icon" />
            Grant origin
          </button>
        </div>
        <p className="muted">
          Chrome site permissions apply to this scheme and hostname on every
          port.
        </p>
        <p id="status" className="status muted">
          {status}
        </p>
      </form>
      <section className="card">
        <div className="section-header">
          <h2>Granted origins</h2>
        </div>
        <ul id="origin-list" className="list">
          {origins.length === 0 ? (
            <li className="empty empty-with-icon">
              <Icon name="activity" className="state-icon" />
              <p>No origins granted yet.</p>
              <span>Open Koshko in DevTools or grant a frame origin here.</span>
            </li>
          ) : (
            origins.map((origin) => (
              <li className="list-row" key={origin}>
                <span>{origin}</span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void removeOrigin(origin)}
                >
                  <Icon name="trash" className="button-icon" />
                  Remove
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </main>
  );
}
