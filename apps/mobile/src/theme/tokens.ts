/**
 * Design tokens taken from the template (dark navy, blue gradient accents).
 * Contrast of every text/background pairing is enforced by
 * src/theme/__tests__/tokens-test.ts (WCAG 2.2 AA). See docs/PLAN.md §7 and §9.
 */

export const colors = {
  bg: '#12152B',
  surface: '#1B1F3A',
  surfaceRaised: '#242949',
  border: '#3A4070',

  /** Template's #4F8CFF fails 4.5:1 on surfaceRaised (4.39), so it's nudged lighter. */
  primary: '#5A94FF',
  primaryLight: '#7FB8FF',
  /** Text/icons placed on a `primary` filled button */
  onPrimary: '#0B1020',

  textPrimary: '#FFFFFF',
  /** Lightened from the template's grey, which fails 4.5:1 */
  textSecondary: '#A9B0D0',

  success: '#4ADE80',
  danger: '#FF6B6B',

  focusRing: '#7FB8FF',
} as const;

export type ColorToken = keyof typeof colors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  button: 12,
  card: 16,
  pill: 999,
} as const;

/** Minimum touch target in dp (Material guidance; exceeds WCAG 2.5.8's 24×24). */
export const MIN_TOUCH = 48;

/** Widest content column on large screens (desktop web, unfolded Fold). */
export const MAX_CONTENT_WIDTH = 1200;

export const fonts = {
  heading: 'Poppins_700Bold',
  headingSemi: 'Poppins_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
} as const;

export const fontSizes = {
  caption: 13,
  body: 16,
  title: 20,
  headline: 28,
  display: 40,
} as const;
