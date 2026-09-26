'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Group, GroupMember } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

export function GroupManager({
  classId,
  groups,
  members,
}: {
  classId: string;
  groups: Group[];
  members: GroupMember[];
}) {
  const t = useTranslations('groups');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which group has its name open for editing, if any. */
  const [renaming, setRenaming] = useState<string | null>(null);

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
              <li key={group.id} className="surface-card rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{group.groupName}</h3>
                    <p className="text-muted text-xs">
                      {groupMembers.length}/{group.maxMembers} · {group.groupCode}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    {group.locked ? <Badge>{t('locked')}</Badge> : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRenaming(renaming === group.id ? null : group.id)}
                      className="text-muted hover:text-brand-600 text-xs font-medium disabled:opacity-40"
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
                            className="text-muted hover:text-red-600 disabled:opacity-40"
                            aria-label={t('removeMember', { name: member.fullName })}
                          >
                            ✕
                          </button>
                        </span>
                      </li>
                    ))
                  )}
                </ul>

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
    </div>
  );
}
