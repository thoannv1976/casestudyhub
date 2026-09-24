import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * What an administrator can do to somebody else's account, against the real
 * Auth emulator and the real database.
 *
 * Setting a password for another person is the one action that hands one
 * account the ability to sign in as another, so what is checked here is not
 * that it works but that it cannot be done quietly: the password is temporary,
 * the target's sessions are cut, and the log names who did it and why.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const { getDb, getAdminAuth, createAccount, resetUserPassword, updateUserByAdmin, getUserProfile } =
  await import('@casestudyhub/core');
const { COLLECTIONS } = await import('@casestudyhub/shared');

const RUN = Date.now().toString().slice(-7);
const admin = { uid: '', email: `admin.${RUN}@x.edu.vn`, role: 'admin' as const };
const other = { email: `lecturer.${RUN}@x.edu.vn` };
const learner = { email: `student.${RUN}@x.edu.vn`, studentId: `UA${RUN}` };

const REASON = 'They rang the office having forgotten it before the session.';

async function seedAdmin() {
  const record = await getAdminAuth().createUser({ email: admin.email, password: 'adminPass2026' });
  admin.uid = record.uid;
  await getDb().collection(COLLECTIONS.users).doc(record.uid).set({
    uid: record.uid,
    fullName: 'Quan tri vien',
    email: admin.email,
    globalRole: 'admin',
    preferredLanguage: 'vi',
    status: 'active',
  });
}

async function wipe() {
  const auth = getAdminAuth();
  const db = getDb();

  for (const email of [admin.email, other.email, learner.email]) {
    const user = await auth.getUserByEmail(email).catch(() => null);
    if (!user) continue;
    await auth.deleteUser(user.uid);
    await db.collection(COLLECTIONS.users).doc(user.uid).delete();
  }

  const indexed = await db
    .collection(COLLECTIONS.studentIdIndex)
    .where('studentId', '==', learner.studentId)
    .get();
  await Promise.all(indexed.docs.map((doc) => doc.ref.delete()));

  const logs = await db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', admin.uid).get();
  await Promise.all(logs.docs.map((doc) => doc.ref.delete()));
}

async function auditEntries(action: string) {
  const snapshot = await getDb()
    .collection(COLLECTIONS.auditLogs)
    .where('actorUid', '==', admin.uid)
    .get();
  return snapshot.docs.map((doc) => doc.data()).filter((entry) => entry.action === action);
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(async () => {
  await wipe();
  await seedAdmin();
});

afterAll(wipe);

describe('creating an account', () => {
  it('creates a lecturer who must choose their own password first', async () => {
    const { uid } = await createAccount(admin, {
      email: other.email,
      fullName: 'Tran Thi B',
      role: 'lecturer',
      temporaryPassword: 'tempPass2026',
      preferredLanguage: 'vi',
    });

    const profile = await getUserProfile(uid);
    expect(profile?.globalRole).toBe('lecturer');
    expect(profile?.mustChangePassword).toBe(true);

    const claims = (await getAdminAuth().getUser(uid)).customClaims ?? {};
    expect(claims.mustChangePassword).toBe(true);
    expect(claims.role).toBe('lecturer');
  });

  it('creates a student, claiming their code so nobody else can take it', async () => {
    const { uid } = await createAccount(admin, {
      email: learner.email,
      fullName: 'Nguyen Van A',
      role: 'student',
      temporaryPassword: 'tempPass2026',
      preferredLanguage: 'vi',
      studentId: learner.studentId,
    });

    const profile = await getUserProfile(uid);
    expect(profile?.studentId).toBe(learner.studentId);
    expect(profile?.mustChangePassword).toBe(true);

    const claimed = await getDb()
      .collection(COLLECTIONS.studentIdIndex)
      .doc(learner.studentId)
      .get();
    expect(claimed.get('uid')).toBe(uid);
  });

  it('refuses a second account on a student code already taken', async () => {
    await createAccount(admin, {
      email: learner.email,
      fullName: 'Nguyen Van A',
      role: 'student',
      temporaryPassword: 'tempPass2026',
      preferredLanguage: 'vi',
      studentId: learner.studentId,
    });

    await expect(
      createAccount(admin, {
        email: `second.${RUN}@x.edu.vn`,
        fullName: 'Nguyen Van B',
        role: 'student',
        temporaryPassword: 'tempPass2026',
        preferredLanguage: 'vi',
        studentId: learner.studentId,
      }),
    ).rejects.toThrow(/studentIdTaken/);

    // And the auth account for the refused attempt is not left behind, or the
    // address is taken by somebody who has no profile and can never register.
    await expect(getAdminAuth().getUserByEmail(`second.${RUN}@x.edu.vn`)).rejects.toThrow();
  });
});

describe('setting a password for somebody else', () => {
  async function seedLecturer() {
    const { uid } = await createAccount(admin, {
      email: other.email,
      fullName: 'Tran Thi B',
      role: 'lecturer',
      temporaryPassword: 'tempPass2026',
      preferredLanguage: 'vi',
    });
    // As if they had signed in and chosen their own, which is the state a real
    // account is in by the time its password is lost.
    const auth = getAdminAuth();
    await auth.setCustomUserClaims(uid, { role: 'lecturer', preferredLanguage: 'vi' });
    await getDb().collection(COLLECTIONS.users).doc(uid).update({ mustChangePassword: false });
    return uid;
  }

  it('leaves the account owing a password change', async () => {
    const uid = await seedLecturer();
    await resetUserPassword(admin, uid, 'freshPass2026', REASON);

    expect((await getUserProfile(uid))?.mustChangePassword).toBe(true);
    expect((await getAdminAuth().getUser(uid)).customClaims?.mustChangePassword).toBe(true);
  });

  it('cuts every session the account has open', async () => {
    const uid = await seedLecturer();
    const before = (await getAdminAuth().getUser(uid)).tokensValidAfterTime;

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await resetUserPassword(admin, uid, 'freshPass2026', REASON);

    const after = (await getAdminAuth().getUser(uid)).tokensValidAfterTime;
    expect(Date.parse(after ?? '')).toBeGreaterThan(Date.parse(before ?? ''));
  });

  it('records who did it, to whom and why - and never the password', async () => {
    const uid = await seedLecturer();
    await resetUserPassword(admin, uid, 'freshPass2026', REASON);

    const entries = await auditEntries('user.password_changed');
    expect(entries).toHaveLength(1);

    const entry = entries[0]!;
    expect(entry.actorUid).toBe(admin.uid);
    expect(entry.target).toBe(`${COLLECTIONS.users}/${uid}`);
    expect(entry.reason).toBe(REASON);
    expect(entry.after).toMatchObject({ resetByAdministrator: true, targetRole: 'lecturer' });
    expect(JSON.stringify(entry)).not.toContain('freshPass2026');
  });

  it('refuses to let an administrator set their own', async () => {
    await expect(resetUserPassword(admin, admin.uid, 'freshPass2026', REASON)).rejects.toThrow(
      /useOwnPasswordPage/,
    );
  });

  it('refuses an account that does not exist rather than creating one', async () => {
    await expect(
      resetUserPassword(admin, 'nobody_at_all', 'freshPass2026', REASON),
    ).rejects.toThrow(/userNotFound/);
  });
});

describe('correcting somebody’s details', () => {
  it('changes the name and the language, in the profile and in the claim', async () => {
    const { uid } = await createAccount(admin, {
      email: other.email,
      fullName: 'Tran Thi B',
      role: 'lecturer',
      temporaryPassword: 'tempPass2026',
      preferredLanguage: 'vi',
    });

    await updateUserByAdmin(
      admin,
      uid,
      { fullName: 'Tran Thi Bich', preferredLanguage: 'en' },
      'Spelling corrected from the faculty list.',
    );

    const profile = await getUserProfile(uid);
    expect(profile?.fullName).toBe('Tran Thi Bich');
    expect(profile?.preferredLanguage).toBe('en');

    const user = await getAdminAuth().getUser(uid);
    expect(user.displayName).toBe('Tran Thi Bich');
    expect(user.customClaims?.preferredLanguage).toBe('en');
    // Correcting a name must not quietly clear what else the claim carries.
    expect(user.customClaims?.role).toBe('lecturer');
  });

  it('writes nothing when nothing actually changed', async () => {
    const { uid } = await createAccount(admin, {
      email: other.email,
      fullName: 'Tran Thi B',
      role: 'lecturer',
      temporaryPassword: 'tempPass2026',
      preferredLanguage: 'vi',
    });

    await updateUserByAdmin(
      admin,
      uid,
      { fullName: 'Tran Thi B', preferredLanguage: 'vi' },
      'Opened the form and saved it unchanged.',
    );

    expect(await auditEntries('user.profile_corrected')).toHaveLength(0);
  });
});
