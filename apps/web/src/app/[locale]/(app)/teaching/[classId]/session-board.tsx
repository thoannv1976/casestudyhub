'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Assignment, CaseStudy, Group, PresentationSession } from '@casestudyhub/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { Alert, Button } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

/**
 * The lecturer's list of presentations for this class.
 *
 * Starting a session is what opens the room: the clock, the slide deck for the
 * rest of the class, and the question wall all follow from it. Only one
 * session may exist per assignment, so pressing start twice opens the same
 * room rather than splitting the class's questions across two of them.
 */
export function SessionBoard({
  assignments,
  groups,
  cases,
  sessions,
  classId,
  canGrade,
}: {
  assignments: Assignment[];
  groups: Group[];
  cases: CaseStudy[];
  sessions: PresentationSession[];
  classId: string;
  canGrade: boolean;
}) {
  const t = useTranslations('session');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const sessionOf = new Map(sessions.map((session) => [session.assignmentId, session]));

  async function start(assignmentId: string) {
    setBusy(assignmentId);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/assignments/${assignmentId}/session`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.push(`/sessions/${payload.session.id}`);
    } finally {
      setBusy(null);
    }
  }

  if (assignments.length === 0) {
    return <p className="text-muted text-sm">{t('noAssignments')}</p>;
  }

  return (
    <div className="space-y-4">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      <ul className="space-y-3">
        {assignments.map((assignment) => {
          const session = sessionOf.get(assignment.id);
          const group = groups.find((candidate) => candidate.id === assignment.groupId);
          const caseStudy = cases.find((candidate) => candidate.id === assignment.caseStudyId);

          return (
            <li
              key={assignment.id}
              className="surface-card flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
            >
              <div>
                <p className="text-sm font-medium">{group?.groupName ?? assignment.groupId}</p>
                <p className="text-muted mt-1 text-sm">
                  {caseStudy?.title ?? assignment.caseStudyId}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {session ? (
                  <>
                    <Badge tone={session.status === 'completed' ? 'neutral' : 'brand'}>
                      {t(`status.${session.status}`)}
                    </Badge>
                    <Link
                      href={`/sessions/${session.id}`}
                      className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
                    >
                      {t('open')}
                    </Link>
                  </>
                ) : (
                  <Button
                    disabled={busy === assignment.id}
                    onClick={() => void start(assignment.id)}
                  >
                    {t('start')}
                  </Button>
                )}
                {canGrade ? (
                  <Link
                    href={`/teaching/${classId}/grade/${assignment.id}`}
                    className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
                  >
                    {t('mark')}
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
