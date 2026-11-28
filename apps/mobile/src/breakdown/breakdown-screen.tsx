import {
  activeFilterCount,
  arrangeBreakdown,
  type BreakdownFilter,
  type BreakdownSort,
  can,
  DEFAULT_SORT,
  formatPHP,
  type Transaction,
} from '@bdgtr/shared';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useMonthParam } from '@/budgets/budgets-screen';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Dialog } from '@/components/dialog';
import { MonthSwitcher } from '@/components/month-switcher';
import { Screen } from '@/components/screen';
import { useHousehold } from '@/household/household-context';
import { CachedNotice } from '@/offline/cached-notice';
import { WaitingSpends } from '@/offline/waiting-spends';
import { ApiError } from '@/lib/api';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

import { BreakdownRow, type RowAction, shortDate } from './breakdown-row';
import { parseRange, type RangeText } from './filter-form';
import { FilterPanel, orderLabel, SortPanel } from './filter-panel';
import { useBreakdown } from './use-breakdown';

const NO_RANGE: RangeText = { min: '', max: '' };

/** What a failed delete says. */
export function deleteProblem(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'You can only delete spends you entered.';
  if (err instanceof ApiError && err.status === 404) return 'That spend was already deleted.';
  return "Couldn't delete. Check your connection and try again.";
}

/** "3 spends · ₱1,500.00", or "Showing 2 of 3 · ₱500.00" when filtered. */
export function listSummary(shown: number, total: number, sumMinor: number): string {
  const count = shown === total ? `${total} ${total === 1 ? 'spend' : 'spends'}` : `Showing ${shown} of ${total}`;
  return `${count} · ${formatPHP(sumMinor)}`;
}

/** Spend tab: Monthly Spend Breakdown (docs/PLAN.md §6.8). */
export function BreakdownScreen() {
  const { active } = useHousehold();
  const [month, setMonth] = useMonthParam();
  const { transactions, categories, cachedAt, pinnedIds, error, reload, togglePin, remove } = useBreakdown(month);
  const canDeleteAny = !!active && can(active.role, 'edit_any_transaction');

  const [panel, setPanel] = useState<'filter' | 'sort' | null>(null);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [range, setRange] = useState<RangeText>(NO_RANGE);
  const [sort, setSort] = useState<BreakdownSort>(DEFAULT_SORT);
  const [details, setDetails] = useState<Transaction | null>(null);
  const [confirming, setConfirming] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'danger';
    text: string;
  } | null>(null);

  const rangeResult = parseRange(range);
  const filter: BreakdownFilter = {
    categoryIds,
    minMinor: rangeResult.ok ? rangeResult.minMinor : null,
    maxMinor: rangeResult.ok ? rangeResult.maxMinor : null,
  };
  const filterCount = activeFilterCount(filter);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const rows = transactions ? arrangeBreakdown(transactions, { filter, sort, pinnedIds }) : [];
  const shownSum = rows.reduce((s, r) => s + r.tx.amountMinor, 0);
  const pinnedCount = rows.filter((r) => r.pinned).length;
  const canDelete = (tx: Transaction) => tx.isYours || canDeleteAny;
  const nameOf = (tx: Transaction) => byId.get(tx.categoryId)?.name ?? 'Unknown category';

  function onAction(action: RowAction, tx: Transaction) {
    setMessage(null);
    if (action === 'details') setDetails(tx);
    else if (action === 'pin') {
      const was = pinnedIds.has(tx.id);
      togglePin(tx);
      setMessage({
        tone: 'success',
        text: was ? 'Unpinned.' : 'Pinned to the top.',
      });
    } else if (action === 'delete' && canDelete(tx)) setConfirming(tx);
  }

  async function confirmDelete() {
    const tx = confirming;
    if (!tx) return;
    setDeleting(true);
    try {
      await remove(tx);
      setMessage({
        tone: 'success',
        text: `Deleted ${nameOf(tx)} ${formatPHP(tx.amountMinor)}.`,
      });
    } catch (err) {
      setMessage({ tone: 'danger', text: deleteProblem(err) });
      if (err instanceof ApiError && err.status === 404) reload();
    } finally {
      setDeleting(false);
      setConfirming(null);
    }
  }

  const clearFilters = () => {
    setCategoryIds([]);
    setRange(NO_RANGE);
  };

  return (
    <Screen title="Spend" subtitle="Monthly spend breakdown">
      <MonthSwitcher month={month} onChange={(m) => (setMonth(m), setMessage(null))} />
      <CachedNotice cachedAt={cachedAt} />
      {active ? <WaitingSpends householdId={active.householdId} month={month} categories={categories} /> : null}

      {message ? (
        <AppText tone={message.tone} role={message.tone === 'danger' ? 'alert' : undefined} aria-live="polite">
          {message.text}
        </AppText>
      ) : null}

      {error && !transactions ? (
        <Card>
          <AppText tone="danger" role="alert">
            Couldn&apos;t load the spends.
          </AppText>
          <Button label="Try again" compact onPress={reload} />
        </Card>
      ) : !transactions ? (
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading spends" />
      ) : transactions.length === 0 ? (
        <Card>
          <AppText tone="secondary">No spends this month.</AppText>
        </Card>
      ) : null}

      {transactions && transactions.length > 0 ? (
        <>
          <View style={styles.toolbar}>
            <AppText variant="caption" tone="secondary" aria-live="polite" style={styles.flex}>
              {listSummary(rows.length, transactions.length, shownSum)}
            </AppText>
            <Pressable
              role="button"
              accessibilityLabel={filterCount ? `Filters, ${filterCount} on` : 'Filters'}
              accessibilityState={{ expanded: panel === 'filter' }}
              onPress={() => setPanel(panel === 'filter' ? null : 'filter')}
              style={({ pressed }) => [styles.iconButton, panel === 'filter' && styles.iconButtonOn, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons
                name="filter-variant"
                size={24}
                color={filterCount ? colors.primaryLight : colors.textPrimary}
                aria-hidden
              />
              {filterCount ? (
                <View style={styles.badge} aria-hidden>
                  <AppText variant="caption" style={styles.badgeText}>
                    {String(filterCount)}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              role="button"
              accessibilityLabel={`Sort, ${orderLabel(sort)}${sort.by === 'amount' ? ' by cost' : ' by date'}`}
              accessibilityState={{ expanded: panel === 'sort' }}
              onPress={() => setPanel(panel === 'sort' ? null : 'sort')}
              style={({ pressed }) => [styles.iconButton, panel === 'sort' && styles.iconButtonOn, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons
                name={sort.dir === 'desc' ? 'sort-descending' : 'sort-ascending'}
                size={24}
                color={colors.textPrimary}
                aria-hidden
              />
            </Pressable>
          </View>
          {panel === 'filter' ? (
            <Card>
              <FilterPanel
                categories={categories}
                categoryIds={categoryIds}
                onToggleCategory={(id) => setCategoryIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))}
                range={range}
                rangeResult={rangeResult}
                onRangeChange={setRange}
                onClear={clearFilters}
              />
            </Card>
          ) : panel === 'sort' ? (
            <Card>
              <SortPanel sort={sort} onSortChange={setSort} />
            </Card>
          ) : null}
        </>
      ) : null}

      {!transactions || transactions.length === 0 ? null : rows.length === 0 ? (
        <Card>
          <AppText tone="secondary">No spends match these filters.</AppText>
          <Button label="Clear filters" icon="filter-remove-outline" compact onPress={clearFilters} />
        </Card>
      ) : (
        <>
          <View style={styles.list} role="list" aria-label="Spends" testID="spend-list">
            {rows.map((r, i) => (
              <View key={r.tx.id} role="listitem">
                {pinnedCount > 0 && (i === 0 || i === pinnedCount) ? (
                  <AppText variant="caption" tone="secondary" style={styles.groupHead} role="heading">
                    {i === 0 ? 'Pinned' : 'Everything else'}
                  </AppText>
                ) : null}
                <BreakdownRow
                  tx={r.tx}
                  category={byId.get(r.tx.categoryId)}
                  pinned={r.pinned}
                  canDelete={canDelete(r.tx)}
                  onAction={onAction}
                />
              </View>
            ))}
          </View>
        </>
      )}

      {details ? (
        <Dialog
          visible
          title={`${nameOf(details)} · ${formatPHP(details.amountMinor)}`}
          onClose={() => setDetails(null)}
          actions={
            <>
              {canDelete(details) ? (
                <Button
                  label="Edit"
                  icon="pencil-outline"
                  compact
                  onPress={() => {
                    const id = details.id;
                    setDetails(null);
                    router.push({ pathname: '/add', params: { edit: id, month } });
                  }}
                />
              ) : null}
              <Button label="Close" compact onPress={() => setDetails(null)} />
            </>
          }
        >
          <AppText tone="secondary">{shortDate(details.date)}</AppText>
          <AppText tone={details.description ? 'primary' : 'secondary'}>{details.description || 'No description'}</AppText>
        </Dialog>
      ) : null}

      {confirming ? (
        <Dialog
          visible
          title="Delete this spend?"
          onClose={() => !deleting && setConfirming(null)}
          actions={
            <>
              <Button label="Cancel" compact disabled={deleting} onPress={() => setConfirming(null)} />
              <Button
                label="Delete"
                icon="trash-can-outline"
                variant="danger"
                compact
                busy={deleting}
                onPress={() => void confirmDelete()}
              />
            </>
          }
        >
          <AppText>{`${shortDate(confirming.date)} · ${nameOf(confirming)} · ${formatPHP(confirming.amountMinor)}`}</AppText>
          <AppText tone="secondary">This can&apos;t be undone. It comes off the month&apos;s spend for everyone in the household.</AppText>
        </Dialog>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
  },
  iconButtonOn: { backgroundColor: colors.surfaceRaised },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onPrimary, fontSize: 11, lineHeight: 14 },
  list: {
    // A whole pixel: a hairline gap rounded to nothing on some Android screens, merging rows.
    gap: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  groupHead: {
    backgroundColor: colors.bg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
});
