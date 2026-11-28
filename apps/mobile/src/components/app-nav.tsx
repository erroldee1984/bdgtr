import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { TabList, TabSlot, TabTrigger, type TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUnreadAlerts } from '@/alerts/unread-alerts';
import { useUpdateReady } from '@/updates/update-ready';
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
  // A downloaded app update counts too: its card sits at the top of Alerts.
  const unread = useUnreadAlerts().count + (useUpdateReady().ready ? 1 : 0);

  const tabList = (
    <TabList
      key="tablist"
      testID="main-nav"
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
          <NavButton icon={item.icon} label={item.label} orientation={rail ? 'rail' : 'bar'} badge={item.name === 'alerts' ? unread : 0} />
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
  /** Unread count shown on the icon (0 = none). */
  badge?: number;
}

type PressableRef = ComponentProps<typeof Pressable>['ref'];

function NavButton({ icon, label, orientation, badge = 0, isFocused, ref, ...props }: NavButtonProps) {
  const color = isFocused ? colors.primaryLight : colors.textSecondary;
  return (
    <Pressable
      {...props}
      // expo-router types the slot ref as Ref<View>; Pressable expects its own element ref.
      ref={ref as PressableRef}
      role="tab"
      aria-selected={!!isFocused}
      accessibilityLabel={badge > 0 ? `${label}, ${badge} unread` : label}
      style={({ pressed }) => [
        styles.navButton,
        orientation === 'rail' ? styles.navButtonRail : styles.navButtonBar,
        isFocused && styles.navButtonFocused,
        pressed && styles.pressed,
      ]}
    >
      <View>
        <MaterialCommunityIcons name={icon} size={24} color={color} aria-hidden />
        {badge > 0 ? (
          <View style={styles.badge} aria-hidden>
            <AppText variant="caption" style={styles.badgeText}>
              {badge > 9 ? '9+' : String(badge)}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="caption" style={{ color }} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

/**
 * Plain buttons + router.push rather than <Link asChild>: Link's slot merges
 * styles in a way that drops a Pressable's function style ({ pressed }) => ...,
 * which left both Add spend buttons unstyled (no blue background, FAB unpositioned).
 */
function openAddSpend() {
  router.push('/add');
}

function RailHeader() {
  return (
    <View style={styles.railHeader}>
      <AppText variant="title" role="none">
        bdgtr
      </AppText>
      <Pressable
        role="button"
        accessibilityLabel="Add spend"
        onPress={openAddSpend}
        style={({ pressed }) => [styles.railAdd, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="plus" size={24} color={colors.onPrimary} aria-hidden />
        <AppText variant="caption" style={{ color: colors.onPrimary, textAlign: 'center' }}>
          Add spend
        </AppText>
      </Pressable>
    </View>
  );
}

function AddSpendFab() {
  return (
    <Pressable
      role="button"
      accessibilityLabel="Add spend"
      onPress={openAddSpend}
      style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons name="plus" size={28} color={colors.onPrimary} aria-hidden />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onPrimary, fontSize: 11, lineHeight: 14 },
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
  // TabList defaults to flexDirection 'row' + space-between (right for the bottom
  // bar); the rail must override both or everything squeezes into one row.
  rail: {
    width: 120,
    flexDirection: 'column',
    justifyContent: 'flex-start',
    backgroundColor: colors.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    alignItems: 'stretch',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  railHeader: { alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg },
  // Icon above label (like the rail's tabs) so it fits the 120dp rail at any font size.
  railAdd: {
    minHeight: MIN_TOUCH,
    alignSelf: 'stretch',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
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
