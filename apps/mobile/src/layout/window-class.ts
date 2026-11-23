import { useWindowDimensions } from 'react-native';

/**
 * Material 3 window size classes (docs/PLAN.md §8).
 * - compact  (< 600dp):  phones, Galaxy S24 FE, Fold 6 cover screen → bottom tabs
 * - medium   (600–839):  small tablets, landscape phones           → bottom tabs, wider content
 * - expanded (≥ 840):    unfolded Fold 6, tablets, desktop web     → side rail, two panes
 */
export type WindowClass = 'compact' | 'medium' | 'expanded';

export const MEDIUM_MIN_WIDTH = 600;
export const EXPANDED_MIN_WIDTH = 840;

export function windowClassFor(width: number): WindowClass {
  if (!Number.isFinite(width) || width < 0) return 'compact';
  if (width >= EXPANDED_MIN_WIDTH) return 'expanded';
  if (width >= MEDIUM_MIN_WIDTH) return 'medium';
  return 'compact';
}

/** Re-renders live when the window changes: folding/unfolding, rotation, browser resize. */
export function useWindowClass(): WindowClass {
  const { width } = useWindowDimensions();
  return windowClassFor(width);
}
