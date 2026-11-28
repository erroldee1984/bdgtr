import { UnreadAlertsProvider } from '@/alerts/unread-alerts';
import { AppNav } from '@/components/app-nav';
import { RequireSignIn } from '@/components/require-sign-in';
import { RequireHousehold } from '@/household/require-household';
import { OfflineWarmup } from '@/offline/offline-warmup';
import { UpdateReadyProvider } from '@/updates/update-ready';

export default function TabsLayout() {
  return (
    <RequireSignIn>
      <RequireHousehold>
        <UnreadAlertsProvider>
          <UpdateReadyProvider>
            <OfflineWarmup />
            <AppNav />
          </UpdateReadyProvider>
        </UnreadAlertsProvider>
      </RequireHousehold>
    </RequireSignIn>
  );
}
