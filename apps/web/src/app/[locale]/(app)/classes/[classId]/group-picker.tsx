'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Group, GroupMember } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

/**
 * What a student sees of the groups in their class: the one they belong to
 * with its role allocation, or the ones with a seat left.
 */
export function GroupPicker({
  classId,
  groups,
  members,
  ownUid,
}: {
  classId: string;
  groups: Group[];
  members: GroupMember[];
  ownUid: string;
}) {
  const t = useTranslations('groups');
  const tRoles = useTranslations('roles');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const own = members.find((member) => member.studentUid === ownUid);

  async function join(groupId: string) {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (groups.length === 0) {
    return <p className="text-muted text-sm">{t('noneYet')}</p>;
  }

  return (
    <div className="space-y-4">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      <ul className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => {
          const groupMembers = members.filter((member) => member.groupId === group.id);
          const isOwn = own?.groupId === group.id;
          const full = groupMembers.length >= group.maxMembers;

          return (
            <li
              key={group.id}
              className={`surface-card rounded-xl p-4 ${isOwn ? 'border-brand-500' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{group.groupName}</h3>
                {isOwn ? <Badge tone="brand">{t('yourGroup')}</Badge> : null}
              </div>
              <p className="text-muted mt-1 text-xs">
                {groupMembers.length}/{group.maxMembers}
                {group.locked ? ` · ${t('locked')}` : ''}
              </p>

              <ul className="mt-3 space-y-1 text-sm">
                {groupMembers.map((member) => (
                  <li key={member.id}>
                    {member.fullName}
                    {member.roleIds.length > 0 ? (
                      <span className="text-muted ml-2 text-xs">
                        {member.roleIds
                          .map((roleId) => `${roleId} ${tRoles(`${ROLE_KEYS[roleId]}.title`)}`)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>

              {!own && !group.locked && group.formationMode === 'student_self_join' ? (
                <div className="mt-4">
                  <Button disabled={busy || full} onClick={() => void join(group.id)}>
                    {full ? t('full') : t('join')}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ROLE_KEYS = {
  R1: 'contextSetter',
  R2: 'modelAnalyst',
  R3: 'dataAnalyst',
  R4: 'critic',
  R5: 'transferLead',
  R6: 'decisionLead',
} as const;
