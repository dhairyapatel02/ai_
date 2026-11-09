import { Inter } from 'next/font/google';

import { Sidebar } from '@/components/sidebar';
import { AuthProvider } from '@/lib/auth-context';

import type { Metadata } from 'next';

import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DevImpact AI — Engineering Career OS',
  description: 'AI-powered Engineering Career Operating System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
