/** Two-pane layouts on wide screens (docs/PLAN.md §8). */
import { render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';

import { isTwoPane, TwoPane } from '@/components/two-pane';

let mockClass = 'compact';
jest.mock('@/layout/window-class', () => ({ ...jest.requireActual('@/layout/window-class'), useWindowClass: () => mockClass }));

const texts = () => screen.getAllByText(/^(Main|Side)$/).map((t) => t.props.children);

describe('isTwoPane', () => {
  it.each([
    ['compact', 'medium', false],
    ['medium', 'medium', true],
    ['expanded', 'medium', true],
    ['compact', 'expanded', false],
    ['medium', 'expanded', false], // unfolded Fold 6: forms stay one column
    ['expanded', 'expanded', true],
  ] as const)('%s, from %s → %s', (wc, from, out) => expect(isTwoPane(wc, from)).toBe(out));
});

describe('TwoPane', () => {
  const ui = (props: Partial<Parameters<typeof TwoPane>[0]> = {}) => <TwoPane main={<Text>Main</Text>} side={<Text>Side</Text>} {...props} />;

  it('phones: stacked, main first (or side first when asked), no side-by-side row', async () => {
    mockClass = 'compact';
    await render(ui());
    expect(texts()).toEqual(['Main', 'Side']);
    expect(screen.queryByTestId('two-pane')).toBeNull();
    await render(ui({ sideFirstWhenStacked: true }));
    expect(texts()).toEqual(['Side', 'Main']);
  });

  it('wide: side by side, main then side in reading order even if stacked side-first', async () => {
    mockClass = 'expanded';
    await render(ui({ sideFirstWhenStacked: true }));
    const row = screen.getByTestId('two-pane');
    expect(row).toHaveStyle({ flexDirection: 'row' });
    expect(within(row).getAllByText(/^(Main|Side)$/).map((t) => t.props.children)).toEqual(['Main', 'Side']);
  });

  it('from="medium" goes side by side on the unfolded Fold; the default waits for expanded', async () => {
    mockClass = 'medium';
    await render(ui({ from: 'medium' }));
    expect(screen.getByTestId('two-pane')).toBeTruthy();
    await render(ui());
    expect(screen.queryByTestId('two-pane')).toBeNull();
  });
});
