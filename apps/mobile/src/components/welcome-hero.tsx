import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { colors, spacing } from '@/theme/tokens';

/**
 * The template's welcome screen: dark navy with large blue arcs, a headline
 * and the sign-in action. The arcs are decorative (hidden from screen readers).
 * Scrolls so large font sizes never clip the button.
 *
 * placement:
 * - 'bottom' (Android): like the template, headline and a single button low on
 *   the screen, within thumb reach.
 * - 'center' (web): Clerk's sign-in form is tall, so content is centred
 *   vertically instead of being pushed to the bottom.
 */
export function WelcomeHero({
  children,
  placement = 'bottom',
}: {
  children: ReactNode;
  placement?: 'bottom' | 'center';
}) {
  const centered = placement === 'center';
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={styles.arcs} aria-hidden pointerEvents="none">
        <View style={[styles.arc, styles.arcTop]} />
        <View style={[styles.arc, styles.arcLeft]} />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          centered && styles.contentCentered,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl },
        ]}
      >
        <View style={styles.column} role="main">
          <AppText variant="display" style={!centered && styles.headlineBottom}>
            Your household budget, together
          </AppText>
          <AppText tone="secondary" style={styles.lead}>
            Track spending, set budgets and get alerts with everyone at home.
          </AppText>
          <View style={styles.actions}>{children}</View>
        </View>
      </ScrollView>
    </View>
  );
}

const ARC = 360;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  arcs: { ...StyleSheet.absoluteFill },
  arc: { position: 'absolute', width: ARC, height: ARC, borderRadius: ARC / 2, borderWidth: 56 },
  arcTop: { top: -120, right: -140, borderColor: colors.primary, opacity: 0.55 },
  arcLeft: { top: 180, left: -230, borderColor: colors.primaryLight, opacity: 0.35 },
  content: { flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: spacing.xl },
  contentCentered: { justifyContent: 'center' },
  column: { width: '100%', maxWidth: 480, gap: spacing.md },
  headlineBottom: { marginTop: 220 },
  lead: { marginBottom: spacing.lg },
  actions: { gap: spacing.md },
});
