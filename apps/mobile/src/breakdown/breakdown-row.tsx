import { type Category, formatPHP, type Transaction } from '@bdgtr/shared';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef } from 'react';
import { type AccessibilityActionEvent, Platform, Pressable, StyleSheet, View } from 'react-native';
import Swipeable, { type SwipeableMethods, SwipeDirection } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { AppText } from '@/components/app-text';
import { colors, MIN_TOUCH, spacing } from '@/theme/tokens';

const DAY = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "2026-11-03" → "Nov 3". */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return DAY.format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export type RowAction = 'details' | 'pin' | 'delete' | 'menu';

/** What a screen reader hears for a row. */
export function rowLabel(tx: Transaction, categoryName: string, pinned: boolean): string {
  return `${shortDate(tx.date)}, ${categoryName}, ${formatPHP(tx.amountMinor)}${pinned ? ', pinned' : ''}`;
}

/**
 * One spend: Date · Category · Cost (docs/PLAN.md §6.8). Tap shows its
 * description. Swipe right pins or unpins; swipe left asks to delete (only
 * when `canDelete`). Non-swipe ways in: long-press or right-click opens the
 * menu, a visible "⋯" button when `showMenuButton`, and screen-reader actions.
 */
export function BreakdownRow({
  tx,
  category,
  pinned,
  canDelete,
  showMenuButton,
  onAction,
}: {
  tx: Transaction;
  category: Category | undefined;
  pinned: boolean;
  canDelete: boolean;
  showMenuButton: boolean;
  onAction: (action: RowAction, tx: Transaction) => void;
}) {
  const swipe = useRef<SwipeableMethods>(null);
  const name = category?.name ?? 'Unknown category';
  const label = rowLabel(tx, name, pinned);

  const actions = [
    { name: 'activate', label: 'Show description' },
    { name: 'pin', label: pinned ? 'Unpin' : 'Pin' },
    ...(canDelete ? [{ name: 'delete', label: 'Delete' }] : []),
  ];

  function onAccessibilityAction(e: AccessibilityActionEvent) {
    const n = e.nativeEvent.actionName;
    if (n === 'activate') onAction('details', tx);
    else if (n === 'pin') onAction('pin', tx);
    else if (n === 'delete' && canDelete) onAction('delete', tx);
  }

  function onSwipeableOpen(direction: SwipeDirection) {
    swipe.current?.close();
    if (direction === SwipeDirection.RIGHT) onAction('pin', tx);
    else if (canDelete) onAction('delete', tx);
  }

  // Right-click on the web opens the same menu as a long-press.
  const webProps =
    Platform.OS === 'web'
      ? {
          onContextMenu: (e: { preventDefault: () => void }) => {
            e.preventDefault();
            onAction('menu', tx);
          },
        }
      : {};

  return (
    <Swipeable
      ref={swipe}
      friction={2}
      leftThreshold={64}
      rightThreshold={64}
      overshootLeft={false}
      overshootRight={false}
      onSwipeableOpen={onSwipeableOpen}
      renderLeftActions={() => (
        <View style={[styles.action, styles.pinAction]} aria-hidden>
          <MaterialCommunityIcons name={pinned ? 'pin-off' : 'pin'} size={22} color={colors.onPrimary} />
          <AppText variant="bodyStrong" style={styles.onPrimary}>
            {pinned ? 'Unpin' : 'Pin'}
          </AppText>
        </View>
      )}
      {...(canDelete
        ? {
            renderRightActions: () => (
              <View style={[styles.action, styles.deleteAction]} aria-hidden>
                <AppText variant="bodyStrong" style={styles.onPrimary}>
                  Delete
                </AppText>
                <MaterialCommunityIcons name="trash-can-outline" size={22} color={colors.onPrimary} />
              </View>
            ),
          }
        : {})}
    >
      <View style={styles.row} testID="breakdown-row">
        <Pressable
          role="button"
          accessibilityLabel={label}
          accessibilityHint="Shows the description. More actions in the actions menu."
          accessibilityActions={actions}
          onAccessibilityAction={onAccessibilityAction}
          onPress={() => onAction('details', tx)}
          onLongPress={() => onAction('menu', tx)}
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}
          {...webProps}
        >
          <AppText style={styles.date}>{shortDate(tx.date)}</AppText>
          <View style={styles.category}>
            {category ? <MaterialCommunityIcons name={category.icon} size={20} color={category.colour} aria-hidden /> : null}
            <AppText numberOfLines={1} style={styles.flexShrink}>
              {name}
            </AppText>
            {pinned ? <MaterialCommunityIcons name="pin" size={16} color={colors.primaryLight} aria-hidden testID="pin-icon" /> : null}
          </View>
          <AppText variant="bodyStrong" style={styles.cost}>
            {formatPHP(tx.amountMinor)}
          </AppText>
        </Pressable>
        {showMenuButton ? (
          <Pressable
            role="button"
            accessibilityLabel={`More actions for ${label}`}
            onPress={() => onAction('menu', tx)}
            style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="dots-horizontal" size={24} color={colors.textSecondary} aria-hidden />
          </Pressable>
        ) : null}
      </View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface },
  main: { flex: 1, minHeight: MIN_TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },
  pressed: { opacity: 0.75 },
  date: { width: 56, color: colors.textSecondary },
  category: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
  cost: { textAlign: 'right' },
  more: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  pinAction: { backgroundColor: colors.primary },
  deleteAction: { backgroundColor: colors.danger, justifyContent: 'flex-end' },
  onPrimary: { color: colors.onPrimary },
});
