import { describe, expect, it } from 'vitest';
import {
  USER_EVENT_MESSAGE,
  USER_EVENT_TRACKING_VERSION,
  getComposedPathTarget,
  getUserEventDisplayName,
  normalizeCapturedUserEvent,
  parseUserEventMessage,
} from './user-event-tracking';
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
      frameUrl: 'https://example.test/page?private=value',
      frameOrigin: 'https://example.test',
      target: { tagName: 'button', path: ['button', 'body'] },
    };

    expect(parseUserEventMessage(message)).toEqual(message);
    expect(parseUserEventMessage({ ...message, eventType: 'keydown' })).toBeUndefined();
    expect(parseUserEventMessage({ ...message, sequence: 0 })).toBeUndefined();
    expect(parseUserEventMessage({ ...message, occurredAt: -1 })).toBeUndefined();
    expect(parseUserEventMessage({ ...message, target: { tagName: 'button', path: ['x'.repeat(65)] } })).toBeUndefined();
  });

  it('selects semantic names without html and supports targetless page-open', () => {
    expect(getUserEventDisplayName('click', { tagName: 'button', path: ['button', 'html'], role: 'tab' })).toBe('click · button[role=tab]');
    expect(getUserEventDisplayName('page-open')).toBe('page-open');
  });

  it('normalizes validated events as first-class export entries', () => {
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
    const capturedInput = {
      kind: 'event',
      id: 'user-event:nav-1:1',
      sequence: event!.sequence,
      observedAt: 123,
      eventType: event!.eventType,
      tabId: 1,
      frameId: 0,
      navigationId: event!.navigationId,
      frameUrl: event!.frameUrl,
      frameOrigin: event!.frameOrigin,
    };
    const captured = normalizeCapturedUserEvent(capturedInput);
    expect(captured).toBeDefined();
    expect(normalizeCapturedUserEvent({ ...capturedInput, kind: 'post-message' })).toBeUndefined();
    expect(normalizeCapturedUserEvent({ ...capturedInput, documentId: '' })).toBeUndefined();
    expect(normalizeCapturedUserEvent({
      ...capturedInput,
      target: { tagName: 'button', path: ['x'.repeat(65)] },
    })).toBeUndefined();

    const repository = new KoshkoRepository();
    repository.record(captured!);
    const [metadata, entry] = repository.exportJsonl().split('\n').map((line) => JSON.parse(line));

    expect(metadata).toMatchObject({ count: 1, eventCount: 1, postMessageCount: 0 });
    expect(entry).toMatchObject({
      kind: 'event',
      eventType: 'page-open',
      frameUrl: 'https://example.test/page?private=value',
    });
  });
});
