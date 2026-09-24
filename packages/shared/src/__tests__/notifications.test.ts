import { describe, expect, it } from 'vitest';
import {
  DUE_SOON_HOURS,
  dueSoonNotification,
  notificationKeyOf,
  notificationSchema,
  sortForReading,
  unreadCount,
  type AppNotification,
  type DueSoonInput,
} from '../domain/notifications';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-03-01T09:00:00.000Z');

function dueIn(hours: number, overrides: Partial<DueSoonInput> = {}): DueSoonInput {
  return {
    assignmentId: 'A1',
    classId: 'C1',
    caseTitle: 'Vinamilk',
    submissionDeadline: new Date(NOW + hours * HOUR).toISOString(),
    missingDeliverables: 2,
    ...overrides,
  };
}

function stored(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    recipientUid: 'u1',
    kind: 'grade.published',
    params: {},
    href: '/classes/C1',
    createdAt: '2026-03-01T08:00:00.000Z',
    ...overrides,
  };
}

describe('the deadline warning', () => {
  it('appears while the deadline is close and something is still missing', () => {
    const notification = dueSoonNotification(dueIn(6), 'u1', NOW);
    expect(notification?.kind).toBe('submission.dueSoon');
    expect(notification?.params).toMatchObject({ case: 'Vinamilk', missing: 2, hours: 6 });
    expect(notification?.href).toBe('/classes/C1');
  });

  it('says nothing once the work is in - that is the point of deriving it', () => {
    expect(dueSoonNotification(dueIn(6, { missingDeliverables: 0 }), 'u1', NOW)).toBeNull();
  });

  it('says nothing while the deadline is still far off', () => {
    expect(dueSoonNotification(dueIn(DUE_SOON_HOURS + 1), 'u1', NOW)).toBeNull();
    expect(dueSoonNotification(dueIn(DUE_SOON_HOURS - 1), 'u1', NOW)).not.toBeNull();
  });

  it('stops nagging once the deadline has passed - the warning is no longer useful', () => {
    expect(dueSoonNotification(dueIn(-1), 'u1', NOW)).toBeNull();
  });

  it('never rounds the hours left down to zero, which would read as no time at all', () => {
    expect(dueSoonNotification(dueIn(0.2), 'u1', NOW)?.params.hours).toBe(1);
  });

  it('keeps the same id across two reads, so it is one warning and not two', () => {
    const first = dueSoonNotification(dueIn(6), 'u1', NOW);
    const second = dueSoonNotification(dueIn(5), 'u1', NOW + HOUR);
    expect(first?.id).toBe(second?.id);
  });

  it('addresses one person, so two group mates get their own', () => {
    expect(dueSoonNotification(dueIn(6), 'u1', NOW)?.id).not.toBe(
      dueSoonNotification(dueIn(6), 'u2', NOW)?.id,
    );
  });

  it('refuses a deadline that is not a date rather than inventing one', () => {
    expect(dueSoonNotification(dueIn(6, { submissionDeadline: 'soon' }), 'u1', NOW)).toBeNull();
  });
});

describe('reading order', () => {
  it('puts anything unread ahead of anything already seen', () => {
    const order = sortForReading([
      stored({ id: 'old-read', createdAt: '2026-03-01T08:30:00.000Z', readAt: 'x' }),
      stored({ id: 'unread', createdAt: '2026-03-01T07:00:00.000Z' }),
    ]);
    expect(order.map((n) => n.id)).toEqual(['unread', 'old-read']);
  });

  it('is newest first within each of those two groups', () => {
    const order = sortForReading([
      stored({ id: 'a', createdAt: '2026-03-01T07:00:00.000Z' }),
      stored({ id: 'b', createdAt: '2026-03-01T08:00:00.000Z' }),
    ]);
    expect(order.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('does not mutate what it was handed', () => {
    const input = [stored({ id: 'a' }), stored({ id: 'b', createdAt: '2026-03-02T00:00:00.000Z' })];
    sortForReading(input);
    expect(input.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('counts only what has not been read', () => {
    expect(unreadCount([stored(), stored({ id: 'n2', readAt: 'x' })])).toBe(1);
  });
});

describe('the message key', () => {
  it('flattens the dot, which a message catalogue reads as a namespace', () => {
    expect(notificationKeyOf('assignment.created')).toBe('assignmentCreated');
    expect(notificationKeyOf('submission.dueSoon')).toBe('submissionDueSoon');
  });
});

describe('what is stored', () => {
  it('keeps a key and its parameters, never a rendered sentence', () => {
    const parsed = notificationSchema.parse({
      id: 'n1',
      recipientUid: 'u1',
      kind: 'assignment.created',
      params: { deadline: '2026-03-03T17:00:00.000Z' },
      href: '/classes/C1',
      createdAt: '2026-03-01T08:00:00.000Z',
    });
    expect(parsed.kind).toBe('assignment.created');
    expect(parsed.params.deadline).toBe('2026-03-03T17:00:00.000Z');
  });

  it('defaults the parameters, so a notification that needs none still parses', () => {
    const parsed = notificationSchema.parse({
      id: 'n1',
      recipientUid: 'u1',
      kind: 'question.selected',
      href: '/sessions/S1',
      createdAt: '2026-03-01T08:00:00.000Z',
    });
    expect(parsed.params).toEqual({});
  });

  it('rejects a kind the interface has no sentence for', () => {
    expect(() => notificationSchema.parse({ ...stored(), kind: 'something.else' })).toThrow();
  });
});
