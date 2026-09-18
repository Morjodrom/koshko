import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  PANEL_MESSAGE_ACTIVATE_ORIGIN,
  PANEL_MESSAGE_RECONCILE_PERMISSIONS,
} from '../messaging/messages';
import { getStoredOrigins } from '../browser/registry';
import { normalizeOrigin, originToMatchPattern } from '../browser/origins';
import {
  defaultExtensionMessageRulesConfig,
  getStoredExtensionMessageRules,
  MAX_EXTENSION_MESSAGE_RULES,
  MAX_EXTENSION_RULE_TEXT_LENGTH,
  normalizeExtensionMessageRules,
  setStoredExtensionMessageRules,
  subscribeToStoredExtensionMessageRules,
  type ExtensionMessageRule,
  type ExtensionMessageRuleOperator,
  type ExtensionMessageRuleScalar,
} from '../extension-message-rules';
import { BrandLockup, Icon } from './brand';
import {
  getUserEventTrackingEnabled,
  setUserEventTrackingEnabled,
  USER_EVENT_TRACKING_STORAGE_KEY,
} from '../user-event-tracking';

export function OptionsApp(): ReactElement {
  const [origins, setOrigins] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [rulesStatus, setRulesStatus] = useState('');
  const [userEventTrackingEnabled, setUserEventTrackingEnabledState] = useState(false);
  const [rules, setRules] = useState<ExtensionMessageRule[]>(() =>
    [...defaultExtensionMessageRulesConfig().rules],
  );
  const refreshOrigins = async (): Promise<void> =>
    setOrigins(await getStoredOrigins());

  useEffect(() => {
    void refreshOrigins();
    void getStoredExtensionMessageRules().then((config) => setRules(config.rules));
    void getUserEventTrackingEnabled().then(setUserEventTrackingEnabledState);
    const onPermissionChange = (): void => {
      void refreshOrigins();
    };
    chrome.permissions.onAdded.addListener(onPermissionChange);
    chrome.permissions.onRemoved.addListener(onPermissionChange);
    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
      if (areaName === 'local' && changes[USER_EVENT_TRACKING_STORAGE_KEY]) {
        setUserEventTrackingEnabledState(changes[USER_EVENT_TRACKING_STORAGE_KEY].newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    const unsubscribeRules = chrome.storage.onChanged
      ? subscribeToStoredExtensionMessageRules((config) => setRules(config.rules))
      : () => undefined;

    return () => {
      chrome.permissions.onAdded.removeListener(onPermissionChange);
      chrome.permissions.onRemoved.removeListener(onPermissionChange);
      chrome.storage.onChanged.removeListener(onStorageChange);
      unsubscribeRules();
    };
  }, []);

  const persistRules = async (nextRules: ExtensionMessageRule[]): Promise<void> => {
    const config = await setStoredExtensionMessageRules(nextRules);
    setRules(config.rules);
    setRulesStatus('Message filtering rules saved.');
  };
  const updateRule = (id: string, patch: Partial<ExtensionMessageRule>): void => {
    const next = rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule);
    setRules(next);
    const normalized = normalizeExtensionMessageRulesForEditor(next);
    if (!normalized) {
      setRulesStatus('Rule not saved: complete all fields with valid values.');
      return;
    }
    void persistRules(next);
  };
  const addRule = (): void => {
    const id = `custom-${newRuleId()}`;
    void persistRules([...rules, {
      id,
      name: 'New extension',
      enabled: true,
      path: 'source',
      operator: 'starts-with',
      value: 'extension-',
    }]);
  };
  const deleteRule = (id: string): void => {
    void persistRules(rules.filter((rule) => rule.id !== id));
  };
  const resetRules = (): void => {
    if (!window.confirm('Reset all message filtering rules to defaults?')) return;
    void persistRules([...defaultExtensionMessageRulesConfig().rules]);
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
      <section className="card">
        <div className="section-header">
          <div>
            <h2>Page interaction tracking</h2>
            <p className="muted">When enabled, Koshko records page opens plus click, change, and submit metadata. It never records typed values or field contents.</p>
          </div>
          <label>
            <input
              aria-label="Enable page interaction tracking"
              type="checkbox"
              checked={userEventTrackingEnabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                setUserEventTrackingEnabledState(enabled);
                void setUserEventTrackingEnabled(enabled);
              }}
            /> Enable tracking
          </label>
        </div>
      </section>
      <section className="card message-rules">
        <div className="section-header">
          <div>
            <h2>Message filtering</h2>
            <p className="muted">Hide known browser-extension messages from the panel. Rules are signatures and may be spoofed by page code.</p>
          </div>
          <div className="actions">
            <button type="button" className="ghost" onClick={resetRules}>Reset all rules to defaults</button>
            <button type="button" className="primary" onClick={addRule} disabled={rules.length >= MAX_EXTENSION_MESSAGE_RULES}><Icon name="plus" className="button-icon" />Add rule</button>
          </div>
        </div>
        <ul className="list" aria-label="Message filtering rules">
          {rules.length === 0 ? <li className="empty">No rules configured. Unknown messages remain visible.</li> : rules.map((rule) => (
            <li className="message-rule" key={rule.id}>
              <div className="message-rule-grid">
                <label className="field"><span>Name</span><input maxLength={MAX_EXTENSION_RULE_TEXT_LENGTH} value={rule.name} onChange={(event) => updateRule(rule.id, { name: event.target.value })} /></label>
                <label className="field"><span>Path</span><input maxLength={MAX_EXTENSION_RULE_TEXT_LENGTH} value={rule.path} onChange={(event) => updateRule(rule.id, { path: event.target.value })} placeholder="source or meta.kind" /></label>
                <label className="field"><span>Match</span><select value={rule.operator} onChange={(event) => updateRule(rule.id, { operator: event.target.value as ExtensionMessageRuleOperator, value: event.target.value === 'exists' ? undefined : (event.target.value === 'starts-with' ? (typeof rule.value === 'string' && rule.value ? rule.value : 'extension-') : (rule.value ?? '')) })}><option value="starts-with">starts with</option><option value="equals">equals</option><option value="exists">exists</option></select></label>
                {rule.operator !== 'exists' && <>
                  <label className="field"><span>Value type</span><select value={rule.value === null ? 'null' : typeof rule.value} onChange={(event) => updateRule(rule.id, { value: defaultValueForType(event.target.value) })}><option value="string">text</option>{rule.operator !== 'starts-with' && <><option value="number">number</option><option value="boolean">boolean</option><option value="null">null</option></>}</select></label>
                  <label className="field"><span>Value</span><input maxLength={MAX_EXTENSION_RULE_TEXT_LENGTH} value={rule.value === null || rule.value === undefined ? '' : String(rule.value)} disabled={rule.value === null} onChange={(event) => updateRule(rule.id, { value: coerceRuleValue(event.target.value, typeof rule.value) })} /></label>
                </>}
              </div>
              <div className="message-rule-actions">
                <label><input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} /> Enabled</label>
                <button type="button" className="ghost" onClick={() => deleteRule(rule.id)}><Icon name="trash" className="button-icon" />Delete</button>
              </div>
            </li>
          ))}
        </ul>
        <p className="status muted" aria-live="polite">{rulesStatus}</p>
      </section>
    </main>
  );
}

function coerceRuleValue(value: string, previousType: string): ExtensionMessageRuleScalar {
  if (previousType === 'number') {
    const number = Number(value);
    return Number.isFinite(number) && value !== '' ? number : 0;
  }
  if (previousType === 'boolean') return value === 'true';
  return value;
}

function defaultValueForType(type: string): ExtensionMessageRuleScalar {
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  return '';
}

function newRuleId(): string {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Some extension test environments do not expose crypto.randomUUID.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeExtensionMessageRulesForEditor(rules: ExtensionMessageRule[]): ExtensionMessageRule[] | null {
  const normalized = normalizeExtensionMessageRules({ version: 1, rules });
  if (normalized.rules.length !== rules.length) return null;
  for (const rule of rules) {
    const normalizedRule = normalized.rules.find((candidate) => candidate.id === rule.id);
    if (!normalizedRule || JSON.stringify(normalizedRule) !== JSON.stringify(rule)) return null;
  }
  return normalized.rules;
}
