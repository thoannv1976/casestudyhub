import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_PRESENTATION_POLICY, submissionDeadlineFor } from '@casestudyhub/shared';
import { lateAtServerTime, missingDeliverables } from '../assignments/assignments';
import { currentVersions } from '../submissions/submissions';
import type { Assignment, Submission } from '@casestudyhub/shared';

const presentation = Date.UTC(2026, 9, 1, 2, 0, 0);
const deadline = submissionDeadlineFor(presentation, DEFAULT_PRESENTATION_POLICY);

const assignment: Assignment = {
  id: 'A1',
  classId: 'ECOM-A01',
  groupId: 'G1',
  caseStudyId: 'CASE01',
  caseVersionId: 'v1',
  policyId: DEFAULT_PRESENTATION_POLICY.id,
  policyVersion: DEFAULT_PRESENTATION_POLICY.version,
  rubricVersion: DEFAULT_PRESENTATION_POLICY.rubric.version,
  presentationDate: new Date(presentation).toISOString(),
  submissionDeadline: new Date(deadline).toISOString(),
  status: 'submission_open',
};

function submission(overrides: Partial<Submission>): Submission {
  return {
    id: 'S',
    assignmentId: 'A1',
    groupId: 'G1',
    deliverableId: 'slides-pdf',
    submittedByUid: 'uid',
    submittedAt: new Date(deadline - 1000).toISOString(),
    fileName: 'slides.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    storagePath: 'submissions/A1/slides-pdf/v1-slides.pdf',
    versionNumber: 1,
    isLate: false,
    status: 'ready',
    ...overrides,
  };
}

describe('the deadline comes from the policy, not from a typed-in date', () => {
  it('sits exactly 24 hours before the session', () => {
    expect(presentation - deadline).toBe(24 * 60 * 60 * 1000);
  });

  it('moves with the policy when a course changes that number', () => {
    const relaxed = {
      ...DEFAULT_PRESENTATION_POLICY,
      submission: { ...DEFAULT_PRESENTATION_POLICY.submission, deadlineHoursBeforeSession: 48 },
    };
    expect(presentation - submissionDeadlineFor(presentation, relaxed)).toBe(48 * 60 * 60 * 1000);
  });
});

describe('lateAtServerTime', () => {
  it('is on time up to and including the deadline', () => {
    expect(lateAtServerTime(assignment, Timestamp.fromMillis(deadline - 1))).toBe(false);
    expect(lateAtServerTime(assignment, Timestamp.fromMillis(deadline))).toBe(false);
  });

  it('is late one millisecond after it', () => {
    expect(lateAtServerTime(assignment, Timestamp.fromMillis(deadline + 1))).toBe(true);
  });

  it('ignores what a student device might claim, because the caller passes the server clock', () => {
    // The parameter exists so the decision is always made from a clock the
    // platform controls; a browser value never reaches it.
    const wayLater = Timestamp.fromMillis(deadline + 7 * 24 * 60 * 60 * 1000);
    expect(lateAtServerTime(assignment, wayLater)).toBe(true);
  });
});

describe('currentVersions', () => {
  it('keeps the newest version of each deliverable', () => {
    const current = currentVersions([
      submission({ id: 'v1', versionNumber: 1 }),
      submission({ id: 'v2', versionNumber: 2 }),
      submission({ id: 'r1', deliverableId: 'reference-list', versionNumber: 1 }),
    ]);

    expect(current).toHaveLength(2);
    expect(current.find((item) => item.deliverableId === 'slides-pdf')?.id).toBe('v2');
  });

  it('does not lose an older version: it simply is not the current one', () => {
    const all = [
      submission({ id: 'v1', versionNumber: 1, isLate: false }),
      submission({ id: 'v2', versionNumber: 2, isLate: true }),
    ];
    // Both remain in the list handed to the lecturer; only the newest counts.
    expect(all).toHaveLength(2);
    expect(currentVersions(all)[0]?.id).toBe('v2');
  });

  it('returns nothing for a group that has handed in nothing', () => {
    expect(currentVersions([])).toEqual([]);
  });
});

describe('missingDeliverables', () => {
  const deliverables = DEFAULT_PRESENTATION_POLICY.deliverables;

  it('lists every required item when nothing is in yet', () => {
    const missing = missingDeliverables(deliverables, []);
    expect(missing.map((item) => item.id)).toEqual([
      'slides-pdf',
      'slides-source',
      'role-allocation-sheet',
      'reference-list',
      'ai-usage-disclosure',
    ]);
  });

  it('never counts an optional item as missing', () => {
    const missing = missingDeliverables(deliverables, []);
    expect(missing.map((item) => item.id)).not.toContain('case-analysis-report');
  });

  it('is empty once every required item is in', () => {
    const required = deliverables.filter((item) => item.required).map((item) => item.id);
    expect(missingDeliverables(deliverables, required)).toEqual([]);
  });
});
