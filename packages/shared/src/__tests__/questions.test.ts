import { describe, expect, it } from 'vitest';
import {
  anonymiseForReuse,
  askQuestionSchema,
  displayAsker,
  elapsedMs,
  redactForViewer,
  roleElapsedMs,
  type ClassQuestion,
  type PresentationSession,
} from '../index';

function question(overrides: Partial<ClassQuestion> = {}): ClassQuestion {
  return {
    id: 'PS1__uidB',
    caseStudyId: 'CS1',
    sessionId: 'PS1',
    classId: 'C1',
    groupId: 'G1',
    askedByUid: 'uidB',
    askedByName: 'Tran Thi B',
    askedByStudentId: 'SV002',
    anonymousToClass: true,
    roleId: 'R3',
    category: 'evidence',
    text: 'Which number proves the unit economics claim?',
    upvotes: 4,
    status: 'submitted',
    answeredByAi: false,
    ...overrides,
  };
}

describe('who a question reveals', () => {
  it('hides an anonymous asker from a classmate, name and student id alike', () => {
    const seen = redactForViewer(question(), { uid: 'uidC', isStaff: false });
    expect(seen.askedByName).toBe('Anonymous');
    expect(seen.askedByStudentId).toBe('anonymous');
    // The uid goes too: with the group member list it would name the asker.
    expect(seen.askedByUid).toBe('anonymous');
    expect(seen.text).toBe(question().text);
  });

  it('still shows a student their own question, so the form can offer an edit', () => {
    const seen = redactForViewer(question(), { uid: 'uidB', isStaff: false });
    expect(seen.askedByUid).toBe('uidB');
    expect(seen.askedByName).toBe('Tran Thi B');
  });

  it('shows the lecturer who asked, because questions count toward the mark', () => {
    const seen = redactForViewer(question(), { uid: 'lecturer', isStaff: true });
    expect(seen.askedByName).toBe('Tran Thi B');
    expect(seen.askedByStudentId).toBe('SV002');
  });

  it('keeps a named asker named, but does not hand out their student id', () => {
    const seen = redactForViewer(question({ anonymousToClass: false }), {
      uid: 'uidC',
      isStaff: false,
    });
    expect(seen.askedByName).toBe('Tran Thi B');
    expect(seen.askedByStudentId).toBe('hidden');
  });

  it('strips the asker entirely when a later cohort reads the case', () => {
    const reused = anonymiseForReuse(question({ anonymousToClass: false }));
    expect(reused.askedByName).toBe('Anonymous');
    expect(reused.anonymousToClass).toBe(true);
  });

  it('agrees with what the interface is willing to print', () => {
    expect(displayAsker(question(), false)).toBeNull();
    expect(displayAsker(question(), true)).toBe('Tran Thi B');
  });
});

describe('asking a question', () => {
  it('rejects a question too short to be worth answering', () => {
    const result = askQuestionSchema.safeParse({ category: 'critical', text: 'why?' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('errors.questionTooShort');
  });

  it('defaults to anonymous and to no particular role', () => {
    const parsed = askQuestionSchema.parse({
      category: 'critical',
      text: 'What would change your recommendation?',
    });
    expect(parsed.anonymousToClass).toBe(true);
    expect(parsed.roleId).toBeNull();
  });
});

describe('the clock', () => {
  function session(overrides: Partial<PresentationSession> = {}): PresentationSession {
    return {
      id: 'PS1',
      classId: 'C1',
      assignmentId: 'A1',
      groupId: 'G1',
      caseStudyId: 'CS1',
      status: 'live',
      currentRoleId: 'R2',
      runningSinceMs: 10_000,
      accumulatedMs: 60_000,
      roleMs: { R1: 60_000, R2: 5_000 },
      questionsOpen: true,
      peerReviewOpen: false,
      ...overrides,
    };
  }

  it('adds the stretch running right now to what was already banked', () => {
    expect(elapsedMs(session(), 25_000)).toBe(75_000);
  });

  it('counts nothing while paused', () => {
    expect(elapsedMs(session({ runningSinceMs: null }), 999_999)).toBe(60_000);
  });

  it('never runs backwards if a clock disagrees', () => {
    expect(elapsedMs(session(), 0)).toBe(60_000);
  });

  it('charges the running stretch to the role holding the floor, not the others', () => {
    expect(roleElapsedMs(session(), 'R2', 25_000)).toBe(20_000);
    expect(roleElapsedMs(session(), 'R1', 25_000)).toBe(60_000);
  });

  it('reports zero for a role that has not spoken', () => {
    expect(roleElapsedMs(session(), 'R5', 25_000)).toBe(0);
  });
});
