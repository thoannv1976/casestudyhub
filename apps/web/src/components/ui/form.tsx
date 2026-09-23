import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-muted text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClasses =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm ' +
  'transition-colors focus:border-brand-500 disabled:opacity-60 aria-[invalid=true]:border-red-500';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={controlClasses} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={controlClasses} />;
}

export function Button({
  children,
  type = 'button',
  variant = 'primary',
  disabled,
  onClick,
  className = '',
}: {
  children: ReactNode;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
    ghost: 'surface-card hover:border-brand-400',
  } as const;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Alert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const tones = {
    error:
      'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    success:
      'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-900 dark:text-brand-100',
  } as const;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      // Next.js injects its own role="alert" route announcer, so a test needs a
      // way to find this element and only this one.
      data-testid={tone === 'error' ? 'alert-error' : 'alert-success'}
      className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
