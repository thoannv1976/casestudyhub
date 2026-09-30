'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  PROGRESS_FILTERS,
  PROGRESS_TONE,
  matchesFilter,
  type ProgressFilter,
} from '@casestudyhub/shared';
import { Badge, type BadgeTone } from '@/components/ui/card';
import type { ClassOverview } from '@casestudyhub/core';
import { Link } from '@/i18n/navigation';

/**
 * The class's workload, one row per piece of work a group owes.
 *
 * Rows rather than a cell per group: a group can have two cases and always has
 * the project, and a grid with a variable number of columns is a grid nobody
 * can read. The filter is the same one the progress table uses, because a
 * lecturer asking "which ones are behind" is asking the same question here.
 */
/**
 * The colour of a number on the summary tiles.
 *
 * Only three of the seven ever take one. The rest are counts of work, and a
 * page where every number is coloured is a page where none of them stands out.
 */
function TOTAL_COLOUR(key: string, value: number): string {
  if (value === 0) return '';
  if (key === 'missing' || key === 'late') return 'text-[var(--tone-danger-fg)]';
  if (key === 'published') return 'text-[var(--tone-success-fg)]';
  return '';
}

/** Marking reads the same way everywhere: done, in hand, not started. */
const MARKING_TONE: Readonly<Record<string, BadgeTone>> = {
  published: 'success',
  draft: 'warning',
  unmarked: 'neutral',
};

export function OverviewTable({ classId, overview }: { classId: string; overview: ClassOverview }) {
  const t = useTranslations('overview');
  const format = useFormatter();
  const tProgress = useTranslations('progress');
  const tProject = useTranslations('project');
  const [filter, setFilter] = useState<ProgressFilter>('all');

  const visible = overview.rows.filter((row) => matchesFilter(row.progress, filter));

  const subjectOf = (row: ClassOverview['rows'][number]) => row.subject ?? tProject('subject');
  const markingHref = (row: ClassOverview['rows'][number]) =>
    row.kind === 'group_project'
      ? `/teaching/${classId}/project/${row.groupId}`
      : `/teaching/${classId}/grade/${row.targetId}`;

  return (
    <div className="space-y-4" data-testid="class-overview">
      <ul className="flex flex-wrap gap-3 text-sm" data-testid="overview-totals">
        {(
          [
            ['work', overview.totals.work],
            ['complete', overview.totals.complete],
            ['missing', overview.totals.missing],
            ['late', overview.totals.late],
            ['unmarked', overview.totals.unmarked],
            ['draft', overview.totals.draft],
            ['published', overview.totals.published],
          ] as const
        ).map(([key, value]) => (
          <li key={key} className="surface-card min-w-28 rounded-xl px-4 py-3">
            {/* A count of nothing is good news for "missing" and "late", and
                colouring a zero red would cry wolf. So the tile only takes a
                colour when the number has something to say. */}
            <p className={`text-2xl font-semibold tabular-nums ${TOTAL_COLOUR(key, value)}`}>
              {value}
            </p>
            <p className="text-muted mt-1 text-xs">{t(`totals.${key}`)}</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted text-sm">{tProgress('filterLabel')}</span>
        {PROGRESS_FILTERS.map((option) => {
          const count = overview.rows.filter((row) => matchesFilter(row.progress, option)).length;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === option
                  ? 'bg-brand-600 text-white'
                  : 'surface-card text-muted hover:border-brand-400'
              }`}
            >
              {tProgress(option)} ({count})
            </button>
          );
        })}
      </div>

      <div className="surface-card relative overflow-x-auto rounded-xl">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              {(
                [
                  'group',
                  'work',
                  'deadline',
                  'handedIn',
                  'progress',
                  'marking',
                  'groupScore',
                  'average',
                ] as const
              ).map((key) => (
                <th key={key} scope="col" className="px-4 py-3 font-semibold">
                  {t(`columns.${key}`)}
                </th>
              ))}
              <th scope="col" className="px-4 py-3 font-semibold">
                <span className="sr-only">{t('columns.action')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.targetId} className="border-b border-[var(--border-subtle)]">
                <td className="px-4 py-3">
                  {row.groupName}
                  <span className="text-muted ml-2 text-xs tabular-nums">{row.memberCount}</span>
                </td>
                <td className="px-4 py-3">
                  {subjectOf(row)}
                  <span className="text-muted block text-xs">{t(`kind.${row.kind}`)}</span>
                </td>
                <td className="px-4 py-3">
                  {format.dateTime(new Date(row.submissionDeadline), { dateStyle: 'short' })}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {row.handedInCount}/{row.requiredCount}
                  {row.progress.lateItems > 0 ? (
                    <span className="ml-2 text-xs text-red-600 dark:text-red-400">
                      {t('lateItems', { count: row.progress.lateItems })}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  {/* The column a lecturer scans down. A badge carries the
                      state at a glance; the word is still there to read. */}
                  <Badge tone={PROGRESS_TONE[row.progress.state]}>
                    {tProgress(row.progress.state)}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={MARKING_TONE[row.marking]}>{t(`marking.${row.marking}`)}</Badge>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {row.groupScoreRaw ?? '—'}
                  {row.bonusPoints ? (
                    <span className="text-brand-600 dark:text-brand-300 ml-1 text-xs">
                      +{row.bonusPoints}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {row.averageFinalScore ?? '—'}
                  {row.gradedStudents > 0 ? (
                    <span className="text-muted ml-2 text-xs">
                      {t('gradedStudents', { count: row.gradedStudents })}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={markingHref(row)}
                    className="text-brand-600 dark:text-brand-300 font-medium underline"
                  >
                    {t('open')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 ? (
          <p className="text-muted px-4 py-3 text-sm">{tProgress('noneMatch')}</p>
        ) : null}
      </div>
    </div>
  );
}
