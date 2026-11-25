import { useAuth } from '@clerk/expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { RequireSignIn } from '@/components/require-sign-in';
import { TextField } from '@/components/text-field';
import { useHousehold } from '@/household/household-context';
import { type HouseholdFormErrors, validateHouseholdForm } from '@/household/household-form';
import { ApiError, createHousehold } from '@/lib/api';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

/**
 * "Create your household" (docs/PLAN.md §3 flow 1). Shown automatically when a
 * signed-in user has no household; also reachable as /onboarding?mode=new to
 * create an additional one.
 */
export default function OnboardingScreen() {
  return (
    <RequireSignIn>
      <CreateHousehold />
    </RequireSignIn>
  );
}

function CreateHousehold() {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { refresh, memberships } = useHousehold();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isAdditional = mode === 'new' || memberships.length > 0;

  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [errors, setErrors] = useState<HouseholdFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setSubmitError(null);
    const result = validateHouseholdForm({ name, budget });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const household = await createHousehold(() => getToken(), result.input);
      await refresh(household.id);
      router.replace('/');
    } catch (err) {
      setSubmitError(
        err instanceof ApiError && err.code === 'household_limit'
          ? "You've reached the maximum number of households."
          : "Couldn't create the household. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.column} role="main">
        <AppText variant="headline">{isAdditional ? 'Create another household' : 'Create your household'}</AppText>
        <AppText tone="secondary">
          You&apos;ll be its House Owner. You can invite others and change these later.
        </AppText>

        <View style={styles.form}>
          <TextField
            label="Household name"
            placeholder="e.g. Dela Cruz"
            value={name}
            onChangeText={setName}
            error={errors.name}
            autoCapitalize="words"
            maxLength={60}
            returnKeyType="next"
          />
          <TextField
            label="Default monthly budget"
            prefix="₱"
            placeholder="40,000"
            value={budget}
            onChangeText={setBudget}
            error={errors.budget}
            keyboardType="decimal-pad"
            hint="Used for every month unless you set a different budget for that month."
          />

          {submitError ? (
            <AppText tone="danger" role="alert">
              {submitError}
            </AppText>
          ) : null}

          <Pressable
            role="button"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <AppText variant="bodyStrong" style={{ color: colors.onPrimary }}>
                Create household
              </AppText>
            )}
          </Pressable>
          {isAdditional ? (
            <Pressable role="button" onPress={() => router.back()} style={styles.secondary}>
              <AppText variant="bodyStrong" tone="accent">
                Cancel
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: spacing.lg },
  column: { width: '100%', maxWidth: 480, gap: spacing.sm },
  form: { marginTop: spacing.xl, gap: spacing.lg },
  primary: {
    minHeight: MIN_TOUCH + 8,
    borderRadius: radius.button,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  secondary: { minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
