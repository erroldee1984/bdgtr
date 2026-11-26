/**
 * Automated WCAG 2.2 AA checks (axe-core) on the built website (docs/PLAN.md §9).
 * Runs in CI after the web build: `pnpm --filter @bdgtr/mobile test:a11y`.
 * These are the pages that render without signing in; signed-in screens are
 * covered by role-based component tests and the manual NVDA/TalkBack passes.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = [
  { path: '/sign-in', name: 'Sign in' },
  { path: '/privacy', name: 'Privacy' },
  { path: '/terms', name: 'Terms' },
  { path: '/invite/not-a-real-token', name: 'Invite link' },
  { path: '/no-such-page', name: 'Not found' },
];

for (const { path, name } of PAGES) {
  test(`${name} (${path}) has no WCAG 2.2 AA violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle').catch(() => {}); // Clerk may keep a connection open
    await page.locator('main, [role="main"]').first().waitFor({ timeout: 15_000 });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`);
    expect(summary, summary.join('\n')).toEqual([]);
  });
}

test('the first Tab stop is "Skip to content", and it moves focus to the content', async ({ page }) => {
  await page.goto('/privacy');
  await page.locator('main, [role="main"]').first().waitFor();
  await page.keyboard.press('Tab');
  const link = page.getByRole('link', { name: 'Skip to content' });
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();
  await page.keyboard.press('Enter');
  const focusedRole = await page.evaluate(() => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName.toLowerCase());
  expect(['main']).toContain(focusedRole);
});
