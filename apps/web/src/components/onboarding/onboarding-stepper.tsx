import { cn } from '@/lib/utils';

export const ONBOARDING_STEPS = [
  'Connect GitHub data',
  'Review repositories',
  'First sync',
] as const;

/**
 * Wizard progress (DESIGN_SYSTEM §5.2 OnboardingStepper): 3 labelled bars in an `<ol>` with
 * `aria-current="step"`; on phones the labels collapse to "Step 1 of 3 · Connect GitHub data".
 */
export function OnboardingStepper({ current }: { current: 0 | 1 | 2 }) {
  return (
    <div className="mb-8">
      <p className="mb-2 text-sm font-medium text-muted-foreground sm:hidden" aria-hidden="true">
        Step {current + 1} of {ONBOARDING_STEPS.length} · {ONBOARDING_STEPS[current]}
      </p>
      <ol aria-label="Setup progress" className="grid grid-cols-3 gap-2">
        {ONBOARDING_STEPS.map((label, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'todo';
          return (
            <li
              key={label}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex flex-col gap-1.5"
            >
              <span
                className={cn('h-1 rounded-full', state === 'todo' ? 'bg-surface-3' : 'bg-primary')}
                aria-hidden="true"
              />
              <span
                className={cn(
                  'text-caption max-sm:sr-only',
                  state === 'current' ? 'font-medium text-foreground' : 'text-subtle-foreground',
                )}
              >
                Step {index + 1} · {label}
                {state === 'done' ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
