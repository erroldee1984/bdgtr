import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { colors, spacing } from '@/theme/tokens';

/** Public contact for privacy and terms questions (chosen by the owner to be shown). */
export const CONTACT_EMAIL = 'erroldee1984@gmail.com';

/**
 * Plain, readable layout for the public Privacy and Terms pages. These must be
 * reachable without signing in (Google's OAuth consent screen links to them).
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** "Last updated …" (Privacy and Terms). */
  updated?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <View style={styles.column} role="main">
        <Link href="/" style={styles.back}>
          <AppText variant="bodyStrong" tone="accent">
            ← bdgtr
          </AppText>
        </Link>
        <AppText variant="headline">{title}</AppText>
        {updated ? (
          <AppText variant="caption" tone="secondary">
            Last updated {updated}
          </AppText>
        ) : null}
        <View style={styles.body}>{children}</View>
        <View style={styles.footer}>
          <Link href="/privacy">
            <AppText tone="accent">Privacy</AppText>
          </Link>
          <Link href="/terms">
            <AppText tone="accent">Terms</AppText>
          </Link>
          <Link href="/download">
            <AppText tone="accent">Android app</AppText>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="title" aria-level={2}>
        {heading}
      </AppText>
      {children}
    </View>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <AppText tone="secondary">{children}</AppText>;
}

/** A list item: "•" by default, or a step number like "1." for steps in order. */
export function Bullet({ children, marker = '•' }: { children: ReactNode; marker?: string }) {
  return (
    <View style={styles.bullet}>
      <AppText tone="secondary" aria-hidden={marker === '•'}>
        {marker}
      </AppText>
      <AppText tone="secondary" style={styles.flex}>
        {children}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { alignItems: 'center', paddingHorizontal: spacing.lg },
  column: { width: '100%', maxWidth: 720, gap: spacing.sm },
  back: { marginBottom: spacing.lg, minHeight: 48, justifyContent: 'center' },
  body: { marginTop: spacing.lg, gap: spacing.xl },
  section: { gap: spacing.sm },
  bullet: { flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.sm },
  flex: { flex: 1 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl, marginTop: spacing.xxl },
});
