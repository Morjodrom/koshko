import { connectNanoStores } from '@koshko/nanostores';
import { logger } from '@nanostores/logger';
import { $counter, $profile } from './nanostores';

/**
 * Installs development-only integrations. This module is dynamically imported
 * behind `import.meta.env.DEV`, so its dependencies stay out of production
 * bundles in applications that use the same pattern.
 */
export function startDevtools(): () => void {
  const stores = {
    counter: $counter,
    profile: $profile,
  };
  const disconnectNanoStores = connectNanoStores(stores);
  const disconnectNanoStoresLogger = logger(stores);

  return () => {
    disconnectNanoStores();
    disconnectNanoStoresLogger();
  };
}
