import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

type Variant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  busy?: boolean;
  disabled?: boolean;
  /** Spoken label when the visible one needs context, e.g. "Remove Ben". */
  accessibilityLabel?: string;
  compact?: boolean;
}

/** Text button with a 48dp target (WCAG 2.5.8) and busy/disabled state exposed to screen readers. */
export function Button({ label, onPress, variant = 'secondary', icon, busy, disabled, accessibilityLabel, compact }: ButtonProps) {
  const off = !!disabled || !!busy;
  const textColor = variant === 'primary' ? colors.onPrimary : variant === 'danger' ? colors.danger : colors.primaryLight;
  return (
    <Pressable
      role="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: !!busy, disabled: off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        styles[variant],
        off && styles.off,
        pressed && styles.pressed,
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={20} color={textColor} aria-hidden /> : null}
      <AppText variant="bodyStrong" style={{ color: textColor }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  compact: { paddingHorizontal: spacing.md, alignSelf: 'flex-start' },
  primary: { backgroundColor: colors.primary },
  secondary: { borderWidth: 1, borderColor: colors.border },
  danger: { borderWidth: 1, borderColor: colors.danger },
  off: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
});
