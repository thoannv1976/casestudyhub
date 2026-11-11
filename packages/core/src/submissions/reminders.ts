import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import type { SessionUser } from '../auth/types';
import { classOverview } from '../dashboard/class-overview';
import { listMembers } from '../groups/groups';
import { notify } from '../notifications/notifications';

/** A class is reminded at most this often, so a double click does not nag twice. */
export const REMINDER_GAP_MS = 12 * 60 * 60 * 1000;

/**
 * The lecturer tells every group that still owes required work, in one press.
 *
 * Who owes what comes from the class overview, which already knows it; marked
 * or published work is left alone, because a reminder after the mark is out
 * only confuses. The message is a key with the case and the count, never a
 * sentence (see notifications).
 */
export async function remindMissingWork(
  actor: SessionUser,
  classId: string,
  now = Date.now(),
): Promise<{ groups: number; students: number }> {
  const db = getDb();
  const classRef = db.collection(COLLECTIONS.classes).doc(classId);
  const klass = await classRef.get();
  if (!klass.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');
  const last = (
    klass.get('missingWorkRemindedAt') as FirebaseFirestore.Timestamp | undefined
  )?.toMillis();
  if (last && now - last < REMINDER_GAP_MS) {
    throw new AppError('CONFLICT', 'errors.reminderTooSoon');
  }

  const [overview, members] = await Promise.all([
    classOverview(classId, { now }),
    listMembers(classId),
  ]);
  const owing = overview.rows.filter(
    (row) => row.progress.missing > 0 && row.marking === 'unmarked' && row.memberCount > 0,
  );

  let students = 0;
  const groups = new Set<string>();
  for (const row of owing) {
    const recipientUids = members
      .filter((member) => member.groupId === row.groupId)
      .map((member) => member.studentUid);
    if (recipientUids.length === 0) continue;
    groups.add(row.groupId);
    students += await notify({
      recipientUids,
      kind: 'submission.reminder',
      params: {
        kind: row.kind,
        case: row.subject ?? '',
        missing: row.progress.missing,
        deadline: row.submissionDeadline,
      },
      href: `/classes/${classId}`,
    });
  }

  await classRef.update({ missingWorkRemindedAt: FieldValue.serverTimestamp() });
  await writeAuditLog({
    action: 'submission.reminder_sent',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    after: { groups: groups.size, students },
  });
  return { groups: groups.size, students };
}
