import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { usesNavRail, useWindowClass } from '@/layout/window-class';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

export interface ToastInput {
  level: 'near' | 'over';
  title: string;
  body: string;
}
interface ToastItem extends ToastInput {
  id: number;
}

/** Shown at least this long (WCAG 2.2.1), longer while hovered or focused. */
export const TOAST_MS = 10_000;
const MAX_VISIBLE = 3;

const Ctx = createContext<{ show: (t: ToastInput) => void }>({ show: () => {} });

/**
 * In-app "growl" (docs/PLAN.md §6.12): top banner on phones, top-right on wide
 * screens, never over the Add button or tab bar (WCAG 2.4.11). "over" is
 * announced as an alert, "near" politely. Close button and a "View" link.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const show = useCallback((t: ToastInput) => {
    const id = nextId.current++;
    setItems((list) => [...list, { ...t, id }].slice(-MAX_VISIBLE));
  }, []);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const value = useMemo(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastStack items={items} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}

function ToastStack({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  const insets = useSafeAreaInsets();
  const wide = usesNavRail(useWindowClass());
  if (items.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.stack, wide ? styles.stackWide : styles.stackNarrow, { top: insets.top + spacing.sm }]}
    >
      {items.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </View>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [paused, onDismiss]);

  const over = toast.level === 'over';
  const pause = () => setPaused(true);
  const resume = () => setPaused(false);
  return (
    <Pressable
      // Hovering (mouse) pauses the timer; so does focusing either button.
      onHoverIn={pause}
      onHoverOut={resume}
      accessible={false}
      style={[styles.toast, over && styles.toastOver]}
      testID="toast"
    >
      <View
        style={styles.text}
        // One element, so the title and body are announced together.
        accessible
        role={over ? 'alert' : 'status'}
        aria-live={over ? 'assertive' : 'polite'}
      >
        <View style={styles.titleRow}>
          <MaterialCommunityIcons name={over ? 'alert' : 'alert-circle-outline'} size={20} color={over ? colors.danger : colors.primaryLight} aria-hidden />
          <AppText variant="bodyStrong" tone={over ? 'danger' : 'primary'} style={styles.flex}>
            {toast.title}
          </AppText>
        </View>
        <AppText>{toast.body}</AppText>
      </View>
      <View style={styles.actions}>
        <Pressable
          role="link"
          accessibilityLabel="View alerts"
          onFocus={pause}
          onBlur={resume}
          onPress={() => {
            onDismiss();
            router.push('/alerts');
          }}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <AppText variant="bodyStrong" tone="accent">
            View
          </AppText>
        </Pressable>
        <Pressable
          role="button"
          accessibilityLabel="Dismiss"
          onFocus={pause}
          onBlur={resume}
          onPress={onDismiss}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} aria-hidden />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', gap: spacing.sm, zIndex: 1000 },
  stackNarrow: { left: spacing.md, right: spacing.md },
  stackWide: { right: spacing.lg, width: 380 },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  toastOver: { borderColor: colors.danger },
  text: { flex: 1, gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  action: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
