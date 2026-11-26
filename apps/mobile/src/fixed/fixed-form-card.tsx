import type { Category } from '@bdgtr/shared';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { TextField } from '@/components/text-field';
import { QuickAddCategory } from '@/spend/quick-add-category';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

import { type FixedFormErrors, type FixedFormValues, scheduleText, validateFixedForm } from './fixed-form';

/**
 * Add or edit one fixed transaction. `onSave` gets the validated input and
 * answers null when saved, or a message to show (the form stays open).
 */
export function FixedFormCard({
  title,
  initial,
  categories,
  householdId,
  onCategoriesStale,
  onSave,
  onCancel,
  onRemove,
}: {
  title: string;
  initial: FixedFormValues;
  categories: Category[];
  householdId: string;
  /** A quick-added name already existed on the server: reload the categories. */
  onCategoriesStale: () => void;
  onSave: (input: Extract<ReturnType<typeof validateFixedForm>, { ok: true }>['input']) => Promise<string | null>;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<FixedFormErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<FixedFormValues>) => {
    setV((prev) => ({ ...prev, ...patch }));
    // A field's error goes once it's changed, so its hint shows again.
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(patch)) delete next[(k === 'categoryId' ? 'category' : k) as keyof FixedFormErrors];
      return next;
    });
  };
  const [added, setAdded] = useState<Category[]>([]); // quick-added here, until the list reloads
  const [quickNote, setQuickNote] = useState<string | null>(null);
  const all = [...added.filter((a) => !categories.some((c) => c.id === a.id)), ...categories];
  const active = all.filter((c) => !c.isRemoved || c.id === initial.categoryId);
  const day = Number(v.day);

  async function save() {
    const result = validateFixedForm(v);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setProblem(null);
    setBusy(true);
    const p = await onSave(result.input);
    setBusy(false);
    if (p) setProblem(p);
  }

  return (
    <Card>
      <AppText variant="title">{title}</AppText>
      <TextField label="Name" value={v.name} onChangeText={(name) => set({ name })} error={errors.name} placeholder="e.g. Rent" autoFocus />
      <TextField
        label="Amount"
        prefix="₱"
        value={v.amount}
        onChangeText={(amount) => set({ amount })}
        error={errors.amount}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      <View style={styles.section}>
        <AppText variant="bodyStrong">Category</AppText>
        <View role="radiogroup" aria-label="Category" style={styles.chips}>
          {active.map((c) => {
            const on = v.categoryId === c.id;
            return (
              <Pressable
                key={c.id}
                role="radio"
                aria-checked={on}
                accessibilityLabel={c.isRemoved ? `${c.name} (removed)` : c.name}
                onPress={() => set({ categoryId: c.id })}
                style={[styles.chip, on && { borderColor: c.colour, backgroundColor: colors.surfaceRaised, borderWidth: 2 }]}
              >
                <MaterialCommunityIcons name={c.icon} size={18} color={c.colour} aria-hidden />
                <AppText variant={on ? 'bodyStrong' : 'body'}>{c.isRemoved ? `${c.name} (removed)` : c.name}</AppText>
              </Pressable>
            );
          })}
          <QuickAddCategory
            householdId={householdId}
            categories={all.filter((c) => !c.isRemoved)}
            onConflict={onCategoriesStale}
            onPicked={(c, isNew) => {
              if (isNew) setAdded((list) => [c, ...list]);
              set({ categoryId: c.id });
              setQuickNote(isNew ? `${c.name} added and selected.` : `${c.name} already exists, so it's selected.`);
            }}
          />
        </View>
        {quickNote ? (
          <AppText tone="secondary" aria-live="polite">
            {quickNote}
          </AppText>
        ) : null}
        {errors.category ? (
          <AppText tone="danger" role="alert">
            {errors.category}
          </AppText>
        ) : null}
      </View>
      <TextField
        label="Day of the month"
        value={v.day}
        onChangeText={(d) => set({ day: d })}
        error={errors.day}
        hint={day >= 1 && day <= 31 ? scheduleText(day) : 'From 1 to 31'}
        keyboardType="number-pad"
        maxLength={2}
      />
      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Add automatically</AppText>
          <AppText variant="caption" tone="secondary">
            {v.autoPost
              ? 'Added as a spend just after midnight on its day. Everyone in the household is told at 7 AM.'
              : 'Not added for you: the House Owner and Co-Owners get a reminder at 7 AM on its day.'}
          </AppText>
        </View>
        <Switch
          accessibilityLabel="Add automatically on its day"
          value={v.autoPost}
          onValueChange={(autoPost) => set({ autoPost })}
          trackColor={{ true: colors.primary, false: colors.border }}
        />
      </View>
      <TextField
        label="Description (optional)"
        value={v.description}
        onChangeText={(description) => set({ description })}
        error={errors.description}
        multiline
      />
      {problem ? (
        <AppText tone="danger" role="alert">
          {problem}
        </AppText>
      ) : null}
      <View style={styles.actions}>
        <Button label="Save" variant="primary" compact busy={busy} onPress={() => void save()} />
        <Button label="Cancel" compact disabled={busy} onPress={onCancel} />
        {onRemove ? <Button label="Remove" icon="trash-can-outline" variant="danger" compact disabled={busy} onPress={onRemove} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: MIN_TOUCH },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
