import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  hasPermission,
  DEFAULT_PRESENTATION_POLICY,
  presentationPolicySchema,
  type PresentationPolicy,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import type { SessionUser } from '../auth/types';

/**
 * The assessment framework, as stored data (SRS 13.2).
 *
 * Every academic rule of the Presentation Guide was already data rather than a
 * constant buried in a feature - but it was a constant in the source, which
 * meant changing a threshold needed a developer and a deployment. It now lives
 * in the database, and a faculty can change it.
 *
 * What makes that safe is that a version is never edited. Changing a rule
 * writes a new version; a class and an assignment each stamp the version they
 * were created under, and every read resolves through that stamp. So a mark
 * published in March is computed with March's rules no matter what is changed
 * in June - not by policy, but because the March document still exists and
 * nothing can overwrite it.
 */

/** `${policyId}__${version}`: the id itself forbids two contents for one version. */
export function policyDocId(policyId: string, version: string): string {
  return `${policyId}__${version}`;
}

/**
 * A version is immutable, so it is cached for the life of the process. The
 * grading screen reads the same one for every member of a group, and a report
 * reads it once per assignment.
 */
const cache = new Map<string, PresentationPolicy>();

/** Test seam, and what a write calls so the next read sees the new version. */
export function clearPolicyCache(): void {
  cache.clear();
}

/**
 * The framework a stamp names.
 *
 * The built-in default answers for its own version without a database read:
 * it is the seed every deployment starts from, and a fresh project has
 * classes stamped with it before anything has been written.
 */
export async function getPolicy(policyId: string, version: string): Promise<PresentationPolicy> {
  const key = policyDocId(policyId, version);
  const cached = cache.get(key);
  if (cached) return cached;

  if (
    policyId === DEFAULT_PRESENTATION_POLICY.id &&
    version === DEFAULT_PRESENTATION_POLICY.version
  ) {
    cache.set(key, DEFAULT_PRESENTATION_POLICY);
    return DEFAULT_PRESENTATION_POLICY;
  }

  const snapshot = await getDb().collection(COLLECTIONS.policies).doc(key).get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.policyNotFound');

  const parsed = presentationPolicySchema.safeParse(snapshot.data());
  // A stored framework that no longer satisfies its own schema would silently
  // change how work is marked. It stops here instead.
  if (!parsed.success) throw new AppError('INTERNAL', 'errors.policyInvalid');

  cache.set(key, parsed.data);
  return parsed.data;
}

/** The framework a class runs under, from the stamp it was created with. */
export async function policyOfClass(classId: string): Promise<PresentationPolicy> {
  const snapshot = await getDb().collection(COLLECTIONS.classes).doc(classId).get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');

  return getPolicy(
    (snapshot.get('presentationPolicyId') as string | undefined) ?? DEFAULT_PRESENTATION_POLICY.id,
    (snapshot.get('presentationPolicyVersion') as string | undefined) ??
      DEFAULT_PRESENTATION_POLICY.version,
  );
}

/**
 * The framework an assignment froze. This is the one that matters: marking,
 * peer review, the AI reading and the deadline all resolve through it, so none
 * of them can be changed under work already set.
 */
export async function policyOfAssignment(assignment: {
  policyId: string;
  policyVersion: string;
}): Promise<PresentationPolicy> {
  return getPolicy(assignment.policyId, assignment.policyVersion);
}

export async function policyOfAssignmentId(assignmentId: string): Promise<PresentationPolicy> {
  const snapshot = await getDb().collection(COLLECTIONS.assignments).doc(assignmentId).get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');
  return getPolicy(snapshot.get('policyId') as string, snapshot.get('policyVersion') as string);
}

/**
 * Every framework version the platform holds, newest version first within a
 * framework. A faculty has a handful of these, not thousands, so they are read
 * and sorted whole rather than through an index that would have to be kept.
 */
export async function listPolicies(): Promise<PresentationPolicy[]> {
  const snapshot = await getDb().collection(COLLECTIONS.policies).get();
  const stored = snapshot.docs
    .map((doc) => presentationPolicySchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);

  // The built-in default is a version like any other, and on a fresh project
  // it is the only one there is.
  const hasDefault = stored.some(
    (policy) =>
      policy.id === DEFAULT_PRESENTATION_POLICY.id &&
      policy.version === DEFAULT_PRESENTATION_POLICY.version,
  );
  const all = hasDefault ? stored : [DEFAULT_PRESENTATION_POLICY, ...stored];

  return all.sort(
    (a, b) =>
      a.id.localeCompare(b.id) || b.version.localeCompare(a.version, undefined, { numeric: true }),
  );
}

/** The newest version of one framework, which is what new classes are stamped with. */
export async function latestPolicy(
  policyId: string = DEFAULT_PRESENTATION_POLICY.id,
): Promise<PresentationPolicy> {
  const versions = (await listPolicies()).filter((policy) => policy.id === policyId);
  const newest = versions[0];
  if (!newest) throw new AppError('NOT_FOUND', 'errors.policyNotFound');
  return newest;
}

export interface SavePolicyInput {
  /** The whole framework, already merged by the caller from an existing one. */
  policy: unknown;
  /** Why the rule changed. A framework change outlives whoever made it. */
  reason: string;
}

/**
 * Writes a new version of a framework.
 *
 * `create` rather than `set`: a version that already exists is a conflict, not
 * an update. That single choice is what guarantees a published grade cannot be
 * recomputed under different rules - there is no code path that rewrites the
 * document a grade was computed from.
 */
export async function savePolicyVersion(
  actor: SessionUser,
  input: SavePolicyInput,
): Promise<PresentationPolicy> {
  const parsed = presentationPolicySchema.safeParse(input.policy);
  if (!parsed.success) throw parsed.error;

  const policy = parsed.data;
  if (!hasPermission(actor.role, 'policy.author')) {
    throw new AppError('FORBIDDEN', 'errors.forbidden');
  }
  if (input.reason.trim().length < 10) {
    throw new AppError('VALIDATION_FAILED', 'errors.policyReasonTooShort');
  }

  // Adding a version to a framework other classes already run under changes
  // what every new class is stamped with, so it is a platform decision. A
  // lecturer wanting different rules for their own course clones the framework
  // under a new id, which reaches nobody else.
  const existing = await listPolicies();
  const isNewFramework = !existing.some((candidate) => candidate.id === policy.id);
  if (!isNewFramework && !hasPermission(actor.role, 'system.configure')) {
    throw new AppError('FORBIDDEN', 'errors.policyNotYoursToVersion');
  }

  // The built-in seed is the one version the platform ships with; overwriting
  // it would change the rules under every class created before this feature.
  if (
    policy.id === DEFAULT_PRESENTATION_POLICY.id &&
    policy.version === DEFAULT_PRESENTATION_POLICY.version
  ) {
    throw new AppError('CONFLICT', 'errors.policyVersionExists');
  }

  const ref = getDb().collection(COLLECTIONS.policies).doc(policyDocId(policy.id, policy.version));
  try {
    await ref.create({
      ...policy,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor.uid,
    });
  } catch {
    throw new AppError('CONFLICT', 'errors.policyVersionExists');
  }

  clearPolicyCache();

  await writeAuditLog({
    action: 'policy.version_created',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.policies}/${ref.id}`,
    after: { policyId: policy.id, version: policy.version },
    reason: input.reason,
  });

  return policy;
}
