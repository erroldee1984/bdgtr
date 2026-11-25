import { CategoriesManager } from '@/categories/categories-manager';
import { RequireSignIn } from '@/components/require-sign-in';
import { RequireHousehold } from '@/household/require-household';

/** More → Categories. */
export default function CategoriesScreen() {
  return (
    <RequireSignIn>
      <RequireHousehold>
        <CategoriesManager />
      </RequireHousehold>
    </RequireSignIn>
  );
}
