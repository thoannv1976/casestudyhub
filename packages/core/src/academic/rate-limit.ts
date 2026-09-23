import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getDb } from '../firebase/admin';
import { AppError } from '../errors';

/**
 * Rate limiting for endpoints an anonymous visitor can reach.
 *
 * The counter lives in Firestore rather than in memory: Cloud Run runs several
 * instances, and an in-memory limit would let an attacker get N attempts per
 * instance simply by making enough parallel requests.
 */

const COLLECTION = 'rateLimits';

export interface RateLimitOptions {
  /** What is being limited, e.g. `register:203.0.113.7`. */
  key: string;
  max: number;
  windowMs: number;
  messageKey?: string;
}

export async function enforceRateLimit({
  key,
  max,
  windowMs,
  messageKey = 'errors.tooManyAttempts',
}: RateLimitOptions): Promise<void> {
  const db = getDb();
  // The key can contain anything (an IP, an email); hashing it to a safe id
  // keeps it out of the document path and out of anyone's console.
  const docId = Buffer.from(key).toString('base64url').slice(0, 400);
  const ref = db.collection(COLLECTION).doc(docId);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const now = Date.now();

    if (snapshot.exists) {
      const windowStart = (snapshot.get('windowStart') as Timestamp | undefined)?.toMillis() ?? 0;
      const count = (snapshot.get('count') as number | undefined) ?? 0;

      if (now - windowStart < windowMs) {
        if (count >= max) {
          throw new AppError('RATE_LIMITED', messageKey, {
            details: { retryAfterMs: windowMs - (now - windowStart) },
          });
        }
        tx.update(ref, { count: FieldValue.increment(1) });
        return;
      }
    }

    tx.set(ref, {
      count: 1,
      windowStart: Timestamp.fromMillis(now),
      // Lets a TTL policy clear old counters without a cleanup job.
      expiresAt: Timestamp.fromMillis(now + windowMs * 2),
    });
  });
}

/** Best-effort client address from the proxy headers Cloud Run sets. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? 'unknown';
}
