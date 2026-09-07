import { describe, expect, it } from 'vitest';
import {
  registerPanelPort,
  type BackgroundPanelPort,
  type PanelPortsByTab,
} from './panel-port-router';
import { PANEL_MESSAGE_HEARTBEAT, PANEL_MESSAGE_READY, PANEL_PORT_PREFIX } from './shared';

class FakeBackgroundPanelPort implements BackgroundPanelPort {
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  readonly events: string[] = [];
  readonly messages: unknown[] = [];

  constructor(readonly name: string) {}

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void): void => {
      this.events.push('message-listener');
      this.messageListeners.add(listener);
    },
  };

  readonly onDisconnect = {
    addListener: (listener: () => void): void => {
      this.events.push('disconnect-listener');
      this.disconnectListeners.add(listener);
    },
  };

  postMessage(message: unknown): void {
    this.events.push('ready');
    this.messages.push(message);
  }

  disconnect(): void {
    this.disconnectListeners.forEach((listener) => listener());
  }

  emitMessage(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }
}

describe('registerPanelPort', () => {
  it('registers listeners and the port before sending ready', () => {
    const ports: PanelPortsByTab = new Map();
    const port = new FakeBackgroundPanelPort(`${PANEL_PORT_PREFIX}17`);

    expect(registerPanelPort(port, ports)).toBe('registered');

    expect(port.events).toEqual(['message-listener', 'disconnect-listener', 'ready']);
    expect(ports.get(17)).toEqual(new Set([port]));
    expect(port.messages).toEqual([{ type: PANEL_MESSAGE_READY }]);
  });

  it('accepts heartbeat messages without changing registration', () => {
    const ports: PanelPortsByTab = new Map();
    const port = new FakeBackgroundPanelPort(`${PANEL_PORT_PREFIX}17`);
    registerPanelPort(port, ports);

    port.emitMessage({ type: PANEL_MESSAGE_HEARTBEAT });
    port.emitMessage({ type: 'unexpected' });

    expect(ports.get(17)).toEqual(new Set([port]));
    expect(port.messages).toEqual([{ type: PANEL_MESSAGE_READY }]);
  });

  it('removes only the disconnected panel while retaining another panel for its tab', () => {
    const ports: PanelPortsByTab = new Map();
    const first = new FakeBackgroundPanelPort(`${PANEL_PORT_PREFIX}17`);
    const second = new FakeBackgroundPanelPort(`${PANEL_PORT_PREFIX}17`);
    registerPanelPort(first, ports);
    registerPanelPort(second, ports);

    first.disconnect();

    expect(ports.get(17)).toEqual(new Set([second]));
    second.disconnect();
    expect(ports.has(17)).toBe(false);
  });

  it('distinguishes unrelated ports from malformed panel ports', () => {
    const ports: PanelPortsByTab = new Map();
    const unrelated = new FakeBackgroundPanelPort('another-feature');
    const malformed = new FakeBackgroundPanelPort(`${PANEL_PORT_PREFIX}not-a-tab`);

    expect(registerPanelPort(unrelated, ports)).toBe('ignored');
    expect(registerPanelPort(malformed, ports)).toBe('invalid');
    expect(ports.size).toBe(0);
    expect(unrelated.events).toEqual([]);
    expect(malformed.events).toEqual([]);
  });
});
