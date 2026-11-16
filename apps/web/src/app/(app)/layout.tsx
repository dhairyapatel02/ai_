import { Sidebar } from '@/components/sidebar';

/** Signed-in shell (functional only; the real shell is P09). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
    </div>
  );
}
