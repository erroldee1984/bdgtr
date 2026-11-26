import type { ReactNode, RefObject } from 'react';
import { ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { usesNavRail, useWindowClass } from '@/layout/window-class';
import { colors, MAX_CONTENT_WIDTH, spacing } from '@/theme/tokens';

interface ScreenProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  /** Lets the screen scroll itself, e.g. back to a form that just opened at the top. */
  scrollRef?: RefObject<ScrollViewInstance | null>;
}

/**
 * Standard screen: scrolls (so 200% font size never clips content), respects
 * safe areas / camera cut-outs, and caps the content width on large screens.
 */
export function Screen({ title, subtitle, children, scrollRef }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const windowClass = useWindowClass();
  const horizontal = windowClass === 'compact' ? spacing.lg : spacing.xxl;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing.xl,
          paddingHorizontal: horizontal,
          // leave room for the bottom bar + floating button on compact layouts
          paddingBottom: usesNavRail(windowClass) ? spacing.xxl : 160,
        },
      ]}
    >
      <View style={styles.column} role="main">
        <AppText variant="headline">{title}</AppText>
        {subtitle ? (
          <AppText tone="secondary" style={styles.subtitle}>
            {subtitle}
          </AppText>
        ) : null}
        <View style={styles.body}>{children}</View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, alignItems: 'center' },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH },
  subtitle: { marginTop: spacing.xs },
  body: { marginTop: spacing.xl, gap: spacing.lg },
});
