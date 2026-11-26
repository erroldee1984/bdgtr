import { BudgetsScreen } from '@/budgets/budgets-screen';
import { RequireSignIn } from '@/components/require-sign-in';
import { RequireHousehold } from '@/household/require-household';

/** More → Budgets. */
export default function BudgetsRoute() {
  return (
    <RequireSignIn>
      <RequireHousehold>
        <BudgetsScreen />
      </RequireHousehold>
    </RequireSignIn>
  );
}
