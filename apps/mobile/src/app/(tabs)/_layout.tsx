import { AppNav } from '@/components/app-nav';
import { RequireSignIn } from '@/components/require-sign-in';

export default function TabsLayout() {
  return (
    <RequireSignIn>
      <AppNav />
    </RequireSignIn>
  );
}
