import { Link } from 'expo-router';

import { AppText } from '@/components/app-text';
import { Screen } from '@/components/screen';

export default function NotFoundScreen() {
  return (
    <Screen title="Page not found" subtitle="That page doesn't exist.">
      <Link href="/">
        <AppText variant="bodyStrong" tone="accent">
          Go to the dashboard
        </AppText>
      </Link>
    </Screen>
  );
}
