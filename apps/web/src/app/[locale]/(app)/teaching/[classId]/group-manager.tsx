'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ClassEnrollment, Group, GroupMember } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

export function GroupManager({
  classId,
  groups,
  members,
  roster,
}: {
  classId: string;
  groups: Group[];
  members: GroupMember[];
  /** The class list, so the students nobody placed can be seen and placed. */
  roster: ClassEnrollment[];
}) {
  const t = useTranslations('groups');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which group has its name open for editing, if any. */
  const [renaming, setRenaming] = useState<string | null>(null);

  /**
   * Everybody who can be put somewhere, with where they are now.
   *
   * One list rather than two, because placing a student who has no group and
   * moving one who has are the same decision from the lecturer's side: this
   * person belongs in that group. It also keeps other groups' names out of a
   * group's own card, where they read as if they were part of it.
   *
   * Two filters, both deliberate: only active enrolments, because somebody
   * waiting for approval has not joined the class yet; and only rows with an
   * account behind them, since a name imported from the faculty list cannot be
   * placed until that student has registered.
   */
  const groupOf = new Map(members.map((member) => [member.studentUid, member.groupId]));
  const nameOf = new Map(groups.map((group) => [group.id, group.groupName]));
  const placeable = roster
    .filter((student) => student.status === 'active')
    .filter((student): student is typeof student & { studentUid: string } =>
      Boolean(student.studentUid),
    )
    .map((student) => {
      const currentGroupId = groupOf.get(student.studentUid) ?? null;
      return {
        ...student,
        currentGroupId,
        currentGroupName: currentGroupId ? (nameOf.get(currentGroupId) ?? null) : null,
      };
    });

  /** Moves somebody into another group; one call, one transaction behind it. */
  async function move(studentUid: string, name: string, toGroupId: string) {
    const done = await call(`/api/groups/${toGroupId}/members`, { classId, studentUid }, 'PATCH');
    if (done) {
      const group = groups.find((candidate) => candidate.id === toGroupId);
      setNotice(t('moved', { name, group: group?.groupName ?? '' }));
    }
  }

  /** Places a student who has no group at all. */
  async function place(studentUid: string, name: string, groupId: string) {
    const done = await call(`/api/groups/${groupId}/members`, { classId, studentUid });
    if (done) {
      const group = groups.find((candidate) => candidate.id === groupId);
      setNotice(t('assigned', { name, group: group?.groupName ?? '' }));
    }
  }

  /** How many members a group may hold, changed after it was created. */
  async function saveCapacity(
    groupId: string,
    name: string,
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const done = (await call(
      `/api/groups/${groupId}`,
      { classId, maxMembers: Number(form.get('maxMembers')) },
      'PATCH',
    )) as { maxMembers?: number } | null;
    if (done?.maxMembers) setNotice(t('capacitySaved', { name, max: done.maxMembers }));
  }

  async function call(url: string, body: Record<string, unknown>, method = 'POST') {
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return null;
      }
      router.refresh();
      return payload;
    } finally {
      setBusy(false);
    }
  }

  async function createGroups(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await call(`/api/classes/${classId}/groups`, {
      count: Number(form.get('count')),
      maxMembers: Number(form.get('maxMembers')),
      formationMode: String(form.get('formationMode')),
    });
    if (result) {
      setNotice(
        typeof result.placed === 'number'
          ? t('createdAndPlaced', { created: result.created, placed: result.placed })
          : t('created', { count: result.created }),
      );
    }
  }

  /**
   * Renames a group. `groupCode` stays as it is - that is what assignments and
   * marks were recorded against; the name is only what people read.
   */
  async function rename(groupId: string, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await call(
      `/api/groups/${groupId}`,
      { classId, groupName: String(form.get('groupName') ?? '') },
      'PATCH',
    );
    if (result) {
      setRenaming(null);
      setNotice(t('renamed', { name: result.groupName as string }));
    }
  }

  const membersOf = (groupId: string) => members.filter((member) => member.groupId === groupId);

  return (
    <div className="space-y-6">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <form onSubmit={createGroups} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('count')} htmlFor="count">
            <Input
              id="count"
              name="count"
              type="number"
              min={1}
              max={50}
              defaultValue={4}
              required
            />
          </Field>
          <Field label={t('maxMembers')} htmlFor="maxMembers" hint={t('maxMembersHint')}>
            <Input
              id="maxMembers"
              name="maxMembers"
              type="number"
              min={2}
              max={12}
              defaultValue={6}
              required
            />
          </Field>
          <Field label={t('formationMode')} htmlFor="formationMode">
            <Select id="formationMode" name="formationMode" defaultValue="student_self_join">
              <option value="student_self_join">{t('modeSelfJoin')}</option>
              <option value="lecturer_assignment">{t('modeLecturer')}</option>
              <option value="random">{t('modeRandom')}</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={busy}>
          {t('createGroups')}
        </Button>
      </form>

      {groups.length === 0 ? (
        <p className="text-muted text-sm">{t('empty')}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {groups.map((group) => {
            const groupMembers = membersOf(group.id);
            return (
              <li key={group.id} data-testid="group-card" className="surface-card rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{group.groupName}</h3>
                    <p className="text-muted text-xs">
                      {t('memberCount', { count: groupMembers.length, max: group.maxMembers })} ·{' '}
                      {group.groupCode}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    {group.locked ? <Badge>{t('locked')}</Badge> : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRenaming(renaming === group.id ? null : group.id)}
                      // A 16px-tall word is not something a thumb can hit.
                      className="text-muted hover:text-brand-600 inline-flex min-h-6 items-center px-1 text-xs font-medium disabled:opacity-40"
                    >
                      {renaming === group.id ? t('cancel') : t('rename')}
                    </button>
                  </span>
                </div>

                {renaming === group.id ? (
                  <form
                    onSubmit={(event) => void rename(group.id, event)}
                    className="mt-3 flex flex-wrap items-end gap-2"
                  >
                    <Field label={t('groupName')} htmlFor={`groupName__${group.id}`}>
                      <Input
                        id={`groupName__${group.id}`}
                        name="groupName"
                        defaultValue={group.groupName}
                        maxLength={120}
                        required
                      />
                    </Field>
                    <Button type="submit" disabled={busy}>
                      {t('saveName')}
                    </Button>
                  </form>
                ) : null}

                <ul className="mt-3 space-y-1 text-sm">
                  {groupMembers.length === 0 ? (
                    <li className="text-muted">{t('noMembers')}</li>
                  ) : (
                    groupMembers.map((member) => (
                      <li key={member.id} className="flex items-center justify-between gap-2">
                        <span>
                          <span className="font-mono text-xs">{member.studentId}</span>{' '}
                          {member.fullName}
                        </span>
                        <span className="flex items-center gap-1">
                          {member.roleIds.length > 0 ? (
                            <span className="text-brand-600 dark:text-brand-300 text-xs font-medium">
                              {member.roleIds.join(' + ')}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy || group.locked}
                            onClick={() =>
                              void call(
                                `/api/groups/${group.id}/members`,
                                { classId, studentUid: member.studentUid },
                                'DELETE',
                              )
                            }
                            // Removing somebody from a group is the last thing
                            // that should be easy to hit by accident and hard
                            // to hit on purpose: 12x20 became 24x24.
                            className="text-muted inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:text-red-600 disabled:opacity-40"
                            aria-label={t('removeMember', { name: member.fullName })}
                          >
                            ✕
                          </button>
                        </span>
                      </li>
                    ))
                  )}
                </ul>

                <form
                  onSubmit={(event) => void saveCapacity(group.id, group.groupName, event)}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <Field
                    label={t('capacity')}
                    htmlFor={`maxMembers__${group.id}`}
                    hint={t('capacityHint')}
                  >
                    <Input
                      id={`maxMembers__${group.id}`}
                      name="maxMembers"
                      type="number"
                      min={Math.max(groupMembers.length, 2)}
                      max={12}
                      defaultValue={group.maxMembers}
                      required
                      className="w-24"
                    />
                  </Field>
                  <Button type="submit" variant="ghost" disabled={busy}>
                    {t('saveCapacity')}
                  </Button>
                </form>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    disabled={busy || groupMembers.length === 0}
                    onClick={() =>
                      void call(`/api/groups/${group.id}/roles`, { classId, action: 'auto' })
                    }
                  >
                    {t('autoAssign')}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void call(`/api/groups/${group.id}/roles`, {
                        classId,
                        action: 'lock',
                        locked: !group.locked,
                      })
                    }
                  >
                    {group.locked ? t('unlock') : t('lock')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {groups.length > 0 ? (
        <section className="space-y-3" data-testid="placement">
          <h3 className="text-sm font-semibold">{t('placementTitle')}</h3>
          <p className="text-muted text-sm">{t('placementHint')}</p>

          {placeable.length === 0 ? (
            <p className="text-muted text-sm">{t('nobodyToPlace')}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {placeable.map((student) => (
                <li
                  key={student.studentUid}
                  className="surface-card flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2"
                >
                  <span>
                    <span className="font-mono text-xs">{student.studentId}</span>{' '}
                    {student.fullName}
                    <span className="text-muted ml-2 text-xs">
                      {student.currentGroupName ?? t('noGroupYet')}
                    </span>
                  </span>
                  <select
                    aria-label={t('placeInto', { name: student.fullName })}
                    disabled={busy}
                    value=""
                    onChange={(event) => {
                      const groupId = event.target.value;
                      if (!groupId) return;
                      if (student.currentGroupId) {
                        void move(student.studentUid, student.fullName, groupId);
                      } else {
                        void place(student.studentUid, student.fullName, groupId);
                      }
                    }}
                    className="surface-card h-9 rounded px-2 text-base disabled:opacity-40 sm:h-8 sm:text-xs"
                  >
                    <option value="">{student.currentGroupId ? t('moveTo') : t('assign')}</option>
                    {groups
                      .filter((group) => !group.locked && group.id !== student.currentGroupId)
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.groupName}
                        </option>
                      ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
