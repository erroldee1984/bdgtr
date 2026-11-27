/** Budget per Category: the multi-colour allocation ring (docs/PLAN.md §6.7). */
import { allocation } from '@bdgtr/shared';
import { render, screen } from '@testing-library/react-native';

import { AllocationDonut, slices } from '@/budgets/allocation-donut';

const cats = [
  { id: 'g', name: 'Groceries', colour: '#5A94FF', budgetMinor: 1_000_000 },
  { id: 'b', name: 'Bills', colour: '#4ADE80', budgetMinor: 500_000 },
  { id: 'z', name: 'Gifts', colour: '#F472B6', budgetMinor: 0 },
];

describe('slices', () => {
  it('one per category with a budget, in order, as shares of the monthly budget', () => {
    expect(slices(cats, 4_000_000)).toEqual([
      { id: 'g', colour: '#5A94FF', start: 0, size: 0.25 },
      { id: 'b', colour: '#4ADE80', start: 0.25, size: 0.125 },
    ]);
  });

  it('over-allocated: shares of what the categories add up to, so the ring is full, not overflowing', () => {
    const s = slices(cats, 1_000_000);
    expect(s.map((x) => x.size)).toEqual([1_000_000 / 1_500_000, 500_000 / 1_500_000]);
    expect(s.at(-1)!.start + s.at(-1)!.size).toBeCloseTo(1);
  });

  it('nothing to draw: no budget anywhere', () => {
    expect(slices(cats.map((c) => ({ ...c, budgetMinor: 0 })), 0)).toEqual([]);
  });
});

describe('AllocationDonut', () => {
  it('a coloured slice per budgeted category, and a legend naming each colour with its share', async () => {
    await render(<AllocationDonut allocation={allocation(4_000_000, [1_000_000, 500_000, 0])} totalMinor={4_000_000} categories={cats} />);
    expect(screen.getAllByTestId('donut-slice', { includeHiddenElements: true })).toHaveLength(2); // colours: see slices()
    expect(screen.getByLabelText('Groceries, ₱10,000.00, 25% of the monthly budget')).toBeTruthy();
    expect(screen.getByLabelText('Bills, ₱5,000.00, 13% of the monthly budget')).toBeTruthy();
    expect(screen.queryByText(/^Gifts/)).toBeNull(); // no budget, no slice, no legend entry
    expect(screen.getByLabelText('37% of ₱40,000.00 allocated, ₱25,000.00 unallocated')).toBeTruthy(); // rounded down, like everywhere
  });

  it('over-allocated still says so in words, not just colour', async () => {
    await render(<AllocationDonut allocation={allocation(1_000_000, [1_000_000, 500_000])} totalMinor={1_000_000} categories={cats} />);
    expect(screen.getByText('Over-allocated by ₱5,000.00', { includeHiddenElements: true })).toBeTruthy();
  });
});
