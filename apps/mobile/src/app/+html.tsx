import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Root HTML for the static web build only (never runs on Android).
 * Sets the page language and title (WCAG 3.1.1, 2.4.2) and lets users zoom.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en-PH">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* No maximum-scale / user-scalable=no: pinch-zoom must stay available (WCAG 1.4.4). */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#12152B" />
        <meta name="color-scheme" content="dark" />
        <meta name="description" content="bdgtr: household budgeting and expense tracking" />
        <title>bdgtr</title>
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: 'html,body{background-color:#12152B;}' }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
