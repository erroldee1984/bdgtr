import { useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

/**
 * Moves keyboard focus to the screen's content, skipping the navigation. With
 * stacks and tabs several screens stay in the page (hidden), so it picks the
 * visible one. Returns whether it found one.
 */
export function focusMainContent(doc: Document | undefined = globalThis.document): boolean {
  if (!doc) return false;
  const mains = Array.from(doc.querySelectorAll<HTMLElement>('main, [role="main"]'));
  const visible = mains.find((m) => m.getClientRects().length > 0) ?? mains[0];
  if (!visible) return false;
  if (!visible.hasAttribute('tabindex')) visible.setAttribute('tabindex', '-1');
  visible.focus();
  return true;
}

/** Enter or Space on the skip link (the browser's key event, or React Native's). */
export function onSkipKey(e: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }): void {
  const key = e.key ?? e.nativeEvent?.key;
  if (key !== 'Enter' && key !== ' ') return;
  e.preventDefault?.();
  focusMainContent();
}

/**
 * "Skip to content" (WCAG 2.4.1), website only: the first thing Tab reaches.
 * Off-screen until it has keyboard focus, then shown at the top left.
 */
export function SkipToContent() {
  const [focused, setFocused] = useState(false);
  if (Platform.OS !== 'web') return null;
  return (
    <Pressable
      role="link"
      accessibilityLabel="Skip to content"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => void focusMainContent()}
      // Regression (M6b CI): react-native-web only fires onPress for clicks on a
      // role="link" with no href, so Enter did nothing for keyboard users.
      {...({ onKeyDown: onSkipKey } as Record<string, unknown>)}
      style={[styles.link, focused ? styles.shown : styles.hidden]}
      testID="skip-to-content"
    >
      <AppText variant="bodyStrong" style={styles.text}>
        Skip to content
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    position: 'absolute',
    zIndex: 1000,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    backgroundColor: colors.primary,
  },
  hidden: { left: -10000, top: spacing.sm },
  shown: { left: spacing.sm, top: spacing.sm },
  text: { color: colors.onPrimary },
});
