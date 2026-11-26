/** Month switcher: arrows and the month picker (docs/PLAN.md §6.8). */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MonthSwitcher, shiftMonth } from '@/components/month-switcher';

const onChange = jest.fn();
beforeEach(() => onChange.mockClear());

describe('MonthSwitcher', () => {
  it('arrows move a month; Next stops at max', async () => {
    await render(<MonthSwitcher month="2026-11" max="2026-11" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-10');
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  it('tap the month → pick any month, across years', async () => {
    await render(<MonthSwitcher month="2026-11" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'November 2026. Choose a month' }));
    expect(screen.getByRole('button', { name: 'November 2026' })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous year' }));
    await fireEvent.press(screen.getByRole('button', { name: 'March 2025' }));
    expect(onChange).toHaveBeenCalledWith('2025-03');
    expect(screen.queryByText('Choose a month')).toBeNull();
  });

  it('months after max cannot be picked; picking the same month changes nothing', async () => {
    await render(<MonthSwitcher month="2026-11" max="2026-11" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: /Choose a month/ }));
    expect(screen.getByRole('button', { name: 'December 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'November 2026' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Cancel closes it', async () => {
    await render(<MonthSwitcher month="2026-11" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: /Choose a month/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Choose a month')).toBeNull();
  });

  it('shiftMonth crosses years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});
