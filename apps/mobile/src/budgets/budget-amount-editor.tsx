import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { parseOptionalBudget } from '@/categories/category-form';
import { spacing } from '@/theme/tokens';

/** Centavos as you'd type them: 4000000 → "40000", 450050 → "4500.50". */
export function amountText(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/**
 * One peso amount, edited in place. Empty or 0 means ₱0. `onSave` answers
 * null when saved, or a message to show (the field stays open).
 */
export function BudgetAmountEditor({
  label,
  hint,
  initialMinor,
  onSave,
  onCancel,
}: {
  label: string;
  hint?: string;
  initialMinor: number;
  onSave: (minor: number) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(amountText(initialMinor));
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function save() {
    const parsed = parseOptionalBudget(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(undefined);
    const problem = await onSave(parsed.minor);
    setBusy(false);
    if (problem) setError(problem);
  }

  return (
    <View style={styles.wrap}>
      <TextField
        label={label}
        hint={hint}
        prefix="₱"
        value={text}
        onChangeText={setText}
        error={error}
        keyboardType="decimal-pad"
        autoFocus
        onSubmitEditing={() => void save()}
      />
      <View style={styles.row}>
        <Button label="Save" variant="primary" compact busy={busy} onPress={() => void save()} />
        <Button label="Cancel" compact disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
});
