import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';

export default function AlertsScreen() {
  return (
    <Screen title="Alerts" subtitle="Budget alerts and daily summaries">
      <Card>
        <AppText tone="secondary">Budget alerts arrive in milestone M2.</AppText>
      </Card>
    </Screen>
  );
}
