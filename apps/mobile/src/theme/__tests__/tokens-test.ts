import { contrastRatio, relativeLuminance } from '../contrast';
import { colors, MIN_TOUCH } from '../tokens';

const backgrounds = ['bg', 'surface', 'surfaceRaised'] as const;

describe('contrastRatio', () => {
  it('matches known reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio(colors.bg, colors.textPrimary)).toBeCloseTo(
      contrastRatio(colors.textPrimary, colors.bg),
      10,
    );
  });

  it.each(['red', '#FFF', '#GGGGGG', ''])('rejects malformed colour %j', (bad) => {
    expect(() => relativeLuminance(bad)).toThrow();
  });
});

describe('WCAG 2.2 AA: text contrast ≥ 4.5:1 on every surface', () => {
  const textTokens = ['textPrimary', 'textSecondary', 'primary', 'primaryLight', 'success', 'danger'] as const;

  for (const fg of textTokens) {
    for (const bg of backgrounds) {
      it(`${fg} on ${bg}`, () => {
        expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('onPrimary text on a primary button', () => {
    expect(contrastRatio(colors.onPrimary, colors.primary)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('WCAG 2.2 AA: non-text contrast ≥ 3:1 (focus ring, borders of controls)', () => {
  for (const bg of backgrounds) {
    it(`focusRing on ${bg}`, () => {
      expect(contrastRatio(colors.focusRing, colors[bg])).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('touch targets', () => {
  it('minimum target is at least 48dp (and well above WCAG 2.5.8 24px)', () => {
    expect(MIN_TOUCH).toBeGreaterThanOrEqual(48);
  });
});
