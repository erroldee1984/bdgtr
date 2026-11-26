/** "Skip to content" (WCAG 2.4.1) and reduced motion (2.3.3). */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, Text } from 'react-native';

import { Dialog } from '@/components/dialog';
import { focusMainContent, SkipToContent } from '@/components/skip-to-content';

afterEach(() => jest.restoreAllMocks());

/** A fake page: elements with role="main", some hidden (no layout boxes). */
function page(mains: { visible: boolean; tabindex?: string }[]) {
  const els = mains.map((m) => {
    const attrs: Record<string, string> = m.tabindex ? { tabindex: m.tabindex } : {};
    return {
      attrs,
      focus: jest.fn(),
      getClientRects: () => (m.visible ? [{}] : []),
      hasAttribute: (n: string) => n in attrs,
      setAttribute: (n: string, v: string) => void (attrs[n] = v),
    };
  });
  return { els, doc: { querySelectorAll: () => els } as unknown as Document };
}

describe('focusMainContent', () => {
  it('focuses the visible screen’s content (hidden stacked screens are skipped), making it focusable', () => {
    const { els, doc } = page([{ visible: false }, { visible: true }]);
    expect(focusMainContent(doc)).toBe(true);
    expect(els[0]!.focus).not.toHaveBeenCalled();
    expect(els[1]!.focus).toHaveBeenCalled();
    expect(els[1]!.attrs.tabindex).toBe('-1');
  });

  it('keeps an existing tabindex; nothing to focus → false', () => {
    const { els, doc } = page([{ visible: true, tabindex: '0' }]);
    focusMainContent(doc);
    expect(els[0]!.attrs.tabindex).toBe('0');
    expect(focusMainContent(page([]).doc)).toBe(false);
    expect(focusMainContent(undefined)).toBe(false);
  });
});

describe('SkipToContent', () => {
  it('website: off-screen until focused, then shown; activating it moves focus', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const { els, doc } = page([{ visible: true }]);
    const original = globalThis.document;
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
    try {
      await render(<SkipToContent />);
      const link = screen.getByRole('link', { name: 'Skip to content' });
      expect(link).toHaveStyle({ left: -10000 });
      await fireEvent(link, 'focus');
      expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveStyle({ left: 8 });
      await fireEvent.press(link);
      expect(els[0]!.focus).toHaveBeenCalled();
      // Regression (M6b CI): Enter (and Space) must activate it, not only a click.
      els[0]!.focus.mockClear();
      const preventDefault = jest.fn();
      await fireEvent(link, 'keyDown', { key: 'Enter', preventDefault });
      expect(els[0]!.focus).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalled();
      await fireEvent(link, 'keyDown', { key: ' ', preventDefault });
      expect(els[0]!.focus).toHaveBeenCalledTimes(2);
      await fireEvent(link, 'keyDown', { key: 'Tab', preventDefault: jest.fn() });
      expect(els[0]!.focus).toHaveBeenCalledTimes(2);
      await fireEvent(link, 'blur');
      expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveStyle({ left: -10000 });
    } finally {
      Object.defineProperty(globalThis, 'document', { value: original, configurable: true });
    }
  });

  it('Android app: not shown (no keyboard skip needed)', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await render(<SkipToContent />);
    expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
  });
});

/** The modal's animationType, read from the rendered native host view. */
function modalAnimation(): unknown {
  type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
  const find = (n: Node | (Node | string)[] | string | null): Node | null => {
    if (!n || typeof n === 'string') return null;
    if (Array.isArray(n)) return n.map(find).find(Boolean) ?? null;
    if (n.type === 'Modal' || n.type === 'RCTModalHostView') return n;
    return find(n.children);
  };
  return find(screen.toJSON() as unknown as Node)?.props.animationType;
}

describe('reduced motion', () => {
  it('dialogs fade normally, and appear without animation when the person asked for less motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { rerender } = await render(<Dialog visible title="T" onClose={() => {}}><Text>x</Text></Dialog>);
    expect(modalAnimation()).toBe('fade');

    let changed: ((v: boolean) => void) | undefined;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_e: string, fn: (v: boolean) => void) => {
      changed = fn;
      return { remove: () => {} };
    }) as never);
    await rerender(<Dialog key="again" visible title="T" onClose={() => {}}><Text>x</Text></Dialog>);
    await act(async () => {});
    expect(modalAnimation()).toBe('none');
    await act(async () => changed?.(false)); // turned back off while open
    expect(modalAnimation()).toBe('fade');
  });
});
