import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * false while React is hydrating the pre-rendered static web HTML, true
 * afterwards. Always true on Android (nothing to hydrate).
 *
 * The static HTML is generated at build time without knowing the screen size.
 * Anything that depends on the window (layout class, the size readout) must
 * render the build-time version first, or React reports a hydration mismatch
 * (minified error #418) and re-renders the whole page.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true, // client
    () => false, // server render + hydration pass
  );
}
