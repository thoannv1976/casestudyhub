import { describe, expect, it } from 'vitest';
import {
  answerChannelFor,
  answerWindowOpen,
  answersDueAt,
  attendancePolicySchema,
  attendanceScore,
  classQuestionSchema,
  officialAnswer,
  questionWindowOpen,
  questionsCloseAt,
  redactForViewer,
  type ClassQuestion,
} from '../index';

const DAY = 24 * 3600_000;
const ended = '2026-11-10T03:00:00.000Z';
const endedMs = Date.parse(ended);
const closed = { status: 'completed', questionsOpen: false, endedAt: ended };

function question(overrides: Partial<ClassQuestion> = {}): ClassQuestion {
  return classQuestionSchema.parse({
    id: 'S1__u1',
    sessionId: 'S1',
    classId: 'C1',
    groupId: 'G1',
    askedByUid: 'u1',
    askedByName: 'Nguyen Van A',
    askedByStudentId: 'SV1',
    category: 'evidence',
    text: 'Which number proves the claim about margins?',
    status: 'submitted',
    ...overrides,
  });
}

describe('asking after the presentation', () => {
  it('closes with the session when the class allows no extra days', () => {
    const policy = { askDays: 0, answerDays: 0 };
    expect(questionsCloseAt(closed, policy)).toBeNull();
    expect(questionWindowOpen(closed, policy, endedMs + 1000)).toBe(false);
  });

  it('stays open for the days the lecturer set, and not a minute more', () => {
    const policy = { askDays: 2, answerDays: 0 };
    expect(questionWindowOpen(closed, policy, endedMs + 2 * DAY - 1)).toBe(true);
    expect(questionWindowOpen(closed, policy, endedMs + 2 * DAY + 1)).toBe(false);
  });

  it('is open in the room whatever the days', () => {
    const live = { status: 'live', questionsOpen: true };
    expect(questionWindowOpen(live, { askDays: 0, answerDays: 0 }, Date.now())).toBe(true);
  });
});

describe('the group answering in the app', () => {
  it('is in the room before the session ends and in the app after', () => {
    expect(answerChannelFor({ status: 'qa' })).toBe('class');
    expect(answerChannelFor({ status: 'completed' })).toBe('app');
  });

  it('has no deadline unless the class set one', () => {
    expect(answersDueAt(closed, { askDays: 0, answerDays: 0 })).toBeNull();
    expect(answerWindowOpen(closed, { askDays: 0, answerDays: 0 }, endedMs + 90 * DAY)).toBe(true);
  });

  it('stops at the deadline the class set', () => {
    const policy = { askDays: 0, answerDays: 7 };
    expect(answerWindowOpen(closed, policy, endedMs + 7 * DAY - 1)).toBe(true);
    expect(answerWindowOpen(closed, policy, endedMs + 7 * DAY + 1)).toBe(false);
  });
});

describe('the answer a reader is given', () => {
  it('is the settled one first, then the group’s, then an old AI answer', () => {
    expect(officialAnswer(question())).toBeNull();
    expect(
      officialAnswer(question({ answerText: 'Margins fell to 4 percent.', answerChannel: 'app' })),
    ).toEqual({ text: 'Margins fell to 4 percent.', source: 'group', channel: 'app' });
    expect(
      officialAnswer(
        question({
          answerText: 'Margins fell.',
          finalAnswer: 'Margins fell to 4 percent in 2025.',
        }),
      )?.source,
    ).toBe('final');
    expect(
      officialAnswer(question({ answerText: 'From the model.', answeredByAi: true }))?.source,
    ).toBe('ai');
  });

  it('is never an unsettled suggestion', () => {
    const suggested = question({
      aiSuggestion: {
        text: 'A model wrote this.',
        groundedInCase: true,
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        createdAt: ended,
      },
    });
    expect(officialAnswer(suggested)).toBeNull();
  });
});

describe('what a student receives', () => {
  const suggested = question({
    aiSuggestion: {
      text: 'A model wrote this.',
      groundedInCase: true,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      createdAt: ended,
    },
  });

  it('never carries the model’s draft, to the asker or anyone else', () => {
    expect(redactForViewer(suggested, { uid: 'u1', isStaff: false }).aiSuggestion).toBeUndefined();
    expect(redactForViewer(suggested, { uid: 'u2', isStaff: false }).aiSuggestion).toBeUndefined();
  });

  it('does carry it to the lecturer, who settles it', () => {
    expect(redactForViewer(suggested, { uid: 'l1', isStaff: true }).aiSuggestion?.text).toBe(
      'A model wrote this.',
    );
  });
});

describe('the attendance score', () => {
  const policy = attendancePolicySchema.parse({});
  const asked = { eligible: true, asked: true, reviewed: false };
  const both = { eligible: true, asked: true, reviewed: true };
  const none = { eligible: true, asked: false, reviewed: false };
  const own = { eligible: false, asked: false, reviewed: false };

  it('is nothing at all before there was anything to attend', () => {
    expect(attendanceScore([own], 0, policy)).toBeNull();
  });

  it('is the share of what was possible, out of ten, leaving out the own presentation', () => {
    expect(attendanceScore([both, both, own], 0, policy)).toBe(10);
    expect(attendanceScore([both, asked, none, own], 0, policy)).toBe(5);
  });

  it('adds the bonus for good questions, and never passes ten', () => {
    expect(attendanceScore([asked, asked], 1, policy)).toBe(5.5);
    expect(attendanceScore([both], 3, policy)).toBe(10);
  });

  it('follows the weights the lecturer chose', () => {
    const askingOnly = { questionWeight: 1, reviewWeight: 0, featuredBonus: 0 };
    expect(attendanceScore([asked, none], 0, askingOnly)).toBe(5);
    expect(attendanceScore([{ eligible: true, asked: false, reviewed: true }], 0, askingOnly)).toBe(
      0,
    );
  });
});
