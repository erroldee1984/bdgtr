import { type Category, formatPHP, type Transaction } from "@bdgtr/shared";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Swipeable, {
  type SwipeableMethods,
  SwipeDirection,
} from "react-native-gesture-handler/ReanimatedSwipeable";

import { AppText } from "@/components/app-text";
import { colors, MIN_TOUCH, spacing } from "@/theme/tokens";

const DAY = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "2026-11-03" → "Nov 3". */
export function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DAY.format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export type RowAction = "details" | "pin" | "delete";

/** What a screen reader hears for a row. */
export function rowLabel(
  tx: Transaction,
  categoryName: string,
  pinned: boolean,
): string {
  return `${shortDate(tx.date)}, ${categoryName}, ${formatPHP(tx.amountMinor)}${pinned ? ", pinned" : ""}`;
}

/**
 * One spend: Date · Category · Cost, then Pin and Delete icon buttons
 * (docs/PLAN.md §6.8). Tap the row for its description. Swiping right also
 * pins or unpins; there is no swipe to delete. Delete only shows when
 * `canDelete` (House Members: their own rows); its space is kept so the
 * columns line up.
 */
export function BreakdownRow({
  tx,
  category,
  pinned,
  canDelete,
  onAction,
}: {
  tx: Transaction;
  category: Category | undefined;
  pinned: boolean;
  canDelete: boolean;
  onAction: (action: RowAction, tx: Transaction) => void;
}) {
  const swipe = useRef<SwipeableMethods>(null);
  const name = category?.name ?? "Unknown category";
  const label = rowLabel(tx, name, pinned);
  const plain = rowLabel(tx, name, false);

  function onSwipeableOpen(direction: SwipeDirection) {
    swipe.current?.close();
    if (direction === SwipeDirection.RIGHT) onAction("pin", tx);
  }

  return (
    <Swipeable
      ref={swipe}
      friction={2}
      leftThreshold={64}
      overshootLeft={false}
      onSwipeableOpen={onSwipeableOpen}
      renderLeftActions={() => (
        <View style={styles.pinAction} aria-hidden>
          <MaterialCommunityIcons
            name={pinned ? "pin-off" : "pin"}
            size={22}
            color={colors.onPrimary}
          />
          <AppText variant="bodyStrong" style={styles.onPrimary}>
            {pinned ? "Unpin" : "Pin"}
          </AppText>
        </View>
      )}
    >
      <View style={styles.row} testID="breakdown-row">
        <Pressable
          role="button"
          accessibilityLabel={label}
          accessibilityHint="Shows the description"
          onPress={() => onAction("details", tx)}
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        >
          <AppText style={styles.date}>{shortDate(tx.date)}</AppText>
          <View style={styles.category}>
            {category ? (
              <MaterialCommunityIcons
                name={category.icon}
                size={20}
                color={category.colour}
                aria-hidden
              />
            ) : null}
            <AppText numberOfLines={1} style={styles.flexShrink}>
              {name}
            </AppText>
          </View>
          <AppText variant="bodyStrong" style={styles.cost}>
            {formatPHP(tx.amountMinor)}
          </AppText>
        </Pressable>
        <Pressable
          role="button"
          accessibilityLabel={`${pinned ? "Unpin" : "Pin"} ${plain}`}
          onPress={() => onAction("pin", tx)}
          style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons
            name={pinned ? "pin" : "pin-outline"}
            size={22}
            color={pinned ? colors.primaryLight : colors.textSecondary}
            aria-hidden
          />
        </Pressable>
        {canDelete ? (
          <Pressable
            role="button"
            accessibilityLabel={`Delete ${plain}`}
            onPress={() => onAction("delete", tx)}
            style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons
              name="trash-can-outline"
              size={22}
              color={colors.danger}
              aria-hidden
            />
          </Pressable>
        ) : (
          <View style={styles.icon} aria-hidden />
        )}
      </View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  main: {
    flex: 1,
    minHeight: MIN_TOUCH + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingLeft: spacing.md,
  },
  pressed: { opacity: 0.75 },
  date: { width: 52, color: colors.textSecondary },
  category: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  flexShrink: { flexShrink: 1 },
  cost: { textAlign: "right" },
  icon: {
    width: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
  pinAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
  },
  onPrimary: { color: colors.onPrimary },
});
