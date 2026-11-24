'use client';

import { AchievementDialog } from '@/components/career/achievement-dialog';
import { GoalDialog } from '@/components/career/goal-dialog';

import { useShell } from './shell-context';

/** The shell-wide "Add achievement" / "Add goal" dialogs (FLOWS F7/F8). */
export function CareerDialogs() {
  const s = useShell();
  return (
    <>
      <AchievementDialog
        open={s.achievementDialog.open}
        prefill={s.achievementDialog.prefill}
        onOpenChange={(open) => {
          if (!open) s.closeAchievement();
        }}
      />
      <GoalDialog open={s.goalDialogOpen} onOpenChange={s.setGoalDialogOpen} />
    </>
  );
}
