import { COLLECTIONS, type GradedWorkKind } from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import type { SessionUser } from '../auth/types';
import { assertCanManageClass } from '../academic/structure';
import { listRoster } from '../academic/enrollment';
import { listPublishedGradesOfStudent } from '../grading/assessments';
import { classParticipation } from '../analytics/participation';
import { defaultHubClient, isLtiEnabled, type LtiHubClient } from './config';
import type { BulkRow } from './hub-sdk';
import { ltiAttendanceScore, ltiScore, type LtiActivityKind } from './keys';

/**
 * Sending marks to the Moodle gradebook.
 *
 * Only published marks leave this platform, and only as one number per
 * column on the 0-100 scale (Moodle shows it on its own scale). A draft, an
 * AI suggestion or a per-criterion breakdown never does. The Hub keeps the
 * newest mark when two arrive out of order, so re-sending is always safe.
 */

/** The student's published marks in one class, with the kind of work each is for. */
async function publishedMarksInClass(
  uid: string,
  classId: string,
): Promise<{ kind: GradedWorkKind; finalScore: number }[]> {
  const grades = await listPublishedGradesOfStudent(uid);
  if (grades.length === 0) return [];

  const db = getDb();
  const ids = [...new Set(grades.map((grade) => grade.assignmentId))];
  const assessments = await db.getAll(
    ...ids.map((id) => db.collection(COLLECTIONS.lecturerAssessments).doc(id)),
  );
  const classOf = new Map(
    assessments.map((doc) => [doc.id, doc.get('classId') as string | undefined]),
  );
  return grades
    .filter((grade) => classOf.get(grade.assignmentId) === classId)
    .map((grade) => ({ kind: grade.kind, finalScore: grade.finalScore }));
}

export async function ltiScoreOfStudent(
  uid: string,
  classId: string,
  kind: LtiActivityKind,
): Promise<number | null> {
  return ltiScore(kind, await publishedMarksInClass(uid, classId));
}

export interface LtiSendOutcome {
  sent: number;
  failed: number;
}

/**
 * After a lecturer publishes one piece of work: send each affected student's
 * updated column to every Moodle activity of that kind they opened.
 */
export async function sendLtiGradesForAssignment(
  assignmentId: string,
  hub: LtiHubClient | null = defaultHubClient(),
): Promise<LtiSendOutcome> {
  const outcome = { sent: 0, failed: 0 };
  if (!hub) return outcome;

  const db = getDb();
  const assessment = await db.collection(COLLECTIONS.lecturerAssessments).doc(assignmentId).get();
  if (!assessment.exists) return outcome;
  const classId = assessment.get('classId') as string;
  const kind = assessment.get('kind') as GradedWorkKind;

  const grades = await db
    .collection(COLLECTIONS.grades)
    .where('assignmentId', '==', assignmentId)
    .get();
  const students = new Set(grades.docs.map((doc) => doc.get('studentUid') as string));

  const targets = await db
    .collection(COLLECTIONS.ltiGradeTargets)
    .where('classId', '==', classId)
    .get();
  for (const target of targets.docs) {
    const uid = target.get('uid') as string;
    if (target.get('kind') !== kind || !students.has(uid)) continue;

    const score = await ltiScoreOfStudent(uid, classId, kind);
    if (score === null) continue;
    try {
      await hub.submitResult({
        gradeTarget: target.get('gradeTarget') as string,
        // Stable per student, class and kind: a later mark for the same
        // column is an update of this attempt, not a second attempt.
        attemptId: `${kind}:${classId}:${uid}`,
        score,
        maxScore: 100,
        occurredAt: new Date().toISOString(),
        activityProgress: 'Completed',
        gradingProgress: 'FullyGraded',
      });
      outcome.sent += 1;
    } catch (error) {
      outcome.failed += 1;
      console.error(`LTI grade send failed for ${target.id}`, error);
    }
  }
  return outcome;
}

/**
 * Best effort, for the publish request: a Hub outage must never turn a
 * published mark into an error for the lecturer. The "send the whole class"
 * button is the way to catch up.
 */
export async function sendLtiGradesQuietly(assignmentId: string): Promise<void> {
  if (!isLtiEnabled()) return;
  try {
    const outcome = await sendLtiGradesForAssignment(assignmentId);
    if (outcome.sent || outcome.failed) {
      console.log(
        JSON.stringify({ severity: 'INFO', message: 'lti grades sent', assignmentId, ...outcome }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        severity: 'WARNING',
        message: 'lti grade send failed',
        assignmentId,
        error: String(error),
      }),
    );
  }
}

export interface LtiClassSendOutcome {
  activities: number;
  rows: number;
  failed: number;
}

/**
 * The lecturer's "send the whole class to Moodle": every graded activity of
 * this class that has a gradebook column, every student with a published mark.
 *
 * Students are matched in Moodle by their Hub id when they have opened the
 * activity, else by username (the student code) and e-mail - so a student who
 * never came in from Moodle still gets their mark.
 *
 * The attendance column goes out only from here, when the lecturer presses
 * send: it moves after every presentation, and the number in Moodle should be
 * one the lecturer looked at. `kinds` limits the send to some columns (the
 * participation page sends only attendance).
 */
export async function sendLtiClassGrades(
  actor: SessionUser,
  classId: string,
  hub: LtiHubClient | null = defaultHubClient(),
  kinds?: readonly LtiActivityKind[],
): Promise<LtiClassSendOutcome> {
  await assertCanManageClass(actor, classId);
  const outcome = { activities: 0, rows: 0, failed: 0 };
  if (!hub) return outcome;

  const db = getDb();
  const activities = (
    await db.collection(COLLECTIONS.ltiActivities).where('classId', '==', classId).get()
  ).docs.filter(
    (doc) =>
      doc.get('kind') !== 'class' &&
      typeof doc.get('linkTarget') === 'string' &&
      (!kinds || kinds.includes(doc.get('kind') as LtiActivityKind)),
  );
  if (activities.length === 0) return outcome;

  const roster = (await listRoster(classId)).filter(
    (row) => row.status === 'active' && row.studentUid,
  );
  const uids = roster.map((row) => row.studentUid as string);

  const hubIds = new Map<string, string>();
  for (let index = 0; index < uids.length; index += 30) {
    const chunk = uids.slice(index, index + 30);
    const mappings = await db.collection(COLLECTIONS.ltiUsers).where('uid', 'in', chunk).get();
    mappings.docs.forEach((doc) => hubIds.set(doc.get('uid') as string, doc.id));
  }

  const kindOf = (doc: (typeof activities)[number]) => doc.get('kind') as LtiActivityKind;
  const marks = new Map<string, { kind: GradedWorkKind; finalScore: number }[]>();
  if (activities.some((doc) => kindOf(doc) !== 'attendance')) {
    for (const uid of uids) marks.set(uid, await publishedMarksInClass(uid, classId));
  }
  const attendance = new Map<string, number | null>();
  if (activities.some((doc) => kindOf(doc) === 'attendance')) {
    const participation = await classParticipation(classId);
    participation.rows.forEach((row) => attendance.set(row.studentUid, row.attendance));
  }
  const scoreOf = (kind: LtiActivityKind, uid: string) =>
    kind === 'attendance'
      ? ltiAttendanceScore(attendance.get(uid))
      : ltiScore(kind, marks.get(uid) ?? []);

  const sentAt = new Date().toISOString();
  for (const activity of activities) {
    const kind = kindOf(activity);
    const rows: BulkRow[] = [];
    for (const row of roster) {
      const uid = row.studentUid as string;
      const score = scoreOf(kind, uid);
      if (score === null) continue;
      const hubUserId = hubIds.get(uid);
      rows.push({
        ...(hubUserId ? { hubUserId } : {}),
        username: row.studentId,
        ...(row.email && !row.email.endsWith('@lti.invalid') ? { email: row.email } : {}),
        score,
      });
    }
    if (rows.length === 0) continue;

    try {
      await hub.submitBulkResult({
        linkTarget: activity.get('linkTarget') as string,
        batchId: `${activity.id}:${sentAt}`,
        maxScore: 100,
        occurredAt: sentAt,
        rows,
      });
      outcome.activities += 1;
      outcome.rows += rows.length;
    } catch (error) {
      outcome.failed += 1;
      console.error(`LTI class send failed for activity ${activity.id}`, error);
    }
  }

  await writeAuditLog({
    action: 'lti.grades_sent',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    after: { ...outcome, kinds: kinds ? [...kinds] : null },
  });
  return outcome;
}
