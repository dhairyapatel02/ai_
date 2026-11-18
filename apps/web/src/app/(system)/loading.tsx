import { LoaderCircle } from 'lucide-react';

export default function SystemLoading() {
  return (
    <p className="flex items-center justify-center gap-2 text-muted-foreground" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      Loading…
    </p>
  );
}
