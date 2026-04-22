import React from 'react';

export type StepperState = 1 | 2 | 3 | 'done' | 'error';

interface ConnectStepperProps {
  currentStep: StepperState;
  errorOnStep?: 1 | 2 | 3;
}

const LABELS: Record<1 | 2 | 3, string> = {
  1: 'Numero',
  2: 'QR',
  3: 'Dashboard',
};

function stateOf(
  step: 1 | 2 | 3,
  currentStep: StepperState,
  errorOnStep?: 1 | 2 | 3
): 'active' | 'completed' | 'pending' | 'error' {
  if (currentStep === 'error') {
    if (errorOnStep && step === errorOnStep) return 'error';
    if (errorOnStep && step < errorOnStep) return 'completed';
    return 'pending';
  }
  if (currentStep === 'done') return 'completed';
  // currentStep is 1 | 2 | 3
  if (step < currentStep) return 'completed';
  if (step === currentStep) return 'active';
  return 'pending';
}

function labelText(step: 1 | 2 | 3, state: string): string {
  const name = LABELS[step];
  if (state === 'completed') return `✓ ${name}`;
  if (state === 'error') return `⚠ ${name}`;
  return `${step} · ${name}`;
}

function progressPercent(currentStep: StepperState, errorOnStep?: 1 | 2 | 3): number {
  if (currentStep === 'done') return 100;
  if (currentStep === 'error') {
    return errorOnStep ? Math.round((errorOnStep / 3) * 100) : 33;
  }
  return Math.round((currentStep / 3) * 100);
}

export default function ConnectStepper({ currentStep, errorOnStep }: ConnectStepperProps) {
  const pct = progressPercent(currentStep, errorOnStep);
  const isError = currentStep === 'error';
  const variant = isError ? 'error' : 'normal';

  const steps: (1 | 2 | 3)[] = [1, 2, 3];

  return (
    <nav aria-label="Progresso connessione" className="mb-5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider mb-1.5 font-semibold">
        {steps.map((s) => {
          const st = stateOf(s, currentStep, errorOnStep);
          const className =
            st === 'active'
              ? 'text-[#25D366]'
              : st === 'error'
              ? 'text-red-500'
              : 'text-slate-400';
          return (
            <span
              key={s}
              data-state={st}
              aria-current={st === 'active' ? 'step' : undefined}
              className={className}
            >
              {labelText(s, st)}
            </span>
          );
        })}
      </div>
      <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          data-variant={variant}
          className={`h-full rounded-full transition-all ${
            isError ? 'bg-red-400' : 'bg-[#25D366]'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </nav>
  );
}
