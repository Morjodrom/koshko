import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OptionsApp } from './options-app';
import { PANEL_MESSAGE_SYNC_ORIGINS, STORAGE_KEY } from './shared';

describe('OptionsApp', () => {
  let origins: string[];
  let request: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let set: ReturnType<typeof vi.fn>;
  let sendMessage: ReturnType<typeof vi.fn>;

  afterEach(cleanup);

  beforeEach(() => {
    origins = [];
    request = vi.fn().mockResolvedValue(true);
    remove = vi.fn().mockResolvedValue(true);
    set = vi.fn(async (value: Record<string, string[]>) => {
      origins = value[STORAGE_KEY];
    });
    sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis, {
      chrome: {
        permissions: { request, remove },
        storage: {
          local: {
            get: vi.fn(async () => ({ [STORAGE_KEY]: origins })),
            set,
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
          'Granted https://a.example.test. Reload the target page.',
        ),
      ).toBeTruthy(),
    );
    expect(request).toHaveBeenCalledWith({
      origins: ['https://a.example.test/*'],
    });
    expect(set).toHaveBeenCalledWith({
      [STORAGE_KEY]: ['https://a.example.test', 'https://z.example.test'],
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: PANEL_MESSAGE_SYNC_ORIGINS,
      origins: ['https://a.example.test', 'https://z.example.test'],
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
    expect(set).toHaveBeenCalledWith({ [STORAGE_KEY]: [] });
    expect(sendMessage).toHaveBeenCalledWith({
      type: PANEL_MESSAGE_SYNC_ORIGINS,
      origins: [],
    });
  });
});
