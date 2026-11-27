import { CategorySchema, type Category, categoriesForEntry, can, formatPHP, type Transaction } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { amountText } from '@/budgets/budget-amount-editor';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { useHousehold } from '@/household/household-context';
import { goBackOrHome } from '@/layout/back-button';
import { ApiError, fetchCategories, fetchTransactions, updateTransaction } from '@/lib/api';
import { cacheName, fetchWithCache } from '@/offline/cached';
import { useOutbox } from '@/offline/outbox-context';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';
import { useToast } from '@/toast/toast';

import { DatePickerButton } from './date-picker-button';
import { QuickAddCategory } from './quick-add-category';
import { dateLabel, quickDates, type SpendFormErrors, validateSpendForm } from './spend-form';

const EDIT_MESSAGES = {
  sending: "It's being sent right now. Try again in a moment.",
  uncertain: 'This one may already have reached the server, so it can’t be changed here. Let it send, then edit it in Spend.',
  gone: 'It has already been sent or removed. Once it shows in Spend, you can change it there.',
} as const;

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

  // /add?pending=<clientId>: edit a spend that's still waiting to be sent (Android, offline).
  // /add?edit=<id>&month=YYYY-MM: edit a saved spend (online).
  const { pending, edit, month: editMonth } = useLocalSearchParams<{ pending?: string; edit?: string; month?: string }>();
  const editing = pending ? outbox.items.find((i) => i.clientId === pending) : undefined;
  const [saved, setSaved] = useState<Transaction | 'missing' | 'error' | null>(null);
  const savedTx = saved && typeof saved === 'object' ? saved : null;
  const prefill = editing?.input ?? savedTx;
  const clientId = useRef(pending ?? Crypto.randomUUID()).current;
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const [date, setDate] = useState(today);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<SpendFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // Fill the form from the spend being edited once it's here (adjusting state
  // while rendering, as React recommends, rather than in an effect).
  if (prefill && !prefilled) {
    setPrefilled(true);
    setDate(prefill.date);
    setCategoryId(prefill.categoryId);
    setAmount(amountText(prefill.amountMinor));
    if (prefill.description) setDescription(prefill.description);
  }

  // A saved spend: fetch its month and find it.
  useEffect(() => {
    if (!edit || !householdId || !editMonth) return;
    let alive = true;
    fetchTransactions(() => getToken(), householdId, editMonth)
      .then((txs) => alive && setSaved(txs.find((t) => t.id === edit) ?? 'missing'))
      .catch(() => alive && setSaved('error'));
    return () => {
      alive = false;
    };
  }, [edit, editMonth, householdId, getToken]);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    // Kept on the phone too, so a spend can be added offline (docs/PLAN.md §15).
    fetchWithCache(
      userId ? cacheName(userId, householdId, 'categories') : null,
      () => fetchCategories(() => getToken(), householdId),
      z.array(CategorySchema),
    )
      .then(({ data: c }) => {
        if (!alive) return;
        setCategories(categoriesForEntry(c));
        setAllCategories(c);
        setLoadError(false);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [getToken, userId, householdId, version]);
  // Show the spinner again, so "Try again" visibly does something.
  const reload = () => {
    setLoadError(false);
    setVersion((v) => v + 1);
  };

  const maxDate = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number);
    return `${y! + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }, [today]);

  async function save() {
    setServerError(null);
    const result = validateSpendForm({ date, categoryId, amount, description }, clientId, now());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    if (edit && savedTx) {
      setSaving(true);
      try {
        const { date: d, categoryId: cat, amountMinor, description: desc } = result.input;
        const { alerts } = await updateTransaction(() => getToken(), householdId, edit, {
          date: d,
          categoryId: cat,
          amountMinor,
          description: desc ?? null,
        });
        toast.show({ level: 'near', title: 'Spend updated', body: `${formatPHP(amountMinor)} on ${dateLabel(d)}` });
        for (const a of alerts) toast.show({ level: a.level, title: a.title, body: a.body });
        goBackOrHome();
      } catch (err) {
        const code = err instanceof ApiError ? err.code : '';
        if (code === 'category_removed' || code === 'category_not_found') {
          setCategoryId(null);
          reload();
        }
        setServerError(
          err instanceof ApiError && err.status === 403
            ? 'You can only edit spends you entered.'
            : err instanceof ApiError && err.status === 404
              ? 'That spend was deleted.'
              : (SERVER_MESSAGES[code] ?? "Couldn't save the change. Check your connection and try again."),
        );
        setSaving(false);
      }
      return;
    }
    if (pending) {
      const outcome = await outbox.editPending(pending, result.input);
      if (outcome === 'saved') {
        toast.show({ level: 'near', title: 'Changes saved on this phone', body: "It will be sent when you're back online." });
        goBackOrHome();
        return;
      }
      setServerError(EDIT_MESSAGES[outcome]);
      return;
    }
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

  if (edit && saved !== null && typeof saved !== 'object') {
    return (
      <View style={styles.center}>
        <AppText tone="danger" role="alert">
          {saved === 'missing'
            ? 'That spend was deleted, or moved to another month.'
            : "Couldn't load that spend. Check your connection and try again."}
        </AppText>
        <Button label="Back" compact onPress={goBackOrHome} />
      </View>
    );
  }
  if (edit && saved === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading the spend" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <AppText tone="danger" role="alert">
          {outbox.offline
            ? 'You’re offline, and the categories aren’t saved on this phone yet. Open the app once while online and you can add spends offline after that.'
            : 'Couldn’t load the categories.'}
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
      {pending ? <Stack.Screen options={{ title: 'Edit waiting spend' }} /> : null}
      {edit ? <Stack.Screen options={{ title: 'Edit spend' }} /> : null}
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
          {/* When editing, the spend's own category stays offered even if it was removed since. */}
          {[...categories, ...allCategories.filter((c) => c.isRemoved && c.id === prefill?.categoryId)].map((c) => {
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

      <TextField
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        error={errors.description}
        maxLength={500}
        returnKeyType="done"
      />

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
