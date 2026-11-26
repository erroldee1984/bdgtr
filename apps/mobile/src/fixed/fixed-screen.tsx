import {
  addDays,
  can,
  type Category,
  type CreateFixedInput,
  type FixedTransaction,
  formatPHP,
  manilaDate,
  yearMonthOf,
} from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { shortDate } from '@/breakdown/breakdown-row';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Dialog } from '@/components/dialog';
import { Screen } from '@/components/screen';
import { TwoPane } from '@/components/two-pane';
import { monthLabel } from '@/dashboard/format';
import { useHousehold } from '@/household/household-context';
import { ApiError, bulkPostFixed, createFixed, fetchCategories, fetchFixed, removeFixed, updateFixed } from '@/lib/api';
import { withNetworkRetry } from '@/lib/retry';
import { DatePickerButton } from '@/spend/date-picker-button';
import { dateLabel } from '@/spend/spend-form';
import { useToast } from '@/toast/toast';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

import { EMPTY_FIXED_FORM, formFromItem, scheduleText } from './fixed-form';
import { FixedFormCard } from './fixed-form-card';

/** What a failed change says. */
export function fixedProblem(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'Only the House Owner or a Co-Owner can change fixed transactions.';
  if (err instanceof ApiError && err.code === 'category_removed') return 'That category was removed. Choose another one.';
  if (err instanceof ApiError && err.code === 'fixed_limit') return 'A household can have up to 100 fixed transactions.';
  if (err instanceof ApiError && err.status === 404) return 'That fixed transaction was removed.';
  return "Couldn't save. Check your connection and try again.";
}

/** "Add 3 transactions" / "Add 1 transaction". */
export function addLabel(n: number): string {
  return `Add ${n} ${n === 1 ? 'transaction' : 'transactions'}`;
}

type Loaded = { key: string; items: FixedTransaction[]; categories: Category[] };

/** More → Fixed transactions (docs/PLAN.md §6.5). */
export function FixedScreen({ now = () => new Date() }: { now?: () => Date }) {
  const { getToken } = useAuth();
  const { active } = useHousehold();
  const toast = useToast();
  const householdId = active?.householdId ?? null;
  const canManage = !!active && can(active.role, 'manage_budget_data');
  const token = useCallback(() => getToken(), [getToken]);
  const today = manilaDate(now());

  const [date, setDate] = useState(today); // the bulk-add date; its month drives "already added"
  const month = yearMonthOf(date);
  const key = `${householdId}:${month}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<'new' | FixedTransaction | null>(null);
  const [removing, setRemoving] = useState<FixedTransaction | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [askRepeat, setAskRepeat] = useState(false);
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(() => {
    if (!householdId) return () => {};
    let alive = true;
    const k = `${householdId}:${month}`;
    Promise.all([
      withNetworkRetry(() => fetchFixed(token, householdId, month)),
      withNetworkRetry(() => fetchCategories(token, householdId)),
    ])
      .then(([items, categories]) => {
        if (!alive) return;
        setLoaded({ key: k, items, categories });
        setLoadError(null);
      })
      .catch(() => alive && setLoadError(k));
    return () => {
      alive = false;
    };
  }, [householdId, month, token]);
  useFocusEffect(load);

  const current = loaded?.key === key ? loaded : null;
  const items = current?.items ?? null;
  const categories = current?.categories ?? [];
  const categoryOf = (id: string) => categories.find((c) => c.id === id);

  async function save(input: CreateFixedInput): Promise<string | null> {
    if (!householdId) return null;
    try {
      if (editing === 'new') await createFixed(token, householdId, input);
      else if (editing) await updateFixed(token, householdId, editing.id, input);
      setMessage({ tone: 'success', text: `${input.name} saved.` });
      setEditing(null);
      load();
      return null;
    } catch (err) {
      return fixedProblem(err);
    }
  }

  async function confirmRemove() {
    if (!householdId || !removing) return;
    setRemoveBusy(true);
    try {
      await removeFixed(token, householdId, removing.id);
      setMessage({ tone: 'success', text: `${removing.name} removed. Spends already added from it stay.` });
      setEditing(null);
      load();
    } catch (err) {
      setMessage({ tone: 'danger', text: fixedProblem(err) });
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
    }
  }

  const chosen = (items ?? []).filter((i) => selected.includes(i.id));
  const repeats = chosen.filter((i) => i.postedOn !== null);

  async function post(which: FixedTransaction[]) {
    setAskRepeat(false);
    if (!householdId || which.length === 0) return;
    setPosting(true);
    setMessage(null);
    try {
      const { alerts } = await bulkPostFixed(token, householdId, {
        date,
        items: which.map((i) => ({ id: i.id, clientId: Crypto.randomUUID() })),
      });
      for (const a of alerts) toast.show({ level: a.level, title: a.title, body: a.body });
      setMessage({
        tone: 'success',
        text: `Added ${which.length} ${which.length === 1 ? 'transaction' : 'transactions'} on ${shortDate(date)}.`,
      });
      setSelecting(false);
      setSelected([]);
      load();
    } catch (err) {
      setMessage({ tone: 'danger', text: fixedProblem(err).replace("Couldn't save", "Couldn't add them") });
    } finally {
      setPosting(false);
    }
  }

  const startSelecting = () => {
    setSelecting(true);
    setSelected([]);
    setEditing(null);
    setMessage(null);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected([]);
    setDate(today);
  };

  return (
    <Screen
      title="Fixed transactions"
      subtitle={canManage ? 'Bills and other spends that repeat every month' : 'Only the House Owner or a Co-Owner can change these.'}
    >
      {message ? (
        <AppText tone={message.tone} role={message.tone === 'danger' ? 'alert' : undefined} aria-live="polite">
          {message.text}
        </AppText>
      ) : null}

      {loadError === key && !items ? (
        <Card>
          <AppText tone="danger" role="alert">
            Couldn&apos;t load the fixed transactions.
          </AppText>
          <Button label="Try again" compact onPress={load} />
        </Card>
      ) : !items ? (
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading fixed transactions" />
      ) : (
        <>
          <TwoPane
            sideFirstWhenStacked
            main={
              <>
                {items.length === 0 ? (
                  <Card>
                    <AppText tone="secondary">
                      No fixed transactions yet.{canManage ? ' Add rent, bills or allowances so they can be added every month.' : ''}
                    </AppText>
                  </Card>
                ) : (
                  <View style={styles.list} role="list" aria-label="Fixed transactions">
                    {items.map((item) => {
                      const cat = categoryOf(item.categoryId);
                      const removedCat = !!cat?.isRemoved;
                      const on = selected.includes(item.id);
                      const posted = item.postedOn ? `Added ${shortDate(item.postedOn)}` : `Not added in ${monthLabel(month)}`;
                      const auto = item.autoPostEnabled
                        ? removedCat
                          ? 'Not added automatically: its category was removed'
                          : 'Added automatically'
                        : 'Added by hand';
                      const summary = `${item.name}, ${formatPHP(item.amountMinor)}, ${cat?.name ?? 'Unknown category'}. ${scheduleText(item.dayOfMonth)}. ${auto}. ${posted}.`;
                      return (
                        <View key={item.id} role="listitem" style={styles.row}>
                          {selecting ? (
                            <Pressable
                              role="checkbox"
                              aria-checked={on}
                              accessibilityLabel={summary}
                              onPress={() => setSelected((s) => (on ? s.filter((x) => x !== item.id) : [...s, item.id]))}
                              style={({ pressed }) => [styles.main, pressed && styles.pressed]}
                            >
                              <MaterialCommunityIcons
                                name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
                                size={24}
                                color={on ? colors.primaryLight : colors.textSecondary}
                                aria-hidden
                              />
                              <ItemText item={item} category={cat} posted={posted} auto={auto} removedCat={removedCat} />
                            </Pressable>
                          ) : (
                            <View style={styles.main} accessible accessibilityLabel={summary}>
                              {cat ? <MaterialCommunityIcons name={cat.icon} size={24} color={cat.colour} aria-hidden /> : null}
                              <ItemText item={item} category={cat} posted={posted} auto={auto} removedCat={removedCat} />
                            </View>
                          )}
                          {canManage && !selecting ? (
                            <Pressable
                              role="button"
                              accessibilityLabel={`Edit ${item.name}`}
                              onPress={() => (setEditing(item), setMessage(null))}
                              style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
                            >
                              <MaterialCommunityIcons name="pencil-outline" size={22} color={colors.textSecondary} aria-hidden />
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            }
            side={
              <>
                {canManage && !selecting && !editing ? (
                  <View style={styles.actions}>
                    <Button label="Add fixed transaction" icon="plus" compact onPress={() => (setEditing('new'), setMessage(null))} />
                    {items.length ? (
                      <Button label="Select to add" icon="checkbox-multiple-marked-outline" compact onPress={startSelecting} />
                    ) : null}
                  </View>
                ) : null}

                {editing ? (
                  <FixedFormCard
                    key={editing === 'new' ? 'new' : editing.id}
                    title={editing === 'new' ? 'New fixed transaction' : `Edit ${editing.name}`}
                    initial={editing === 'new' ? EMPTY_FIXED_FORM : formFromItem(editing)}
                    categories={categories}
                    householdId={householdId!}
                    onCategoriesStale={load}
                    onSave={save}
                    onCancel={() => setEditing(null)}
                    {...(editing === 'new' ? {} : { onRemove: () => setRemoving(editing) })}
                  />
                ) : null}

                {selecting ? (
                  <Card>
                    <AppText variant="bodyStrong">Add as spends on</AppText>
                    <View style={styles.actions}>
                      <Button label="Today" compact variant={date === today ? 'primary' : 'secondary'} onPress={() => setDate(today)} />
                      <DatePickerButton value={date} max={addDays(today, 365)} onChange={setDate} selected={date !== today} />
                    </View>
                    <AppText tone="secondary" aria-live="polite">
                      {dateLabel(date)}
                    </AppText>
                    <AppText variant="caption" tone="secondary">
                      {selected.length ? `${selected.length} selected` : 'Tick the items to add.'}
                    </AppText>
                    <View style={styles.actions}>
                      <Button
                        label={addLabel(selected.length)}
                        variant="primary"
                        compact
                        busy={posting}
                        disabled={selected.length === 0}
                        onPress={() => (repeats.length ? setAskRepeat(true) : void post(chosen))}
                      />
                      <Button label="Cancel" compact disabled={posting} onPress={stopSelecting} />
                    </View>
                  </Card>
                ) : null}
              </>
            }
          />
        </>
      )}

      {askRepeat ? (
        <Dialog
          visible
          title={`${repeats.length} already added in ${monthLabel(month)}`}
          onClose={() => setAskRepeat(false)}
          actions={
            <>
              <Button label="Cancel" compact onPress={() => setAskRepeat(false)} />
              {chosen.length > repeats.length ? (
                <Button label="Skip them" compact onPress={() => void post(chosen.filter((i) => i.postedOn === null))} />
              ) : null}
              <Button label="Add again" variant="primary" compact onPress={() => void post(chosen)} />
            </>
          }
        >
          <AppText tone="secondary">{repeats.map((i) => `${i.name} (added ${shortDate(i.postedOn!)})`).join(', ')}</AppText>
        </Dialog>
      ) : null}

      {removing ? (
        <Dialog
          visible
          title={`Remove ${removing.name}?`}
          onClose={() => !removeBusy && setRemoving(null)}
          actions={
            <>
              <Button label="Cancel" compact disabled={removeBusy} onPress={() => setRemoving(null)} />
              <Button
                label="Remove"
                icon="trash-can-outline"
                variant="danger"
                compact
                busy={removeBusy}
                onPress={() => void confirmRemove()}
              />
            </>
          }
        >
          <AppText tone="secondary">It won&apos;t be added any more. Spends already added from it stay as they are.</AppText>
        </Dialog>
      ) : null}
    </Screen>
  );
}

function ItemText({
  item,
  category,
  posted,
  auto,
  removedCat,
}: {
  item: FixedTransaction;
  category: Category | undefined;
  posted: string;
  auto: string;
  removedCat: boolean;
}) {
  return (
    <View style={styles.flex}>
      <View style={styles.titleRow}>
        <AppText variant="bodyStrong" style={styles.flexShrink} numberOfLines={1}>
          {item.name}
        </AppText>
        <AppText variant="bodyStrong">{formatPHP(item.amountMinor)}</AppText>
      </View>
      <AppText variant="caption" tone="secondary">
        {`${category?.name ?? 'Unknown category'} · ${scheduleText(item.dayOfMonth)}`}
      </AppText>
      <AppText variant="caption" tone={removedCat && item.autoPostEnabled ? 'danger' : 'secondary'}>
        {`${auto} · ${posted}`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  flexShrink: { flexShrink: 1 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  list: { gap: StyleSheet.hairlineWidth, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface },
  main: { flex: 1, minHeight: MIN_TOUCH + 16, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  icon: { width: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.75 },
});
