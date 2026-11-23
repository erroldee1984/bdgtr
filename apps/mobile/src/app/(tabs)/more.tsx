import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';

const SECTIONS = [
  'Budgets',
  'Categories',
  'Fixed transactions',
  'Household & members',
  'Settings',
] as const;

export default function MoreScreen() {
  return (
    <Screen title="More">
      {SECTIONS.map((section) => (
        <Card key={section}>
          <AppText variant="bodyStrong">{section}</AppText>
          <AppText variant="caption" tone="secondary">
            Coming in a later milestone
          </AppText>
        </Card>
      ))}
    </Screen>
  );
}
