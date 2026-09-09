import { describe, expect, it, vi } from 'vitest';
import { installNativeHostAccessLifecycle } from './native-access';

describe('native host access lifecycle', () => {
  it('requests access only while the panel is shown and refreshes after navigation', async () => {
    const shown = new FakeEvent<(panelWindow: Window) => void>();
    const hidden = new FakeEvent<() => void>();
    const navigated = new FakeEvent<(url: string) => void>();
    const addHostAccessRequest = vi.fn().mockResolvedValue(undefined);
    const removeHostAccessRequest = vi.fn().mockResolvedValue(undefined);
    const cleanup = installNativeHostAccessLifecycle(
      { onShown: shown, onHidden: hidden } as never,
      17,
      { addHostAccessRequest, removeHostAccessRequest },
      navigated,
    );

    navigated.emit('https://ignored.example.test');
    shown.emit(window);
    await flushQueue();
    expect(addHostAccessRequest).toHaveBeenCalledWith({ tabId: 17 });

    navigated.emit('https://next.example.test');
    await flushQueue();
    expect(removeHostAccessRequest).toHaveBeenCalledWith({ tabId: 17 });
    expect(addHostAccessRequest).toHaveBeenCalledTimes(2);

    hidden.emit();
    await flushQueue();
    expect(removeHostAccessRequest).toHaveBeenCalledTimes(2);

    cleanup();
    expect(shown.listenerCount).toBe(0);
    expect(hidden.listenerCount).toBe(0);
    expect(navigated.listenerCount).toBe(0);
  });

  it('is a no-op on Chrome versions without the host-access request API', () => {
    const shown = new FakeEvent<(panelWindow: Window) => void>();
    const hidden = new FakeEvent<() => void>();
    const navigated = new FakeEvent<(url: string) => void>();
    const cleanup = installNativeHostAccessLifecycle(
      { onShown: shown, onHidden: hidden } as never,
      17,
      {},
      navigated,
    );

    shown.emit(window);
    hidden.emit();
    cleanup();
  });
});

class FakeEvent<T extends (...args: never[]) => void> {
  private readonly listeners = new Set<T>();

  addListener(listener: T): void {
    this.listeners.add(listener);
  }

  removeListener(listener: T): void {
    this.listeners.delete(listener);
  }

  emit(...args: Parameters<T>): void {
    for (const listener of this.listeners) listener(...args);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

async function flushQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
