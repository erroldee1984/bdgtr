import { CategoryAllocationScreen } from '@/budgets/category-allocation-screen';
import { RequireSignIn } from '@/components/require-sign-in';
import { RequireHousehold } from '@/household/require-household';

/** More → Budgets → Allocate per category. */
export default function CategoryAllocationRoute() {
  return (
    <RequireSignIn>
      <RequireHousehold>
        <CategoryAllocationScreen />
      </RequireHousehold>
    </RequireSignIn>
  );
}
