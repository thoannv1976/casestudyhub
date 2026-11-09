'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MAX_GROUPS_PER_CASE } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/card';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

export interface CaseSetCase {
  id: string;
  caseCode: string;
  title: string;
  company?: string;
  courseId: string;
  status: 'draft' | 'published' | 'archived';
}

/**
 * The cases this class works from, picked out of the shared library.
 *
 * A case is uploaded once and serves every class after it; this is where a
 * class says which of them it uses, so next term's class starts from a copy of
 * this term's rather than from an empty library and a pile of re-uploads.
 */
export function CaseSetManager({
  classId,
  courseId,
  cases,
  courses,
  explicit,
  caseIds,
  groupsPerCase,
  claimedCaseIds,
  otherClasses,
}: {
  classId: string;
  /** The class's own course, for "select all of this course". */
  courseId: string;
  cases: CaseSetCase[];
  courses: { id: string; name: string }[];
  /** False while the class still works from its course's published cases. */
  explicit: boolean;
  caseIds: string[];
  groupsPerCase: number;
  /** Chosen by a group already: stays in the set until released. */
  claimedCaseIds: string[];
  /** Other classes the lecturer teaches, to copy a set from. */
  otherClasses: { id: string; label: string }[];
}) {
  const t = useTranslations('caseSelection');
  const tError = useTranslations();
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(() => new Set(caseIds));
  const [places, setPlaces] = useState(String(groupsPerCase));
  const [query, setQuery] = useState('');
  const [copyFrom, setCopyFrom] = useState(otherClasses[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: string; detail: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const claimed = useMemo(() => new Set(claimedCaseIds), [claimedCaseIds]);
  const courseName = (id: string) => courses.find((course) => course.id === id)?.name ?? id;

  // Archived cases are kept for the record, not offered to a new class.
  const shown = cases.filter((study) => {
    if (study.status === 'archived' && !selected.has(study.id)) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [study.caseCode, study.title, study.company ?? '', courseName(study.courseId)]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });

  function toggle(id: string) {
    if (claimed.has(id)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectCourse() {
    setSelected((current) => {
      const next = new Set(current);
      for (const study of cases) {
        if (study.courseId === courseId && study.status === 'published') next.add(study.id);
      }
      return next;
    });
  }

  function clearAll() {
    // A case a group has chosen stays: releasing it is a separate decision.
    setSelected(new Set(claimedCaseIds));
  }

  async function send(body: unknown, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/classes/${classId}/case-set`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { messageKey?: string; details?: { cases?: string } };
        } | null;
        setError({
          key: payload?.error?.messageKey ?? 'errors.unexpected',
          detail: payload?.error?.details?.cases ?? null,
        });
        return;
      }
      const payload = (await response.json().catch(() => null)) as {
        set?: { caseIds: string[]; groupsPerCase: number };
      } | null;
      if (payload?.set) {
        setSelected(new Set(payload.set.caseIds));
        setPlaces(String(payload.set.groupsPerCase));
      }
      setNotice(done);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function save() {
    void send(
      { caseSetIds: [...selected], groupsPerCase: Number(places) },
      t('setSaved', { count: selected.size }),
    );
  }

  function copy() {
    if (!copyFrom) return;
    const source = otherClasses.find((row) => row.id === copyFrom)?.label ?? copyFrom;
    if (!window.confirm(t('setCopyConfirm', { source }))) return;
    void send({ copyFromClassId: copyFrom }, t('setCopied', { source }));
  }

  return (
    <div className="space-y-4" data-testid="case-set-manager">
      <p className="text-muted text-sm">
        {explicit
          ? t('setExplicit', { count: caseIds.length })
          : t('setFromCourse', { course: courseName(courseId), count: caseIds.length })}
      </p>

      {error ? (
        <Alert tone="error">
          {tError(error.key)}
          {error.detail ? ` (${error.detail})` : ''}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <Field label={t('setSearch')} htmlFor="caseSetSearch">
            <Input
              id="caseSetSearch"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
        </div>
        <Button variant="ghost" disabled={busy} onClick={selectCourse}>
          {t('setSelectCourse')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={clearAll}>
          {t('setClear')}
        </Button>
      </div>

      <ul
        className="max-h-96 space-y-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)] p-2 text-sm"
        data-testid="case-set-list"
      >
        {shown.length === 0 ? <li className="text-muted p-2">{t('setNoMatch')}</li> : null}
        {shown.map((study) => {
          const inputId = `caseset-${study.id}`;
          return (
            <li key={study.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-1">
              <Input
                id={inputId}
                type="checkbox"
                checked={selected.has(study.id)}
                disabled={busy || claimed.has(study.id)}
                onChange={() => toggle(study.id)}
              />
              <label htmlFor={inputId} className="flex flex-1 flex-wrap items-center gap-x-2">
                <span className="text-muted font-mono text-xs">{study.caseCode}</span>
                <span className="font-medium">{study.title}</span>
                {study.company && study.company !== study.title ? (
                  <span className="text-muted text-xs">{study.company}</span>
                ) : null}
                <span className="text-muted text-xs">· {courseName(study.courseId)}</span>
              </label>
              {study.status !== 'published' ? (
                <Badge tone="neutral">
                  {t(study.status === 'draft' ? 'setDraft' : 'setArchived')}
                </Badge>
              ) : null}
              {claimed.has(study.id) ? <Badge tone="brand">{t('setClaimed')}</Badge> : null}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('setPlaces')} htmlFor="groupsPerCase" hint={t('setPlacesHint')}>
          <Input
            id="groupsPerCase"
            type="number"
            min={1}
            max={MAX_GROUPS_PER_CASE}
            value={places}
            onChange={(event) => setPlaces(event.target.value)}
            className="w-24"
          />
        </Field>
        <Button disabled={busy} onClick={save}>
          {t('setSave')}
        </Button>
        <span className="text-muted text-sm">{t('setCount', { count: selected.size })}</span>
      </div>

      {otherClasses.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-[var(--border-subtle)] pt-4">
          <Field label={t('setCopyFrom')} htmlFor="caseSetCopyFrom" hint={t('setCopyHint')}>
            <Select
              id="caseSetCopyFrom"
              value={copyFrom}
              onChange={(event) => setCopyFrom(event.target.value)}
            >
              {otherClasses.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="ghost" disabled={busy || !copyFrom} onClick={copy}>
            {t('setCopy')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
