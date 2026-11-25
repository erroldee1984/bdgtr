import { RequireSignIn } from '@/components/require-sign-in';
import { RequireHousehold } from '@/household/require-household';
import { AddSpendForm } from '@/spend/add-spend-form';

/** Add spend: a modal on phones (docs/PLAN.md §6.3). */
export default function AddSpendModal() {
  return (
    <RequireSignIn>
      <RequireHousehold>
        <AddSpendForm />
      </RequireHousehold>
    </RequireSignIn>
  );
}
