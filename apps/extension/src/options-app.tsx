import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { PANEL_MESSAGE_SYNC_ORIGINS, STORAGE_KEY } from './shared';
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
  }, []);

  const syncOrigins = async (next: string[]): Promise<void> => {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    await chrome.runtime.sendMessage({
      type: PANEL_MESSAGE_SYNC_ORIGINS,
      origins: next,
    });
    setOrigins(next);
  };
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
      const next = Array.from(
        new Set([...(await getStoredOrigins()), origin]),
      ).sort((left, right) => left.localeCompare(right));
      await syncOrigins(next);
      setInput('');
      setStatus(`Granted ${origin}. Reload the target page.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Could not grant origin.',
      );
    }
  };
  const removeOrigin = async (origin: string): Promise<void> => {
    const next = origins.filter((value) => value !== origin);
    await chrome.permissions.remove({
      origins: [originToMatchPattern(origin)],
    });
    await syncOrigins(next);
    setStatus(`Removed ${origin}.`);
  };

  return (
    <main className="shell">
      <header className="hero">
        <BrandLockup />
        <h1>Origin access</h1>
        <p className="muted">
          Grant one origin at a time, then reload the page you want to inspect.
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
              <span>Grant an origin to begin inspecting signals.</span>
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
