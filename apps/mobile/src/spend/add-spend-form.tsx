import { CategorySchema, type Category, categoriesForEntry, can } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { useHousehold } from '@/household/household-context';
import { goBackOrHome } from '@/layout/back-button';
import { ApiError, fetchCategories } from '@/lib/api';
import { cacheName, fetchWithCache } from '@/offline/cached';
import { useOutbox } from '@/offline/outbox-context';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';
import { useToast } from '@/toast/toast';

import { DatePickerButton } from './date-picker-button';
import { QuickAddCategory } from './quick-add-category';
import { dateLabel, quickDates, type SpendFormErrors, validateSpendForm } from './spend-form';

const SERVER_MESSAGES: Record<string, string> = {
  category_removed: 'That category was just removed. Choose another one.',
  category_not_found: 'That category no longer exists. Choose another one.',
  invalid_input: 'Check the date and amount, then try again.',
};

/**
 * Add spend (docs/PLAN.md §6.3): date (Today / Yesterday / Pick date),
 * category chips most-used first, amount with ₱ and centavos, optional
 * description. One clientId per form: if a save fails and is retried, the
 * server returns the first copy instead of saving it twice.
 */
export function AddSpendForm({ now = () => new Date() }: { now?: () => Date }) {
  const { getToken, userId } = useAuth();
  const { active } = useHousehold();
  const outbox = useOutbox();
  const toast = useToast();
  const householdId = active?.householdId ?? '';
  const canManage = !!active && can(active.role, 'manage_budget_data');
  const [quickNote, setQuickNote] = useState<string | null>(null);
  const { today, yesterday } = useMemo(() => quickDates(now()), [now]);

  const clientId = useRef(Crypto.randomUUID()).current;
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const [date, setDate] = useState(today);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<SpendFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    // Kept on the phone too, so a spend can be added offline (docs/PLAN.md §15).
    fetchWithCache(userId ? cacheName(userId, householdId, 'categories') : null, () => fetchCategories(() => getToken(), householdId), z.array(CategorySchema))
      .then(({ data: c }) => {
        if (!alive) return;
        setCategories(categoriesForEntry(c));
        setLoadError(false);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [getToken, userId, householdId, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const maxDate = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number);
    return `${y! + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }, [today]);

  async function save() {
    setServerError(null);
    const result = validateSpendForm({ date, categoryId, amount, description: showDescription ? description : '' }, clientId, now());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const { queued, alerts } = await outbox.saveSpend(householdId, result.input);
      if (queued) {
        toast.show({ level: 'near', title: 'Saved on this phone', body: "You're offline. It will be sent when you're back online." });
      }
      // The person who entered it hears about crossed budgets straight away (docs/PLAN.md §6.3).
      for (const a of alerts) toast.show({ level: a.level, title: a.title, body: a.body });
      goBackOrHome();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'category_removed' || code === 'category_not_found') {
        setCategoryId(null);
        reload();
      }
      setServerError(SERVER_MESSAGES[code] ?? "Couldn't save. Check your connection and try again; it won't be saved twice.");
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <AppText tone="danger" role="alert">
          Couldn&apos;t load the categories.
        </AppText>
        <Button label="Try again" compact onPress={reload} />
      </View>
    );
  }
  if (!categories) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading categories" />
      </View>
    );
  }
  if (categories.length === 0) {
    return (
      <View style={styles.center}>
        <AppText variant="title">No categories yet</AppText>
        {active && can(active.role, 'manage_budget_data') ? (
          <>
            <AppText tone="secondary">Add some categories first, then come back to add a spend.</AppText>
            <Button label="Go to Categories" variant="primary" onPress={() => router.replace('/categories')} />
          </>
        ) : (
          <AppText tone="secondary">Ask the House Owner or a Co-Owner to add categories first.</AppText>
        )}
      </View>
    );
  }

  const dateChip = (label: string, value: string) => (
    <Button compact label={label} variant={date === value ? 'primary' : 'secondary'} onPress={() => setDate(value)} />
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.section}>
        <TextField
          label="Amount"
          prefix="₱"
          placeholder="0.00"
          value={amount}
          onChangeText={setAmount}
          error={errors.amount}
          keyboardType="decimal-pad"
          autoFocus
        />
      </View>

      <View style={styles.section}>
        <AppText variant="bodyStrong">Category</AppText>
        <View role="radiogroup" aria-label="Category" style={styles.chips}>
          {categories.map((c) => {
            const on = categoryId === c.id;
            return (
              <Pressable
                key={c.id}
                role="radio"
                aria-checked={on}
                accessibilityLabel={c.name}
                onPress={() => setCategoryId(c.id)}
                style={[styles.chip, on && { borderColor: c.colour, backgroundColor: colors.surfaceRaised, borderWidth: 2 }]}
              >
                <MaterialCommunityIcons name={c.icon} size={18} color={c.colour} aria-hidden />
                <AppText variant={on ? 'bodyStrong' : 'body'}>{c.name}</AppText>
              </Pressable>
            );
          })}
          {canManage ? (
            <QuickAddCategory
              householdId={householdId}
              categories={categories}
              onConflict={reload}
              onPicked={(c, isNew) => {
                if (isNew) setCategories((list) => [c, ...(list ?? [])]);
                setCategoryId(c.id);
                setQuickNote(isNew ? `${c.name} added and selected.` : `${c.name} already exists, so it's selected.`);
              }}
            />
          ) : null}
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

      <View style={styles.section}>
        <AppText variant="bodyStrong">Date</AppText>
        <View style={styles.chips}>
          {dateChip('Today', today)}
          {dateChip('Yesterday', yesterday)}
          <DatePickerButton value={date} max={maxDate} onChange={setDate} selected={date !== today && date !== yesterday} />
        </View>
        <AppText tone="secondary" aria-live="polite">
          {dateLabel(date)}
        </AppText>
        {errors.date ? (
          <AppText tone="danger" role="alert">
            {errors.date}
          </AppText>
        ) : null}
      </View>

      {showDescription ? (
        <TextField
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          error={errors.description}
          maxLength={500}
          multiline
        />
      ) : (
        <Button compact icon="text" label="Add a description" onPress={() => setShowDescription(true)} />
      )}

      {serverError ? (
        <AppText tone="danger" role="alert">
          {serverError}
        </AppText>
      ) : null}
      <Button label={saving ? 'Saving…' : 'Save spend'} variant="primary" icon="check" busy={saving} onPress={() => void save()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.xl, maxWidth: 640, width: '100%', alignSelf: 'center' },
  center: { flex: 1, backgroundColor: colors.bg, padding: spacing.xl, gap: spacing.md, justifyContent: 'center' },
  section: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
