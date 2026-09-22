import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`surface-card rounded-xl p-5 shadow-sm ${className}`}>{children}</div>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-base font-semibold">{children}</h3>;
}

export function CardBody({ children }: { children: ReactNode }) {
  return <p className="text-muted mt-2 text-sm leading-relaxed">{children}</p>;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'accent';
}) {
  const tones = {
    neutral: 'bg-[var(--surface-muted)] text-[var(--text-muted)]',
    brand: 'bg-brand-600 text-white',
    accent: 'bg-accent-500 text-white',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6"
    >
      <h2 id={`${id}-heading`} className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="text-muted mt-3 max-w-3xl text-sm leading-relaxed">{subtitle}</p>
      ) : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}
