import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESENTATION_POLICY, type ClassQuestion } from '@casestudyhub/shared';
import { qaCompletion, questionId } from '../questions/questions';

const min = DEFAULT_PRESENTATION_POLICY.qa.minClassQuestions;

function question(overrides: Partial<ClassQuestion> = {}): ClassQuestion {
  return {
    id: 'PS1__x',
    caseStudyId: 'CS1',
    sessionId: 'PS1',
    classId: 'C1',
    groupId: 'G1',
    askedByUid: 'x',
    askedByName: 'X',
    askedByStudentId: 'SV000',
    anonymousToClass: true,
    roleId: null,
    category: 'clarification',
    text: 'A question long enough to be real.',
    upvotes: 0,
    status: 'submitted',
    answeredByAi: false,
    ...overrides,
  };
}

describe('one question per student', () => {
  it('derives the same document id from the same student and session', () => {
    expect(questionId('PS1', 'uidA')).toBe(questionId('PS1', 'uidA'));
    expect(questionId('PS1', 'uidA')).not.toBe(questionId('PS1', 'uidB'));
    expect(questionId('PS1', 'uidA')).not.toBe(questionId('PS2', 'uidA'));
  });
});

describe('the Q&A checklist of the Guide', () => {
  const members = ['uid1', 'uid2', 'uid3', 'uid4'];

  it('is not met while the class has asked fewer questions than the policy wants', () => {
    const completion = qaCompletion([question()], members, members, min);
    expect(completion.enoughClassQuestions).toBe(false);
  });

  it('counts questions asked, not questions answered aloud', () => {
    // Fifty questions with three answered is the expected shape of a session:
    // the bank is the point, the three are what there was time for.
    const asked = Array.from({ length: 50 }, (_, index) =>
      question({ id: `q${index}`, status: index < 3 ? 'answered' : 'submitted' }),
    );
    const completion = qaCompletion(asked, members, members, min);
    expect(completion.classQuestions).toBe(50);
    expect(completion.answered).toBe(3);
    expect(completion.enoughClassQuestions).toBe(true);
  });

  it('names the members who have not answered anything yet', () => {
    const completion = qaCompletion(
      [question(), question({ id: 'q2' })],
      members,
      ['uid1', 'uid3'],
      min,
    );
    expect(completion.membersAnswered).toEqual(['uid1', 'uid3']);
    expect(completion.membersWithoutAnswer).toEqual(['uid2', 'uid4']);
    expect(completion.everyMemberAnswered).toBe(false);
  });

  it('is met when every member has answered at least once', () => {
    const completion = qaCompletion(
      [question(), question({ id: 'q2' })],
      members,
      [...members, 'someone_else'],
      min,
    );
    expect(completion.everyMemberAnswered).toBe(true);
    expect(completion.enoughClassQuestions).toBe(true);
  });

  it('does not call an empty group complete', () => {
    expect(
      qaCompletion([question(), question({ id: 'q2' })], [], [], min).everyMemberAnswered,
    ).toBe(false);
  });
});
