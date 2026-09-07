import { beforeEach, describe, expect, it } from 'vitest';
import {
  getCounter,
  getProfile,
  incrementCounter,
  incrementProfileVisits,
  resetCounter,
  resetProfile,
  setProfileName,
} from './nanostores';

describe('neutral demo Nano Stores', () => {
  beforeEach(() => {
    resetCounter();
    resetProfile();
  });

  it('exposes the counter through a getter and action-wrapped mutations', () => {
    expect(getCounter()).toBe(0);

    incrementCounter();
    incrementCounter(4);

    expect(getCounter()).toBe(5);
  });

  it('resets the counter to its initial value', () => {
    incrementCounter(7);

    resetCounter();

    expect(getCounter()).toBe(0);
  });

  it('updates the profile map through getters and mutations', () => {
    setProfileName('Grace');
    incrementProfileVisits();
    incrementProfileVisits();

    expect(getProfile()).toEqual({ name: 'Grace', visits: 2 });
  });

  it('resets every profile map value', () => {
    setProfileName('Grace');
    incrementProfileVisits();

    resetProfile();

    expect(getProfile()).toEqual({ name: 'Ada', visits: 0 });
  });
});
