import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useId, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, fonts, fontSizes, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  /** Shown inside the field before the value, e.g. "₱". */
  prefix?: string;
}

/**
 * Labelled text input (WCAG 1.3.1, 3.3.2): the label is visible and tied to
 * the input; hint and error are part of its accessible description; errors are
 * text with an icon, never colour alone (1.4.1, 3.3.1). 48dp minimum height,
 * visible focus outline (2.4.7).
 */
export function TextField({ label, error, hint, prefix, ...inputProps }: TextFieldProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const description = [error, hint].filter(Boolean).join('. ');

  return (
    <View style={styles.field}>
      <AppText variant="bodyStrong" nativeID={`${id}-label`}>
        {label}
      </AppText>
      <View
        style={[
          styles.box,
          focused && styles.boxFocused,
          error ? styles.boxError : null,
        ]}
      >
        {prefix ? (
          <AppText variant="bodyStrong" tone="secondary" aria-hidden>
            {prefix}
          </AppText>
        ) : null}
        <TextInput
          {...inputProps}
          accessibilityLabel={label}
          aria-labelledby={`${id}-label`}
          accessibilityHint={description || undefined}
          aria-invalid={!!error}
          placeholderTextColor={colors.textSecondary}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
          style={styles.input}
        />
      </View>
      {error ? (
        <View style={styles.message} role="alert">
          <MaterialCommunityIcons name="alert-circle" size={18} color={colors.danger} aria-hidden />
          <AppText variant="caption" tone="danger" style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : hint ? (
        <AppText variant="caption" tone="secondary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  box: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  boxFocused: { borderColor: colors.focusRing, borderWidth: 2 },
  boxError: { borderColor: colors.danger },
  input: {
    flex: 1,
    minHeight: MIN_TOUCH,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
  },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  flex: { flex: 1 },
});
