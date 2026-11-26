import { type Category, categoryNameKey, CreateCategoryInputSchema, QUICK_CATEGORY_DEFAULTS } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ApiError, createCategory } from '@/lib/api';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

const SERVER_MESSAGES: Record<string, string> = {
  category_exists: 'A category with this name already exists. Pick it from the list.',
  category_limit: 'This household has too many categories. Remove or reuse one in Categories.',
};

/**
 * "+ New category" on Add spend (House Owner / Co-Owner): asks only for a
 * name; the icon ("?"), colour and budget can be set later in Categories.
 * A name that already exists just selects that category (no duplicate).
 */
export function QuickAddCategory({
  householdId,
  categories,
  onPicked,
  onConflict,
}: {
  householdId: string;
  /** The active categories already listed. */
  categories: Category[];
  /** The category to select: the new one, or an existing one with that name. */
  onPicked: (category: Category, isNew: boolean) => void;
  /** The server already has that name (e.g. just added elsewhere): reload the list. */
  onConflict: () => void;
}) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function add() {
    const parsed = CreateCategoryInputSchema.safeParse({ name, ...QUICK_CATEGORY_DEFAULTS });
    if (!parsed.success) {
      setError(parsed.error.issues.find((i) => i.path[0] === 'name')?.message ?? 'Enter a name');
      return;
    }
    const existing = categories.find((c) => categoryNameKey(c.name) === categoryNameKey(parsed.data.name));
    if (existing) {
      onPicked(existing, false);
      close();
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const created = await createCategory(() => getToken(), householdId, parsed.data);
      onPicked(created, true);
      close();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'category_exists') onConflict();
      setError(SERVER_MESSAGES[code] ?? "Couldn't add the category. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setName('');
    setError(undefined);
  }

  if (!open) {
    return (
      <Pressable
        role="button"
        accessibilityLabel="New category"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="plus" size={18} color={colors.primaryLight} aria-hidden />
        <AppText variant="bodyStrong" tone="accent">
          New category
        </AppText>
      </Pressable>
    );
  }

  return (
    <View style={styles.form}>
      <TextField
        label="New category name"
        value={name}
        onChangeText={setName}
        error={error}
        maxLength={40}
        autoFocus
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={() => void add()}
        hint="You can change its icon, colour and budget later in Categories."
      />
      <View style={styles.actions}>
        <Button label="Add" variant="primary" compact busy={busy} onPress={() => void add()} />
        <Button label="Cancel" compact onPress={close} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primaryLight,
  },
  pressed: { opacity: 0.75 },
  form: { width: '100%', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
