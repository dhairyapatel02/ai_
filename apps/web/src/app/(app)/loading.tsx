import { PageSkeleton } from '@/components/states';

/** Route-level skeleton (UX-07): mirrors the page layout, never a lone spinner. */
export default function Loading() {
  return <PageSkeleton />;
}
