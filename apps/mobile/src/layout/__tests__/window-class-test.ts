import { windowClassFor } from '../window-class';

describe('windowClassFor', () => {
  it.each([
    [360, 'compact'], // Galaxy Z Fold 6 cover screen
    [384, 'compact'], // Galaxy S24 FE
    [412, 'compact'],
    [599, 'compact'],
    [600, 'medium'],
    [839, 'medium'],
    [840, 'expanded'], // Galaxy Z Fold 6 unfolded
    [880, 'expanded'],
    [1440, 'expanded'], // desktop browser
  ] as const)('%i dp → %s', (width, expected) => {
    expect(windowClassFor(width)).toBe(expected);
  });

  it.each([Number.NaN, -1, Number.NEGATIVE_INFINITY])(
    'falls back to compact for nonsense width %s',
    (width) => {
      expect(windowClassFor(width)).toBe('compact');
    },
  );
});
