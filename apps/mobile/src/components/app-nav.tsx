import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { TabList, TabSlot, TabTrigger, type TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { usesNavRail, useWindowClass } from '@/layout/window-class';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** The four destinations from the template's tab bar (docs/PLAN.md §6). */
export const NAV_ITEMS = [
  { name: 'home', href: '/', label: 'Home', icon: 'home-variant-outline' },
  { name: 'spend', href: '/spend', label: 'Spend', icon: 'receipt-text-outline' },
  { name: 'alerts', href: '/alerts', label: 'Alerts', icon: 'bell-outline' },
  { name: 'more', href: '/more', label: 'More', icon: 'view-grid-outline' },
] as const satisfies readonly { name: string; href: string; label: string; icon: IconName }[];

/**
 * Responsive navigation:
 * - compact (phones, Fold 6 cover screen): bottom tab bar + floating "Add spend" button
 * - medium/expanded (unfolded Fold 6, tablets, desktop web): side rail with the add button on top
 * Re-renders live on fold/unfold or browser resize without losing tab state.
 */
export function AppNav() {
  const windowClass = useWindowClass();
  const rail = usesNavRail(windowClass);
  const insets = useSafeAreaInsets();

  const tabList = (
    <TabList
      key="tablist"
      role="tablist"
      aria-label="Main navigation"
      style={
        rail
          ? [styles.rail, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]
          : [styles.bottomBar, { paddingBottom: insets.bottom + spacing.xs }]
      }
    >
      {rail ? <RailHeader /> : null}
      {NAV_ITEMS.map((item) => (
        <TabTrigger key={item.name} name={item.name} href={item.href} asChild>
          <NavButton icon={item.icon} label={item.label} orientation={rail ? 'rail' : 'bar'} />
        </TabTrigger>
      ))}
    </TabList>
  );

  // The keys let React MOVE the tab list and content when switching layouts
  // (fold/unfold, browser resize) instead of remounting them, so screen state such
  // as a half-typed spend survives the switch.
  return (
    <Tabs style={[styles.root, { flexDirection: rail ? 'row' : 'column' }]}>
      {rail ? tabList : null}
      <View key="content" style={styles.slot}>
        <TabSlot style={styles.slot} />
        {rail ? null : <AddSpendFab />}
      </View>
      {rail ? null : tabList}
    </Tabs>
  );
}

interface NavButtonProps extends TabTriggerSlotProps {
  icon: IconName;
  label: string;
  orientation: 'bar' | 'rail';
}

type PressableRef = ComponentProps<typeof Pressable>['ref'];

function NavButton({ icon, label, orientation, isFocused, ref, ...props }: NavButtonProps) {
  const color = isFocused ? colors.primaryLight : colors.textSecondary;
  return (
    <Pressable
      {...props}
      // expo-router types the slot ref as Ref<View>; Pressable expects its own element ref.
      ref={ref as PressableRef}
      role="tab"
      aria-selected={!!isFocused}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.navButton,
        orientation === 'rail' ? styles.navButtonRail : styles.navButtonBar,
        isFocused && styles.navButtonFocused,
        pressed && styles.pressed,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={24} color={color} aria-hidden />
      <AppText variant="caption" style={{ color }} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

function RailHeader() {
  return (
    <View style={styles.railHeader}>
      <AppText variant="title" role="none">
        bdgtr
      </AppText>
      <Link href="/add" asChild>
        <Pressable
          role="button"
          accessibilityLabel="Add spend"
          style={({ pressed }) => [styles.railAdd, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="plus" size={22} color={colors.onPrimary} aria-hidden />
          <AppText variant="bodyStrong" style={{ color: colors.onPrimary }}>
            Add spend
          </AppText>
        </Pressable>
      </Link>
    </View>
  );
}

function AddSpendFab() {
  return (
    <Link href="/add" asChild>
      <Pressable
        role="button"
        accessibilityLabel="Add spend"
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="plus" size={28} color={colors.onPrimary} aria-hidden />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  slot: { flex: 1 },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  rail: {
    width: 120,
    backgroundColor: colors.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    alignItems: 'stretch',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  railHeader: { alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg },
  railAdd: {
    minHeight: MIN_TOUCH,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.button,
    backgroundColor: colors.primary,
  },
  navButton: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.button,
  },
  navButtonBar: { flex: 1, paddingVertical: spacing.xs },
  navButtonRail: { paddingVertical: spacing.md },
  navButtonFocused: { backgroundColor: colors.surfaceRaised },
  pressed: { opacity: 0.75 },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
