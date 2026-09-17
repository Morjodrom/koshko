import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OptionsApp } from './options-app';
import {
  PANEL_MESSAGE_ACTIVATE_ORIGIN,
  PANEL_MESSAGE_RECONCILE_PERMISSIONS,
  STORAGE_KEY,
} from '../messaging/messages';
import {
  EXTENSION_MESSAGE_RULES_STORAGE_KEY,
  defaultExtensionMessageRulesConfig,
} from '../extension-message-rules';

describe('OptionsApp', () => {
  let origins: string[];
  let request: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let set: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let storedRules: unknown;
  let storageChangeListener: ((
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => void) | undefined;

  afterEach(cleanup);

  beforeEach(() => {
    origins = [];
    storedRules = undefined;
    storageChangeListener = undefined;
    request = vi.fn().mockResolvedValue(true);
    remove = vi.fn(async (permission: { origins: string[] }) => {
      const removed = new Set(permission.origins.map((pattern) => pattern.replace(/\/\*$/, '')));
      origins = origins.filter((origin) => !removed.has(origin));
      return true;
    });
    set = vi.fn(async (value: Record<string, unknown>) => {
      if (Array.isArray(value[STORAGE_KEY])) origins = value[STORAGE_KEY] as string[];
      if (EXTENSION_MESSAGE_RULES_STORAGE_KEY in value) {
        storedRules = value[EXTENSION_MESSAGE_RULES_STORAGE_KEY];
      }
    });
    sendMessage = vi.fn(async (message: { type: string; origin?: string }) => {
      if (message.type === PANEL_MESSAGE_ACTIVATE_ORIGIN && message.origin) {
        origins = Array.from(new Set([...origins, message.origin])).sort();
      }
      return { ok: true };
    });
    Object.assign(globalThis, {
      chrome: {
        permissions: {
          request,
          remove,
          onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
          onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
        },
        storage: {
          local: {
            get: vi.fn(async (defaults: Record<string, unknown>) => ({
              ...defaults,
              [STORAGE_KEY]: origins,
              ...(storedRules === undefined ? {} : {
                [EXTENSION_MESSAGE_RULES_STORAGE_KEY]: storedRules,
              }),
            })),
            set,
          },
          onChanged: {
            addListener: vi.fn((listener: typeof storageChangeListener) => { storageChangeListener = listener; }),
            removeListener: vi.fn(),
          },
        },
        runtime: { sendMessage },
      },
    });
  });

  it('renders empty and stored origins', async () => {
    const { unmount } = render(<OptionsApp />);
    await waitFor(() =>
      expect(screen.getByText('No origins granted yet.')).toBeTruthy(),
    );
    unmount();
    origins = ['https://b.example.test', 'https://a.example.test'];
    render(<OptionsApp />);
    await waitFor(() =>
      expect(screen.getByText('https://a.example.test')).toBeTruthy(),
    );
    expect(screen.getByText('https://b.example.test')).toBeTruthy();
  });

  it('grants an origin, stores a sorted list, and synchronizes the runtime', async () => {
    origins = ['https://z.example.test'];
    render(<OptionsApp />);
    await waitFor(() =>
      expect(screen.getByText('https://z.example.test')).toBeTruthy(),
    );
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'https://a.example.test/path' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Grant origin' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          'Granted https://a.example.test. Reload the target frame to capture its startup events.',
        ),
      ).toBeTruthy(),
    );
    expect(request).toHaveBeenCalledWith({
      origins: ['https://a.example.test/*'],
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: PANEL_MESSAGE_ACTIVATE_ORIGIN,
      origin: 'https://a.example.test',
    });
  });

  it('reports denied and invalid grants', async () => {
    request.mockResolvedValue(false);
    render(<OptionsApp />);
    await waitFor(() =>
      expect(screen.getByText('No origins granted yet.')).toBeTruthy(),
    );
    const input = screen.getByPlaceholderText('https://example.com');
    fireEvent.change(input, {
      target: { value: 'https://denied.example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Grant origin' }));
    await waitFor(() =>
      expect(screen.getByText('Permission was not granted.')).toBeTruthy(),
    );
    fireEvent.change(input, {
      target: { value: 'mailto:test@example.test' },
    });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(
        screen.getByText('Only http and https origins can be granted.'),
      ).toBeTruthy(),
    );
  });

  it('removes the origin from permissions, storage, and runtime synchronization', async () => {
    origins = ['https://remove.example.test'];
    render(<OptionsApp />);
    await waitFor(() =>
      expect(screen.getByText('https://remove.example.test')).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        screen.getByText('Removed https://remove.example.test.'),
      ).toBeTruthy(),
    );
    expect(remove).toHaveBeenCalledWith({
      origins: ['https://remove.example.test/*'],
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: PANEL_MESSAGE_RECONCILE_PERMISSIONS,
    });
  });

  it('does not delete a rule while an edited required field is invalid', async () => {
    render(<OptionsApp />);
    await waitFor(() => expect(screen.getByDisplayValue('React DevTools')).toBeTruthy());

    const nameInput = screen.getAllByDisplayValue('React DevTools')[0];
    fireEvent.change(nameInput, { target: { value: '' } });

    expect(screen.getByText('Rule not saved: complete all fields with valid values.')).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
    expect((nameInput as HTMLInputElement).value).toBe('');
  });

  it('loads defaults and supports add, typed editing, enable, and delete persistence', async () => {
    render(<OptionsApp />);
    await waitFor(() => expect(screen.getByDisplayValue('React DevTools')).toBeTruthy());
    expect(screen.getByDisplayValue('PIXI DevTools')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(screen.getByDisplayValue('New extension')).toBeTruthy());
    expect((storedRules as { rules: unknown[] }).rules).toHaveLength(3);

    const matchSelects = screen.getAllByLabelText('Match');
    fireEvent.change(matchSelects[2], { target: { value: 'equals' } });
    const typeSelects = screen.getAllByLabelText('Value type');
    fireEvent.change(typeSelects[2], { target: { value: 'boolean' } });
    expect((screen.getAllByLabelText('Value')[2] as HTMLInputElement).value).toBe('false');

    fireEvent.click(screen.getAllByLabelText('Enabled')[2]);
    await waitFor(() => expect(
      (storedRules as { rules: Array<{ enabled: boolean; value?: unknown }> }).rules[2],
    ).toMatchObject({ enabled: false, value: false }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[2]);
    await waitFor(() => expect((storedRules as { rules: unknown[] }).rules).toHaveLength(2));
  });

  it('applies live stored changes and resets the complete rule list after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<OptionsApp />);
    await waitFor(() => expect(storageChangeListener).toBeTypeOf('function'));

    storageChangeListener?.({
      [EXTENSION_MESSAGE_RULES_STORAGE_KEY]: {
        newValue: {
          version: 1,
          rules: [{
            id: 'custom',
            name: 'Custom Tool',
            enabled: true,
            path: 'meta.tool',
            operator: 'equals',
            value: 'custom',
          }],
        },
      },
    }, 'local');
    expect(await screen.findByDisplayValue('Custom Tool')).toBeTruthy();
    expect(screen.queryByDisplayValue('React DevTools')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset all rules to defaults' }));

    await waitFor(() => expect(screen.getByDisplayValue('React DevTools')).toBeTruthy());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(storedRules).toEqual(defaultExtensionMessageRulesConfig());
    confirm.mockRestore();
  });

  it('falls back to defaults when stored configuration is unusable', async () => {
    storedRules = { version: 99, rules: [{ nope: true }] };

    render(<OptionsApp />);

    expect(await screen.findByDisplayValue('React DevTools')).toBeTruthy();
    expect(screen.getByDisplayValue('PIXI DevTools')).toBeTruthy();
  });
});
