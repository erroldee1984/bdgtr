import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, radius, spacing } from '@/theme/tokens';

import { useReducedMotion } from './use-reduced-motion';

/**
 * A small modal dialog: title, content, and a row of buttons. Back (Android),
 * Escape (web) and a tap outside all close it. Exposed as role="dialog" with
 * aria-modal, so screen readers stay inside it.
 */
export function Dialog({
  visible,
  title,
  onClose,
  children,
  actions,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.centre}>
        <View style={styles.sheet} role="dialog" aria-modal aria-label={title}>
          <AppText variant="title">{title}</AppText>
          {children ? <ScrollView style={styles.body}>{children}</ScrollView> : null}
          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center', paddingTop: '20%', paddingHorizontal: spacing.lg, pointerEvents: 'box-none' },
  sheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  body: { maxHeight: 360 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
});
