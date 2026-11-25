import {
  can,
  formatPHP,
  type Household,
  parseAmountInput,
  ROLE_LABELS,
  UpdateHouseholdInputSchema,
} from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { RequireSignIn } from '@/components/require-sign-in';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { useHousehold } from '@/household/household-context';
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

  return <HouseholdEditor key={household.id} household={household} onSaved={setHousehold} />;
}

function HouseholdEditor({ household, onSaved }: { household: Household; onSaved: (h: Household) => void }) {
  const { getToken } = useAuth();
  const { refresh } = useHousehold();
  const [name, setName] = useState(household.name);
  const [budget, setBudget] = useState((household.defaultMonthlyBudgetMinor / 100).toFixed(2));
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; budget?: string }>({});
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const canEdit = can(household.role, 'manage_household');
  const canDelete = can(household.role, 'delete_household');

  async function save() {
    setStatus(null);
    const amount = parseAmountInput(budget);
    const errs: typeof fieldErrors = {};
    if (!amount.ok) errs.budget = 'Enter an amount like 40,000 or 40000.50';
    const parsed = UpdateHouseholdInputSchema.safeParse({
      name,
      defaultMonthlyBudgetMinor: amount.ok ? amount.amountMinor : household.defaultMonthlyBudgetMinor,
    });
    if (!parsed.success) {
      const nameIssue = parsed.error.issues.find((i) => i.path[0] === 'name');
      if (nameIssue) errs.name = nameIssue.message;
    }
    setFieldErrors(errs);
    if (errs.name || errs.budget || !parsed.success) return;
    setSaving(true);
    try {
      const updated = await updateHousehold(() => getToken(), household.id, parsed.data);
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

      <Card>
        <AppText variant="title">Members & invites</AppText>
        <AppText tone="secondary">Inviting and managing members arrives in the next update (M1c).</AppText>
      </Card>

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
