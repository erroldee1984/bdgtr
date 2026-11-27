import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { colors, MIN_TOUCH } from '@/theme/tokens';

/**
 * Back to the previous screen, or to the dashboard when there is none: a page
 * opened straight from its URL (refresh, bookmark, typed address, a shared
 * link) has no history, and a plain back() would do nothing and strand people.
 */
export function goBackOrHome(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** Header back button that always works, with or without history (WCAG 2.4.5, 48dp target). */
export function HeaderBackButton() {
  return (
    <Pressable
      role="button"
      accessibilityLabel="Back"
      onPress={goBackOrHome}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textPrimary} aria-hidden />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  pressed: { opacity: 0.7 },
});
