'use client';

import { Award, FileText, ListChecks, Plus, Target, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { useShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Top bar "New" menu (IA §3.2): documents, achievement, goal. Hidden below 768 px. */
export function NewMenu() {
  const shell = useShell();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="hidden md:inline-flex">
          <Plus aria-hidden="true" />
          New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link href="/documents/new/appraisal">
            <FileText aria-hidden="true" />
            Appraisal
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/documents/new/promotion">
            <TrendingUp aria-hidden="true" />
            Promotion packet
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/documents/new/resume">
            <ListChecks aria-hidden="true" />
            Resume bullets
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            shell.openAchievement();
          }}
        >
          <Award aria-hidden="true" />
          Achievement
          <DropdownMenuShortcut>A</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            shell.setGoalDialogOpen(true);
          }}
        >
          <Target aria-hidden="true" />
          Goal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
