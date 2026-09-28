'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PROGRESS_FILTERS, matchesFilter, type ProgressFilter } from '@casestudyhub/shared';
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
export function OverviewTable({ classId, overview }: { classId: string; overview: ClassOverview }) {
  const t = useTranslations('overview');
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
          <li key={key} className="surface-card rounded-xl px-4 py-3">
            <p className="text-xl font-semibold tabular-nums">{value}</p>
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
                  {new Date(row.submissionDeadline).toLocaleDateString()}
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
                  <span
                    className={
                      row.progress.state === 'overdue'
                        ? 'font-medium text-red-600 dark:text-red-400'
                        : ''
                    }
                  >
                    {tProgress(row.progress.state)}
                  </span>
                </td>
                <td className="px-4 py-3">{t(`marking.${row.marking}`)}</td>
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
