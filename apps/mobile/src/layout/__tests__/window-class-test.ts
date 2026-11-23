import { usesNavRail, windowClassFor } from '../window-class';

describe('windowClassFor', () => {
  it.each([
    [360, 'compact'], // Galaxy Z Fold 6 cover screen
    [384, 'compact'], // Galaxy S24 FE
    [412, 'compact'],
    [599, 'compact'],
    [600, 'medium'],
    [707, 'medium'], // Galaxy Z Fold 6 unfolded, portrait (~1856px / 2.625)
    [823, 'medium'], // Galaxy Z Fold 6 unfolded, landscape
    [839, 'medium'],
    [840, 'expanded'],
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

describe('usesNavRail', () => {
  it.each([
    [360, false], // Fold 6 cover screen
    [384, false], // Galaxy S24 FE
    [599, false],
    [600, true],
    [707, true], // Fold 6 unfolded portrait: must get the side rail
    [823, true], // Fold 6 unfolded landscape
    [1440, true], // desktop browser
  ] as const)('%i dp → rail %s', (width, expected) => {
    expect(usesNavRail(windowClassFor(width))).toBe(expected);
  });
});
