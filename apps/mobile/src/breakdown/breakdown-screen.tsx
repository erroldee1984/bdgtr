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
import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { useMonthParam } from '@/budgets/budgets-screen';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Dialog } from '@/components/dialog';
import { MonthSwitcher } from '@/components/month-switcher';
import { Screen } from '@/components/screen';
import { useHousehold } from '@/household/household-context';
import { usesNavRail, useWindowClass } from '@/layout/window-class';
import { ApiError } from '@/lib/api';
import { colors, spacing } from '@/theme/tokens';

import { BreakdownRow, type RowAction, shortDate } from './breakdown-row';
import { parseRange, type RangeText } from './filter-form';
import { FilterPanel } from './filter-panel';
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
  const { transactions, categories, pinnedIds, error, reload, togglePin, remove } = useBreakdown(month);
  const windowClass = useWindowClass();
  const showMenuButton = Platform.OS === 'web' || usesNavRail(windowClass);
  const canDeleteAny = !!active && can(active.role, 'edit_any_transaction');

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [range, setRange] = useState<RangeText>(NO_RANGE);
  const [sort, setSort] = useState<BreakdownSort>(DEFAULT_SORT);
  const [details, setDetails] = useState<Transaction | null>(null);
  const [menu, setMenu] = useState<Transaction | null>(null);
  const [confirming, setConfirming] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

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
    else if (action === 'menu') setMenu(tx);
    else if (action === 'pin') {
      const was = pinnedIds.has(tx.id);
      togglePin(tx);
      setMessage({ tone: 'success', text: was ? 'Unpinned.' : 'Pinned to the top.' });
    } else if (action === 'delete' && canDelete(tx)) setConfirming(tx);
  }

  async function confirmDelete() {
    const tx = confirming;
    if (!tx) return;
    setDeleting(true);
    try {
      await remove(tx);
      setMessage({ tone: 'success', text: `Deleted ${nameOf(tx)} ${formatPHP(tx.amountMinor)}.` });
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

      <Card>
        <Button
          label={filterCount ? `Filters and sort (${filterCount} on)` : 'Filters and sort'}
          icon={filtersOpen ? 'chevron-up' : 'filter-variant'}
          compact
          accessibilityLabel={`Filters and sort${filterCount ? `, ${filterCount} filters on` : ''}, ${filtersOpen ? 'expanded' : 'collapsed'}`}
          onPress={() => setFiltersOpen(!filtersOpen)}
        />
        {filtersOpen ? (
          <FilterPanel
            categories={categories}
            categoryIds={categoryIds}
            onToggleCategory={(id) => setCategoryIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))}
            range={range}
            rangeResult={rangeResult}
            onRangeChange={setRange}
            sort={sort}
            onSortChange={setSort}
            onClear={clearFilters}
          />
        ) : null}
      </Card>

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
      ) : rows.length === 0 ? (
        <Card>
          <AppText tone="secondary">No spends match these filters.</AppText>
          <Button label="Clear filters" icon="filter-remove-outline" compact onPress={clearFilters} />
        </Card>
      ) : (
        <>
          <AppText variant="caption" tone="secondary" aria-live="polite">
            {listSummary(rows.length, transactions.length, shownSum)}
          </AppText>
          {showMenuButton ? null : (
            <AppText variant="caption" tone="secondary">
              Swipe right to pin, left to delete. Press and hold for more.
            </AppText>
          )}
          <View style={styles.list} role="list" aria-label="Spends">
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
                  showMenuButton={showMenuButton}
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
          actions={<Button label="Close" compact onPress={() => setDetails(null)} />}
        >
          <AppText tone="secondary">{shortDate(details.date)}</AppText>
          <AppText tone={details.description ? 'primary' : 'secondary'}>{details.description || 'No description'}</AppText>
        </Dialog>
      ) : null}

      {menu ? (
        <Dialog
          visible
          title={`${shortDate(menu.date)} · ${nameOf(menu)} · ${formatPHP(menu.amountMinor)}`}
          onClose={() => setMenu(null)}
          actions={
            <>
              <Button label="Show description" icon="text" compact onPress={() => (setMenu(null), setDetails(menu))} />
              <Button
                label={pinnedIds.has(menu.id) ? 'Unpin' : 'Pin'}
                icon={pinnedIds.has(menu.id) ? 'pin-off' : 'pin'}
                compact
                onPress={() => (setMenu(null), onAction('pin', menu))}
              />
              {canDelete(menu) ? (
                <Button label="Delete" icon="trash-can-outline" variant="danger" compact onPress={() => (setMenu(null), setConfirming(menu))} />
              ) : null}
              <Button label="Cancel" compact onPress={() => setMenu(null)} />
            </>
          }
        >
          {canDelete(menu) ? null : (
            <AppText variant="caption" tone="secondary">
              Only the person who entered this spend, the House Owner or a Co-Owner can delete it.
            </AppText>
          )}
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
              <Button label="Delete" icon="trash-can-outline" variant="danger" compact busy={deleting} onPress={() => void confirmDelete()} />
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
  list: { gap: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.border },
  groupHead: { backgroundColor: colors.bg, paddingTop: spacing.md, paddingBottom: spacing.xs },
});
