import { RequireSignIn } from '@/components/require-sign-in';
import { RequireHousehold } from '@/household/require-household';
import { SettingsScreen } from '@/settings/settings-screen';

/** More → Settings. */
export default function Settings() {
  return (
    <RequireSignIn>
      <RequireHousehold>
        <SettingsScreen />
      </RequireHousehold>
    </RequireSignIn>
  );
}
