import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';

import { Providers } from './providers';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';


import './globals.css';

// DESIGN_SYSTEM §4.2: Instrument Sans (UI) + JetBrains Mono (evidence refs, SHAs, formulas).
const sans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-instrument-sans',
  display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'DevImpact', template: '%s · DevImpact' },
  description:
    'Your engineering work, measured fairly and written up for you — every claim backed by a PR.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1014' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the `dark` class before paint (inline script) → no theme flash.
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
