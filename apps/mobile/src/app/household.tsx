import { can, formatPHP, type Household, ROLE_LABELS } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { RequireSignIn } from '@/components/require-sign-in';
import { Screen } from '@/components/screen';
import { TwoPane } from '@/components/two-pane';
import { TextField } from '@/components/text-field';
import { useHousehold } from '@/household/household-context';
import { type HouseholdFormErrors, validateHouseholdForm } from '@/household/household-form';
import { InvitesSection } from '@/household/invites-section';
import { MembersSection } from '@/household/members-section';
import { RequireHousehold } from '@/household/require-household';
import { useActiveHouseholdDetails } from '@/household/use-active-household';
import { deleteHousehold, updateHousehold } from '@/lib/api';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

/** More → Household: details for everyone; edit for Owner/Co-Owner; delete for the House Owner. */
export default function HouseholdScreen() {
  return (
    <RequireSignIn>
      <RequireHousehold>
        <HouseholdDetails />
      </RequireHousehold>
    </RequireSignIn>
  );
}

function HouseholdDetails() {
  const { household, error, reload, setHousehold } = useActiveHouseholdDetails();

  if (error) {
    return (
      <Screen title="Household">
        <AppText tone="danger" role="alert">
          Couldn&apos;t load this household.
        </AppText>
        <Pressable role="button" onPress={reload} style={styles.primary}>
          <AppText variant="bodyStrong" style={{ color: colors.onPrimary }}>
            Try again
          </AppText>
        </Pressable>
      </Screen>
    );
  }
  if (!household) {
    return (
      <Screen title="Household">
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading household" />
      </Screen>
    );
  }

  return <HouseholdEditor key={household.id} household={household} onSaved={setHousehold} onChanged={reload} />;
}

function HouseholdEditor({
  household,
  onSaved,
  onChanged,
}: {
  household: Household;
  onSaved: (h: Household) => void;
  /** Re-reads the household (e.g. your role changed after transferring ownership). */
  onChanged: () => void;
}) {
  const { getToken } = useAuth();
  const { refresh } = useHousehold();
  const [name, setName] = useState(household.name);
  const [budget, setBudget] = useState((household.defaultMonthlyBudgetMinor / 100).toFixed(2));
  const [fieldErrors, setFieldErrors] = useState<HouseholdFormErrors>({});
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const canEdit = can(household.role, 'manage_household');
  const canDelete = can(household.role, 'delete_household');

  async function save() {
    setStatus(null);
    // Same checks and messages as "Create your household".
    const result = validateHouseholdForm({ name, budget });
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const updated = await updateHousehold(() => getToken(), household.id, result.input);
      onSaved(updated);
      await refresh(updated.id); // the switcher shows the new name
      setStatus('Saved.');
    } catch {
      setStatus("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (confirmName.trim() !== household.name) return;
    setDeleting(true);
    try {
      await deleteHousehold(() => getToken(), household.id);
      await refresh();
      router.replace('/');
    } catch {
      setStatus("Couldn't delete the household. Try again.");
      setDeleting(false);
    }
  }

  return (
    <Screen title={household.name} subtitle={`Your role: ${ROLE_LABELS[household.role]}`}>
      <Card>
        <AppText variant="title">Details</AppText>
        {canEdit ? (
          <View style={styles.form}>
            <TextField label="Household name" value={name} onChangeText={setName} error={fieldErrors.name} maxLength={60} />
            <TextField
              label="Default monthly budget"
              prefix="₱"
              value={budget}
              onChangeText={setBudget}
              error={fieldErrors.budget}
              keyboardType="decimal-pad"
            />
            <Pressable
              role="button"
              accessibilityState={{ busy: saving, disabled: saving }}
              disabled={saving}
              onPress={save}
              style={({ pressed }) => [styles.primary, (pressed || saving) && styles.pressed]}
            >
              <AppText variant="bodyStrong" style={{ color: colors.onPrimary }}>
                {saving ? 'Saving…' : 'Save changes'}
              </AppText>
            </Pressable>
            {status ? (
              <AppText tone={status === 'Saved.' ? 'success' : 'danger'} aria-live="polite">
                {status}
              </AppText>
            ) : null}
          </View>
        ) : (
          <View style={styles.form}>
            <AppText tone="secondary">Default monthly budget</AppText>
            <AppText variant="title">{formatPHP(household.defaultMonthlyBudgetMinor)}</AppText>
            <AppText variant="caption" tone="secondary">
              Only the House Owner or a Co-Owner can change these.
            </AppText>
          </View>
        )}
      </Card>

      {can(household.role, 'manage_members') ? (
        <TwoPane
          mainFlex={1}
          sideFlex={1}
          main={<MembersSection household={household} onHouseholdChanged={onChanged} />}
          side={<InvitesSection household={household} />}
        />
      ) : (
        <MembersSection household={household} onHouseholdChanged={onChanged} />
      )}

      {canDelete ? (
        <Card style={styles.danger}>
          <AppText variant="title">Delete household</AppText>
          <AppText tone="secondary">
            Removes this household for everyone in it. Type its name to confirm.
          </AppText>
          <TextField label="Household name to confirm" value={confirmName} onChangeText={setConfirmName} autoCapitalize="none" />
          <Pressable
            role="button"
            accessibilityState={{ disabled: confirmName.trim() !== household.name || deleting }}
            disabled={confirmName.trim() !== household.name || deleting}
            onPress={remove}
            style={({ pressed }) => [
              styles.deleteButton,
              (confirmName.trim() !== household.name || deleting) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <AppText variant="bodyStrong" tone="danger">
              {deleting ? 'Deleting…' : 'Delete household'}
            </AppText>
          </Pressable>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg, marginTop: spacing.sm },
  primary: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.button,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pressed: { opacity: 0.8 },
  danger: { borderWidth: 1, borderColor: colors.danger },
  deleteButton: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
});
