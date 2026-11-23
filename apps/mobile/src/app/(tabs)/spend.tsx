import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';

export default function SpendScreen() {
  return (
    <Screen title="Spend" subtitle="Monthly spend breakdown">
      <Card>
        <AppText tone="secondary">
          Filters, sorting, pins and swipe actions arrive in milestone M4.
        </AppText>
      </Card>
    </Screen>
  );
}
