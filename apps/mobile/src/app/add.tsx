import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { RequireSignIn } from '@/components/require-sign-in';
import { colors, spacing } from '@/theme/tokens';

export default function AddSpendModal() {
  return (
    <RequireSignIn>
      <View style={styles.container} role="main">
        <AppText variant="title">Add spend</AppText>
        <AppText tone="secondary">Quick transaction entry arrives in milestone M2.</AppText>
      </View>
    </RequireSignIn>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.xl, gap: spacing.sm },
});
