import { action } from '@nanostores/logger';
import { atom, map } from 'nanostores';

const INITIAL_COUNTER = 0;
const INITIAL_PROFILE = {
  name: 'Ada',
  visits: 0,
};

export interface DemoProfile {
  name: string;
  visits: number;
}

export const $counter = atom(INITIAL_COUNTER);
export const $profile = map<DemoProfile>(INITIAL_PROFILE);

export function getCounter(): number {
  return $counter.get();
}

export function getProfile(): DemoProfile {
  return $profile.get();
}

export const incrementCounter = action($counter, 'counter.increment', (store, amount = 1): number => {
  const nextValue = store.get() + amount;
  store.set(nextValue);
  return nextValue;
});

export const resetCounter = action($counter, 'counter.reset', (store): void => {
  store.set(INITIAL_COUNTER);
});

export const setProfileName = action($profile, 'profile.setName', (store, name: string): void => {
  store.setKey('name', name);
});

export const incrementProfileVisits = action($profile, 'profile.incrementVisits', (store): number => {
  const nextVisits = store.get().visits + 1;
  store.setKey('visits', nextVisits);
  return nextVisits;
});

export const resetProfile = action($profile, 'profile.reset', (store): void => {
  store.set({ ...INITIAL_PROFILE });
});
