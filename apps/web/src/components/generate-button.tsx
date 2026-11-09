'use client';

import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';

interface GenerateButtonProps {
  loading: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}

export function GenerateButton({ loading, onClick, children }: GenerateButtonProps) {
  return (
    <Button onClick={onClick} disabled={loading} size="lg" className="gap-2">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {loading ? 'Generating...' : children || 'Generate'}
    </Button>
  );
}
