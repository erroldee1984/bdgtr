import { ROLE_LABELS } from '@bdgtr/shared';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/components/use-reduced-motion';

import { useHousehold } from './household-context';

/**
 * Header control showing the active household; opens a list to switch between
 * households or create another (docs/PLAN.md §3 flow 4).
 */
export function HouseholdSwitcher() {
  const { active, memberships, switchTo } = useHousehold();
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  if (!active) return null;

  return (
    <>
      <Pressable
        role="button"
        accessibilityLabel={`Household: ${active.householdName}. Switch household`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="home-group" size={20} color={colors.primaryLight} aria-hidden />
        <AppText variant="bodyStrong" numberOfLines={1} style={styles.flexShrink}>
          {active.householdName}
        </AppText>
        <MaterialCommunityIcons name="chevron-down" size={20} color={colors.textSecondary} aria-hidden />
      </Pressable>

      <Modal visible={open} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View style={styles.sheet} role="dialog" aria-modal aria-label="Your households">
          <AppText variant="title">Your households</AppText>
          <ScrollView style={styles.list}>
            {memberships.map((m) => {
              const selected = m.householdId === active.householdId;
              return (
                <Pressable
                  key={m.householdId}
                  role="radio"
                  aria-checked={selected}
                  accessibilityLabel={`${m.householdName}, ${ROLE_LABELS[m.role]}`}
                  onPress={() => {
                    switchTo(m.householdId);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
                >
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{m.householdName}</AppText>
                    <AppText variant="caption" tone="secondary">
                      {ROLE_LABELS[m.role]}
                    </AppText>
                  </View>
                  {selected ? (
                    <MaterialCommunityIcons name="check" size={22} color={colors.primaryLight} aria-hidden />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            role="button"
            onPress={() => {
              setOpen(false);
              router.push('/onboarding?mode=new');
            }}
            style={({ pressed }) => [styles.create, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="plus" size={20} color={colors.primaryLight} aria-hidden />
            <AppText variant="bodyStrong" tone="accent">
              Create another household
            </AppText>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: MIN_TOUCH,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.75 },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '20%',
    maxWidth: 480,
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  list: { maxHeight: 360 },
  row: {
    minHeight: MIN_TOUCH + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.button,
  },
  rowSelected: { backgroundColor: colors.surface },
  create: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
});
