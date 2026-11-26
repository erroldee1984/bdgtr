import { CategoryAllocationScreen } from '@/budgets/category-allocation-screen';
import { RequireSignIn } from '@/components/require-sign-in';
import { RequireHousehold } from '@/household/require-household';

/** More → Budgets → Budget per Category. */
export default function CategoryAllocationRoute() {
  return (
    <RequireSignIn>
      <RequireHousehold>
        <CategoryAllocationScreen />
      </RequireHousehold>
    </RequireSignIn>
  );
}
