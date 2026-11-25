import { canManageMember, type Household, type Member, ROLE_LABELS, sortMembers } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { changeMemberRole, fetchMembers, removeMember, transferOwnership } from '@/lib/api';
import { colors, radius, spacing } from '@/theme/tokens';

import { useHousehold } from './household-context';

type Confirm = { kind: 'remove' | 'transfer' | 'leave'; member: Member } | null;

const displayName = (m: Member) => m.name ?? m.email ?? 'Unknown member';

/**
 * Members list (docs/PLAN.md §3): House Owner first with a crown and the text
 * "House Owner". Owners/Co-Owners can change roles and remove anyone except the
 * House Owner; the House Owner can transfer ownership; everyone but the House
 * Owner can leave. Destructive actions ask for confirmation inline (works on
 * web too, unlike native alert dialogs). The server enforces all of it again.
 */
export function MembersSection({
  household,
  onHouseholdChanged,
}: {
  household: Household;
  /** Re-reads the household details (your role changes after a transfer). */
  onHouseholdChanged: () => void;
}) {
  const { getToken } = useAuth();
  const { refresh } = useHousehold();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMembers(() => getToken(), household.id)
      .then((list) => {
        if (!alive) return;
        setMembers(sortMembers(list)); // House Owner first, whatever order arrives
        setLoadError(false);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [getToken, household.id, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  async function run(action: () => Promise<void>, done: string, after?: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setConfirm(null);
      setMessage({ tone: 'success', text: done });
      if (after) await after();
      else reload();
    } catch {
      setMessage({ tone: 'danger', text: "That didn't work. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const me = household.role;
  const token = () => getToken();

  if (loadError) {
    return (
      <Card>
        <AppText variant="title">Members</AppText>
        <AppText tone="danger" role="alert">
          Couldn&apos;t load the members.
        </AppText>
        <Button label="Try again" onPress={reload} compact />
      </Card>
    );
  }

  return (
    <Card>
      <AppText variant="title">Members</AppText>
      {!members ? (
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading members" />
      ) : (
        <View style={styles.list} role="list">
          {members.map((m) => {
            const manageable = !m.isYou && canManageMember(me, m.role);
            const canTransfer = me === 'owner' && !m.isYou;
            const confirming = confirm?.member.userId === m.userId ? confirm.kind : null;
            return (
              <View key={m.userId} style={styles.row} role="listitem" testID="member-row">
                <View style={styles.who}>
                  <View style={styles.nameLine}>
                    <AppText variant="bodyStrong">{displayName(m)}</AppText>
                    {m.isYou ? (
                      <AppText variant="caption" tone="secondary">
                        (you)
                      </AppText>
                    ) : null}
                  </View>
                  {m.name && m.email ? (
                    <AppText variant="caption" tone="secondary">
                      {m.email}
                    </AppText>
                  ) : null}
                  <View style={[styles.badge, m.role === 'owner' && styles.ownerBadge]}>
                    {m.role === 'owner' ? (
                      <MaterialCommunityIcons name="crown" size={16} color={colors.primaryLight} aria-hidden />
                    ) : null}
                    <AppText variant="caption">{ROLE_LABELS[m.role]}</AppText>
                  </View>
                </View>

                {confirming ? (
                  <View style={styles.confirm} role="alert">
                    <AppText>
                      {confirming === 'remove'
                        ? `Remove ${displayName(m)} from ${household.name}?`
                        : `Make ${displayName(m)} the House Owner? You'll become a Co-Owner.`}
                    </AppText>
                    <View style={styles.actions}>
                      <Button
                        label={confirming === 'remove' ? 'Remove' : 'Make House Owner'}
                        variant="danger"
                        compact
                        busy={busy}
                        onPress={() =>
                          confirming === 'remove'
                            ? void run(() => removeMember(token, household.id, m.userId), `${displayName(m)} was removed.`)
                            : void run(
                                () => transferOwnership(token, household.id, m.userId),
                                `${displayName(m)} is now the House Owner.`,
                                async () => {
                                  // Your role changed: refresh it everywhere, or the screen keeps Owner controls.
                                  await refresh(household.id);
                                  onHouseholdChanged();
                                  reload();
                                },
                              )
                        }
                      />
                      <Button label="Cancel" compact onPress={() => setConfirm(null)} />
                    </View>
                  </View>
                ) : manageable || canTransfer ? (
                  <View style={styles.actions}>
                    {manageable ? (
                      <Button
                        compact
                        busy={busy}
                        label={m.role === 'co_owner' ? 'Make House Member' : 'Make Co-Owner'}
                        accessibilityLabel={`${m.role === 'co_owner' ? 'Make House Member' : 'Make Co-Owner'}: ${displayName(m)}`}
                        onPress={() =>
                          void run(
                            () => changeMemberRole(token, household.id, m.userId, m.role === 'co_owner' ? 'member' : 'co_owner'),
                            `${displayName(m)} is now a ${m.role === 'co_owner' ? 'House Member' : 'Co-Owner'}.`,
                          )
                        }
                      />
                    ) : null}
                    {canTransfer ? (
                      <Button
                        compact
                        label="Make House Owner"
                        accessibilityLabel={`Make House Owner: ${displayName(m)}`}
                        onPress={() => setConfirm({ kind: 'transfer', member: m })}
                      />
                    ) : null}
                    {manageable ? (
                      <Button
                        compact
                        variant="danger"
                        label="Remove"
                        accessibilityLabel={`Remove ${displayName(m)}`}
                        onPress={() => setConfirm({ kind: 'remove', member: m })}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {message ? (
        <AppText tone={message.tone} aria-live="polite">
          {message.text}
        </AppText>
      ) : null}

      {me === 'owner' ? (
        <AppText variant="caption" tone="secondary">
          To leave this household, first make someone else the House Owner.
        </AppText>
      ) : members ? (
        <LeaveHousehold household={household} members={members} />
      ) : null}
    </Card>
  );
}

function LeaveHousehold({ household, members }: { household: Household; members: Member[] }) {
  const { getToken } = useAuth();
  const { refresh } = useHousehold();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const self = members.find((m) => m.isYou);
  if (!self) return null;

  async function leave() {
    setBusy(true);
    setFailed(false);
    try {
      await removeMember(() => getToken(), household.id, self!.userId);
      await refresh();
      router.replace('/');
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <View style={styles.leave}>
      {confirming ? (
        <View style={styles.confirm} role="alert">
          <AppText>{`Leave ${household.name}? You'll need a new invite to come back.`}</AppText>
          <View style={styles.actions}>
            <Button label="Leave household" variant="danger" compact busy={busy} onPress={() => void leave()} />
            <Button label="Cancel" compact onPress={() => setConfirming(false)} />
          </View>
        </View>
      ) : (
        <Button label="Leave household" variant="danger" icon="exit-run" onPress={() => setConfirming(true)} />
      )}
      {failed ? (
        <AppText tone="danger" role="alert">
          Couldn&apos;t leave the household. Check your connection and try again.
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md, marginTop: spacing.sm },
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  who: { gap: spacing.xs },
  nameLine: { flexDirection: 'row', gap: spacing.sm, alignItems: 'baseline', flexWrap: 'wrap' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  ownerBadge: { borderWidth: 1, borderColor: colors.primaryLight },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  confirm: { gap: spacing.sm },
  leave: { gap: spacing.sm, marginTop: spacing.md },
});
