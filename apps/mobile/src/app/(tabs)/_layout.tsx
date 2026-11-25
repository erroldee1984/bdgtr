import { AppNav } from '@/components/app-nav';
import { RequireSignIn } from '@/components/require-sign-in';
import { RequireHousehold } from '@/household/require-household';

export default function TabsLayout() {
  return (
    <RequireSignIn>
      <RequireHousehold>
        <AppNav />
      </RequireHousehold>
    </RequireSignIn>
  );
}
