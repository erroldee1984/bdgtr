import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useWindowClass, type WindowClass } from '@/layout/window-class';
import { spacing } from '@/theme/tokens';

/**
 * Whether a screen shows its two parts side by side (docs/PLAN.md §8):
 * - 'medium': from the unfolded Fold 6 (≥ 600dp) up, for content that fits;
 * - 'expanded': only on large tablets and desktop (≥ 840dp), for forms and lists.
 */
export function isTwoPane(windowClass: WindowClass, from: 'medium' | 'expanded'): boolean {
  return from === 'medium' ? windowClass !== 'compact' : windowClass === 'expanded';
}

/**
 * Two parts of a screen: side by side when wide enough, otherwise stacked
 * (main first, unless `sideFirstWhenStacked`). The main pane is wider (`mainFlex` : 1).
 * Reading and focus order stay main then side, so screen readers and Tab
 * work the same in both layouts.
 */
export function TwoPane({
  main,
  side,
  from = 'expanded',
  mainFlex = 3,
  sideFlex = 2,
  sideFirstWhenStacked = false,
}: {
  main: ReactNode;
  side: ReactNode;
  from?: 'medium' | 'expanded';
  mainFlex?: number;
  sideFlex?: number;
  /** On narrow screens, show the side part above the main one (e.g. an edit form above its list). */
  sideFirstWhenStacked?: boolean;
}) {
  const wide = isTwoPane(useWindowClass(), from);
  if (!wide) {
    return sideFirstWhenStacked ? (
      <>
        {side}
        {main}
      </>
    ) : (
      <>
        {main}
        {side}
      </>
    );
  }
  return (
    <View style={styles.row} testID="two-pane">
      <View style={[styles.pane, { flex: mainFlex }]}>{main}</View>
      <View style={[styles.pane, { flex: sideFlex }]}>{side}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  pane: { minWidth: 0, gap: spacing.lg },
});
