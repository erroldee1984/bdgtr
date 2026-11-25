import {
  type Category,
  CATEGORY_COLOURS,
  CATEGORY_ICONS,
  type CategoryColour,
  type CategoryIcon,
  can,
  formatPHP,
} from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { useHousehold } from '@/household/household-context';
import {
  addStarterCategories,
  ApiError,
  createCategory,
  fetchCategories,
  removeCategory,
  restoreCategory,
  updateCategory,
} from '@/lib/api';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

import { budgetText, type CategoryFormErrors, validateCategoryForm } from './category-form';

type Editing = { mode: 'add' } | { mode: 'edit'; category: Category } | null;

const SERVER_MESSAGES: Record<string, string> = {
  category_exists: 'A category with this name already exists.',
  category_limit: 'This household has too many categories. Remove or reuse one.',
};

/**
 * More → Categories (docs/PLAN.md §6.4): add, edit (name, icon, colour,
 * default budget) and remove with a confirmation explaining that past
 * spending keeps the category; "Show removed" allows restore. House Members
 * see the list read-only. The server enforces all of it again.
 */
export function CategoriesManager() {
  const { getToken } = useAuth();
  const { active } = useHousehold();
  const householdId = active?.householdId ?? '';
  const canManage = !!active && can(active.role, 'manage_budget_data');
  const [list, setList] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [confirmRemove, setConfirmRemove] = useState<Category | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    fetchCategories(() => getToken(), householdId)
      .then((c) => {
        if (!alive) return;
        setList(c);
        setLoadError(false);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [getToken, householdId, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', text: done });
      setConfirmRemove(null);
      reload();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setMessage({ tone: 'danger', text: SERVER_MESSAGES[code] ?? "That didn't work. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const token = () => getToken();
  const activeCats = (list ?? []).filter((c) => !c.isRemoved);
  const removed = (list ?? []).filter((c) => c.isRemoved);

  return (
    <Screen title="Categories" subtitle={canManage ? undefined : 'Only the House Owner or a Co-Owner can change these.'}>
      {loadError ? (
        <Card>
          <AppText tone="danger" role="alert">
            Couldn&apos;t load the categories.
          </AppText>
          <Button label="Try again" compact onPress={reload} />
        </Card>
      ) : !list ? (
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading categories" />
      ) : (
        <>
          {editing ? (
            <CategoryEditor
              key={editing.mode === 'edit' ? editing.category.id : 'new'}
              initial={editing.mode === 'edit' ? editing.category : null}
              busy={busy}
              onCancel={() => setEditing(null)}
              onSave={async (input) => {
                setBusy(true);
                setMessage(null);
                try {
                  if (editing.mode === 'edit') await updateCategory(token, householdId, editing.category.id, input);
                  else await createCategory(token, householdId, input);
                  setMessage({ tone: 'success', text: editing.mode === 'edit' ? `${input.name} saved.` : `${input.name} added.` });
                  setEditing(null);
                  reload();
                  return null;
                } catch (err) {
                  const code = err instanceof ApiError ? err.code : '';
                  return SERVER_MESSAGES[code] ?? "Couldn't save. Check your connection and try again.";
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : canManage ? (
            <Button label="Add category" variant="primary" icon="plus" onPress={() => setEditing({ mode: 'add' })} />
          ) : null}

          {message ? (
            <AppText tone={message.tone} aria-live="polite">
              {message.text}
            </AppText>
          ) : null}

          <Card>
            {activeCats.length === 0 ? (
              <View style={styles.empty}>
                <AppText tone="secondary">No categories yet.</AppText>
                {canManage ? (
                  <Button
                    label="Add starter categories"
                    busy={busy}
                    onPress={() => void run(() => addStarterCategories(token, householdId), 'Starter categories added.')}
                  />
                ) : null}
              </View>
            ) : (
              <View style={styles.list}>
                {activeCats.map((c) => (
                  <View key={c.id} style={styles.row} testID="category-row">
                    <View style={styles.rowMain}>
                      <View style={[styles.iconDot, { borderColor: c.colour }]}>
                        <MaterialCommunityIcons name={c.icon} size={20} color={c.colour} aria-hidden />
                      </View>
                      <View style={styles.flex}>
                        <AppText variant="bodyStrong">{c.name}</AppText>
                        <AppText variant="caption" tone="secondary">
                          {c.defaultBudgetMinor > 0 ? `Default budget ${formatPHP(c.defaultBudgetMinor)}` : 'No default budget'}
                        </AppText>
                      </View>
                    </View>
                    {confirmRemove?.id === c.id ? (
                      <View style={styles.confirm} role="alert">
                        <AppText>{`Remove ${c.name}? Past spending keeps this category; it just won't be offered for new spending.`}</AppText>
                        <View style={styles.actions}>
                          <Button
                            label="Remove"
                            variant="danger"
                            compact
                            busy={busy}
                            onPress={() => void run(() => removeCategory(token, householdId, c.id), `${c.name} removed.`)}
                          />
                          <Button label="Cancel" compact onPress={() => setConfirmRemove(null)} />
                        </View>
                      </View>
                    ) : canManage ? (
                      <View style={styles.actions}>
                        <Button label="Edit" compact accessibilityLabel={`Edit ${c.name}`} onPress={() => setEditing({ mode: 'edit', category: c })} />
                        <Button
                          label="Remove"
                          variant="danger"
                          compact
                          accessibilityLabel={`Remove ${c.name}`}
                          onPress={() => setConfirmRemove(c)}
                        />
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </Card>

          {removed.length > 0 ? (
            <Card>
              <Button
                compact
                label={showRemoved ? `Hide removed (${removed.length})` : `Show removed (${removed.length})`}
                onPress={() => setShowRemoved((v) => !v)}
              />
              {showRemoved
                ? removed.map((c) => (
                    <View key={c.id} style={styles.row}>
                      <View style={styles.rowMain}>
                        <MaterialCommunityIcons name={c.icon} size={20} color={colors.textSecondary} aria-hidden />
                        <AppText tone="secondary" style={styles.flex}>
                          {c.name}
                        </AppText>
                        {canManage ? (
                          <Button
                            label="Restore"
                            compact
                            busy={busy}
                            accessibilityLabel={`Restore ${c.name}`}
                            onPress={() => void run(() => restoreCategory(token, householdId, c.id), `${c.name} restored.`)}
                          />
                        ) : null}
                      </View>
                    </View>
                  ))
                : null}
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function CategoryEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: Category | null;
  busy: boolean;
  /** Resolves to an error message, or null when saved. */
  onSave: (input: { name: string; icon: CategoryIcon; colour: CategoryColour; defaultBudgetMinor: number }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState<CategoryIcon>(initial?.icon ?? 'cart');
  const [colour, setColour] = useState<CategoryColour>(initial?.colour ?? CATEGORY_COLOURS[0]);
  const [budget, setBudget] = useState(budgetText(initial?.defaultBudgetMinor ?? 0));
  const [errors, setErrors] = useState<CategoryFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  async function save() {
    setServerError(null);
    const result = validateCategoryForm({ name, icon, colour, budget });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setServerError(await onSave(result.input));
  }

  return (
    <Card>
      <AppText variant="title">{initial ? `Edit ${initial.name}` : 'New category'}</AppText>
      <TextField label="Name" value={name} onChangeText={setName} error={errors.name} maxLength={40} />
      <AppText variant="bodyStrong">Icon</AppText>
      <View role="radiogroup" aria-label="Icon" style={styles.grid}>
        {CATEGORY_ICONS.map((i) => (
          <Pressable
            key={i}
            role="radio"
            aria-checked={icon === i}
            accessibilityLabel={i.replace(/-/g, ' ')}
            onPress={() => setIcon(i)}
            style={[styles.choice, icon === i && styles.choiceOn]}
          >
            <MaterialCommunityIcons name={i} size={22} color={icon === i ? colour : colors.textSecondary} aria-hidden />
          </Pressable>
        ))}
      </View>
      <AppText variant="bodyStrong">Colour</AppText>
      <View role="radiogroup" aria-label="Colour" style={styles.grid}>
        {CATEGORY_COLOURS.map((c, n) => (
          <Pressable
            key={c}
            role="radio"
            aria-checked={colour === c}
            accessibilityLabel={`Colour ${n + 1}`}
            onPress={() => setColour(c)}
            style={[styles.choice, colour === c && styles.choiceOn]}
          >
            <View style={[styles.swatch, { backgroundColor: c }]}>
              {colour === c ? <MaterialCommunityIcons name="check" size={16} color={colors.onPrimary} aria-hidden /> : null}
            </View>
          </Pressable>
        ))}
      </View>
      <TextField
        label="Default monthly budget (optional)"
        prefix="₱"
        placeholder="0"
        value={budget}
        onChangeText={setBudget}
        error={errors.budget}
        keyboardType="decimal-pad"
      />
      {serverError ? (
        <AppText tone="danger" role="alert">
          {serverError}
        </AppText>
      ) : null}
      <View style={styles.actions}>
        <Button label={initial ? 'Save changes' : 'Add category'} variant="primary" busy={busy} onPress={() => void save()} />
        <Button label="Cancel" onPress={onCancel} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  empty: { gap: spacing.md },
  row: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconDot: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  confirm: { gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceOn: { borderColor: colors.primaryLight, backgroundColor: colors.surfaceRaised, borderWidth: 2 },
  swatch: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
