import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, fonts, fontSizes } from '@/theme/tokens';

type Variant = 'display' | 'headline' | 'title' | 'body' | 'bodyStrong' | 'caption';
type Tone = 'primary' | 'secondary' | 'danger' | 'success' | 'accent';

export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

/**
 * Text with the design-system font and colour. Font scaling is left ON so
 * Android "Font size" and browser zoom work (WCAG 1.4.4); layouts must reflow.
 */
export function AppText({ variant = 'body', tone = 'primary', style, ...props }: AppTextProps) {
  const isHeading = variant === 'display' || variant === 'headline' || variant === 'title';
  return (
    <Text
      role={isHeading ? 'heading' : undefined}
      {...props}
      style={[styles.base, styles[variant], toneStyles[tone], style]}
    />
  );
}

const styles = StyleSheet.create({
  base: { color: colors.textPrimary },
  display: { fontFamily: fonts.heading, fontSize: fontSizes.display, lineHeight: 48 },
  headline: { fontFamily: fonts.heading, fontSize: fontSizes.headline, lineHeight: 36 },
  title: { fontFamily: fonts.headingSemi, fontSize: fontSizes.title, lineHeight: 28 },
  body: { fontFamily: fonts.body, fontSize: fontSizes.body, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.bodySemi, fontSize: fontSizes.body, lineHeight: 24 },
  caption: { fontFamily: fonts.bodyMedium, fontSize: fontSizes.caption, lineHeight: 18 },
});

const toneStyles = StyleSheet.create({
  primary: { color: colors.textPrimary },
  secondary: { color: colors.textSecondary },
  danger: { color: colors.danger },
  success: { color: colors.success },
  accent: { color: colors.primaryLight },
});
