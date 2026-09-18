import { describe, expect, it } from 'vitest';
import {
  USER_EVENT_MESSAGE,
  USER_EVENT_TRACKING_VERSION,
  getComposedPathTarget,
  parseUserEventMessage,
} from './user-event-tracking';
import { normalizeCapturedPostMessage } from './post-message';
import { KoshkoRepository } from './state/repository';

describe('user event tracking', () => {
  it('extracts the innermost Shadow DOM target from the composed path without values', () => {
    const host = document.createElement('x-action');
    const shadow = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.setAttribute('role', 'tab');
    button.textContent = 'Private account name';
    shadow.append(button);
    document.body.append(host);

    let captured: ReturnType<typeof getComposedPathTarget>;
    host.addEventListener('click', (event) => { captured = getComposedPathTarget(event); }, true);
    button.click();

    expect(captured!).toEqual({ tagName: 'button', path: ['button', 'x-action', 'body', 'html'], role: 'tab' });
    expect(JSON.stringify(captured!)).not.toContain('Private account name');
    host.remove();
  });

  it('accepts only bounded, structured tracking messages', () => {
    const message = {
      type: USER_EVENT_MESSAGE,
      version: USER_EVENT_TRACKING_VERSION,
      eventType: 'click',
      sequence: 1,
      occurredAt: 123,
      navigationId: 'nav-1',
      frameUrl: 'https://example.test/page',
      frameOrigin: 'https://example.test',
      target: { tagName: 'button', path: ['button', 'body'] },
    };

    expect(parseUserEventMessage(message)).toEqual(message);
    expect(parseUserEventMessage({ ...message, eventType: 'keydown' })).toBeUndefined();
    expect(parseUserEventMessage({ ...message, sequence: 0 })).toBeUndefined();
    expect(parseUserEventMessage({ ...message, occurredAt: -1 })).toBeUndefined();
    expect(parseUserEventMessage({ ...message, target: { tagName: 'button', path: ['x'.repeat(65)] } })).toBeUndefined();
  });

  it('normalizes validated events into the existing session export model', () => {
    const event = parseUserEventMessage({
      type: USER_EVENT_MESSAGE,
      version: USER_EVENT_TRACKING_VERSION,
      eventType: 'page-open',
      sequence: 1,
      occurredAt: 123,
      navigationId: 'nav-1',
      frameUrl: 'https://example.test/page?private=value',
      frameOrigin: 'https://example.test',
    });
    expect(event).toBeDefined();
    const captured = normalizeCapturedPostMessage({
      id: 'user-event:nav-1:1', sequence: event!.sequence, observedAt: 123,
      origin: event!.frameOrigin, source: 'self',
      data: { type: USER_EVENT_MESSAGE, version: event!.version, eventType: event!.eventType },
      tabId: 1, frameId: 0, navigationId: event!.navigationId,
      frameUrl: event!.frameUrl, frameOrigin: event!.frameOrigin,
    });
    expect(captured).toBeDefined();

    const repository = new KoshkoRepository();
    repository.record(captured!);
    const [metadata, entry] = repository.exportJsonl().split('\n').map((line) => JSON.parse(line));

    expect(metadata).toMatchObject({ count: 1, postMessageCount: 1 });
    expect(entry).toMatchObject({
      data: { type: USER_EVENT_MESSAGE, eventType: 'page-open' },
      frameUrl: 'https://example.test/page',
    });
  });

});
