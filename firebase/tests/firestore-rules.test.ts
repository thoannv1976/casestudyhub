import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

/**
 * Firestore Security Rules tests (SRS Part XII).
 *
 * These run against the Firebase Emulator, so they exercise the rules exactly
 * as production evaluates them. They are the second line of defence: the route
 * handlers check the same conditions first, and both must hold.
 */

const RULES_PATH = fileURLToPath(new URL('../firestore.rules', import.meta.url));

const STUDENT_UID = 'student_a';
const SUSPENDED_UID = 'student_suspended';
const OTHER_STUDENT_UID = 'student_b';
const LECTURER_UID = 'lecturer_a';
const ADMIN_UID = 'admin_a';

let testEnv: RulesTestEnvironment;

const student = () => testEnv.authenticatedContext(STUDENT_UID, { role: 'student' }).firestore();
const otherStudent = () =>
  testEnv.authenticatedContext(OTHER_STUDENT_UID, { role: 'student' }).firestore();
const suspendedStudent = () =>
  testEnv.authenticatedContext(SUSPENDED_UID, { role: 'student' }).firestore();
const lecturer = () => testEnv.authenticatedContext(LECTURER_UID, { role: 'lecturer' }).firestore();
const admin = () => testEnv.authenticatedContext(ADMIN_UID, { role: 'admin' }).firestore();
const anonymous = () => testEnv.unauthenticatedContext().firestore();

function profile(uid: string, overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    uid,
    studentId: uid.toUpperCase(),
    fullName: 'Nguyen Van A',
    email: `${uid}@university.edu.vn`,
    globalRole: 'student',
    preferredLanguage: 'vi',
    status: 'active',
    ...overrides,
  };
  // Firestore rejects undefined, and staff accounts simply have no student id.
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) delete base[key];
  }
  return base;
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-casestudyhub',
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed as the platform would: through the server, bypassing rules.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', STUDENT_UID), profile(STUDENT_UID));
    await setDoc(doc(db, 'users', OTHER_STUDENT_UID), profile(OTHER_STUDENT_UID));
    await setDoc(doc(db, 'users', SUSPENDED_UID), profile(SUSPENDED_UID, { status: 'suspended' }));
    await setDoc(
      doc(db, 'users', LECTURER_UID),
      profile(LECTURER_UID, { globalRole: 'lecturer', studentId: undefined }),
    );
    await setDoc(doc(db, 'studentIdIndex', 'STUDENT_A'), { uid: STUDENT_UID, studentId: 'SV001' });
    await setDoc(doc(db, 'auditLogs', 'log_1'), {
      action: 'user.role_changed',
      actorUid: ADMIN_UID,
    });
    await setDoc(doc(db, 'classes', 'ECOM-A01'), { classCode: 'ECOM-A01', status: 'active' });
  });
});

describe('users collection', () => {
  it('lets a student read their own profile', async () => {
    await assertSucceeds(getDoc(doc(student(), 'users', STUDENT_UID)));
  });

  it('stops a student reading another student profile', async () => {
    await assertFails(getDoc(doc(student(), 'users', OTHER_STUDENT_UID)));
  });

  it('stops a student listing every account', async () => {
    await assertFails(getDocs(collection(student(), 'users')));
  });

  it('lets a lecturer read a student profile and list accounts', async () => {
    await assertSucceeds(getDoc(doc(lecturer(), 'users', STUDENT_UID)));
    await assertSucceeds(getDocs(collection(lecturer(), 'users')));
  });

  it('stops an anonymous visitor reading any profile', async () => {
    await assertFails(getDoc(doc(anonymous(), 'users', STUDENT_UID)));
  });

  it('lets a student change their own name and language', async () => {
    await assertSucceeds(
      updateDoc(doc(student(), 'users', STUDENT_UID), {
        fullName: 'Nguyen Van B',
        preferredLanguage: 'en',
      }),
    );
  });

  it('stops a student promoting themselves to lecturer or admin', async () => {
    await assertFails(updateDoc(doc(student(), 'users', STUDENT_UID), { globalRole: 'lecturer' }));
    await assertFails(updateDoc(doc(student(), 'users', STUDENT_UID), { globalRole: 'admin' }));
  });

  it('stops a suspended student reactivating their own account', async () => {
    // The real threat: not writing the status you already have, but changing it.
    await assertFails(
      updateDoc(doc(suspendedStudent(), 'users', SUSPENDED_UID), { status: 'active' }),
    );
  });

  it('stops a student suspending themselves out of an obligation', async () => {
    await assertFails(updateDoc(doc(student(), 'users', STUDENT_UID), { status: 'suspended' }));
  });

  it('stops a student rewriting their student id or email', async () => {
    await assertFails(updateDoc(doc(student(), 'users', STUDENT_UID), { studentId: 'SV999' }));
    await assertFails(updateDoc(doc(student(), 'users', STUDENT_UID), { email: 'other@x.edu.vn' }));
  });

  it('stops a student editing another student profile', async () => {
    await assertFails(updateDoc(doc(otherStudent(), 'users', STUDENT_UID), { fullName: 'Hacked' }));
  });

  it('stops anyone creating or deleting a profile from the client', async () => {
    await assertFails(setDoc(doc(student(), 'users', 'new_uid'), profile('new_uid')));
    await assertFails(setDoc(doc(admin(), 'users', 'new_uid'), profile('new_uid')));
    await assertFails(deleteDoc(doc(admin(), 'users', STUDENT_UID)));
  });
});

describe('studentIdIndex collection', () => {
  it('stops a student writing the uniqueness index', async () => {
    await assertFails(
      setDoc(doc(student(), 'studentIdIndex', 'SV999'), { uid: STUDENT_UID, studentId: 'SV999' }),
    );
  });

  it('stops even an admin writing it from the client', async () => {
    await assertFails(
      setDoc(doc(admin(), 'studentIdIndex', 'SV999'), { uid: ADMIN_UID, studentId: 'SV999' }),
    );
  });

  it('stops a student reading it', async () => {
    await assertFails(getDoc(doc(student(), 'studentIdIndex', 'STUDENT_A')));
  });
});

describe('audit logs and system settings', () => {
  it('are unreadable by every client, including an admin', async () => {
    await assertFails(getDoc(doc(student(), 'auditLogs', 'log_1')));
    await assertFails(getDoc(doc(lecturer(), 'auditLogs', 'log_1')));
    await assertFails(getDoc(doc(admin(), 'auditLogs', 'log_1')));
  });

  it('cannot be written by a client', async () => {
    await assertFails(setDoc(doc(admin(), 'auditLogs', 'forged'), { action: 'grade.published' }));
    await assertFails(setDoc(doc(admin(), 'systemSettings', 'ai'), { budget: 0 }));
  });
});

describe('collections of later phases stay closed', () => {
  it('refuses reads and writes until their module ships', async () => {
    await assertFails(getDoc(doc(student(), 'grades', 'grade_1')));
    await assertFails(setDoc(doc(student(), 'grades', 'grade_1'), { finalScore: 100 }));
    await assertFails(setDoc(doc(student(), 'submissions', 'sub_1'), { groupId: 'G01' }));
    await assertFails(setDoc(doc(student(), 'peerReviews', 'pr_1'), { score: 5 }));
  });
});

describe('academic structure', () => {
  it('is readable by a signed-in student but not by a visitor', async () => {
    await assertSucceeds(getDoc(doc(student(), 'classes', 'ECOM-A01')));
    await assertFails(getDoc(doc(anonymous(), 'classes', 'ECOM-A01')));
  });

  it('is never writable from the client', async () => {
    await assertFails(updateDoc(doc(lecturer(), 'classes', 'ECOM-A01'), { status: 'archived' }));
  });
});

describe('classEnrollments collection', () => {
  const ENROLLMENT_ID = 'ECOM-A01__SV001';

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'classEnrollments', ENROLLMENT_ID), {
        id: ENROLLMENT_ID,
        classId: 'ECOM-A01',
        studentId: 'SV001',
        studentUid: STUDENT_UID,
        fullName: 'Nguyen Van A',
        email: 'student_a@university.edu.vn',
        status: 'active',
        joinedVia: 'class_code',
      });
      await setDoc(doc(db, 'classEnrollments', 'ECOM-A01__SV002'), {
        id: 'ECOM-A01__SV002',
        classId: 'ECOM-A01',
        studentId: 'SV002',
        studentUid: OTHER_STUDENT_UID,
        fullName: 'Tran Thi B',
        email: 'student_b@university.edu.vn',
        status: 'active',
        joinedVia: 'class_code',
      });
    });
  });

  it('lets a student read their own enrolment', async () => {
    await assertSucceeds(getDoc(doc(student(), 'classEnrollments', ENROLLMENT_ID)));
  });

  it('stops a student reading a classmate enrolment', async () => {
    await assertFails(getDoc(doc(student(), 'classEnrollments', 'ECOM-A01__SV002')));
  });

  it('stops a student listing the whole roster', async () => {
    await assertFails(getDocs(collection(student(), 'classEnrollments')));
  });

  it('lets a lecturer read the roster', async () => {
    await assertSucceeds(getDocs(collection(lecturer(), 'classEnrollments')));
  });

  it('stops a student enrolling themselves by writing a document', async () => {
    // Joining must go through the server, which checks the class join mode and
    // keeps the student count correct.
    await assertFails(
      setDoc(doc(student(), 'classEnrollments', 'ECOM-A01__SV999'), {
        classId: 'ECOM-A01',
        studentId: 'SV999',
        studentUid: STUDENT_UID,
        status: 'active',
      }),
    );
  });

  it('stops a student promoting their own pending enrolment to active', async () => {
    await assertFails(
      updateDoc(doc(student(), 'classEnrollments', ENROLLMENT_ID), { status: 'active' }),
    );
  });

  it('stops a student undoing their removal', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'classEnrollments', ENROLLMENT_ID), {
        status: 'removed',
      });
    });
    await assertFails(
      updateDoc(doc(student(), 'classEnrollments', ENROLLMENT_ID), { status: 'active' }),
    );
  });

  it('stops even a lecturer writing an enrolment directly', async () => {
    await assertFails(
      updateDoc(doc(lecturer(), 'classEnrollments', ENROLLMENT_ID), { status: 'removed' }),
    );
  });

  it('stops an anonymous visitor reading enrolments', async () => {
    await assertFails(getDoc(doc(anonymous(), 'classEnrollments', ENROLLMENT_ID)));
  });
});

describe('rate limit counters', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'rateLimits', 'abc'), { count: 3 });
    });
  });

  it('cannot be read or reset by any client', async () => {
    await assertFails(getDoc(doc(student(), 'rateLimits', 'abc')));
    await assertFails(setDoc(doc(student(), 'rateLimits', 'abc'), { count: 0 }));
    await assertFails(setDoc(doc(admin(), 'rateLimits', 'abc'), { count: 0 }));
  });
});

describe('groups and membership', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'groups', 'G1'), {
        id: 'G1',
        groupCode: 'G01',
        groupName: 'Group 1',
        classId: 'ECOM-A01',
        maxMembers: 6,
        memberCount: 1,
        formationMode: 'student_self_join',
        locked: false,
        status: 'forming',
      });
      await setDoc(doc(db, 'groupMembers', 'ECOM-A01__student_a'), {
        id: 'ECOM-A01__student_a',
        groupId: 'G1',
        classId: 'ECOM-A01',
        studentUid: STUDENT_UID,
        studentId: 'SV001',
        fullName: 'Nguyen Van A',
        roleIds: ['R1'],
        isLeader: true,
      });
    });
  });

  it('lets a signed-in student see the groups and who is in them', async () => {
    await assertSucceeds(getDoc(doc(student(), 'groups', 'G1')));
    await assertSucceeds(getDocs(collection(student(), 'groupMembers')));
  });

  it('stops an anonymous visitor seeing them', async () => {
    await assertFails(getDoc(doc(anonymous(), 'groups', 'G1')));
    await assertFails(getDoc(doc(anonymous(), 'groupMembers', 'ECOM-A01__student_a')));
  });

  it('stops a student joining by writing a membership document', async () => {
    // Joining must go through the transaction that checks the free seat and
    // the one-group-per-class rule.
    await assertFails(
      setDoc(doc(otherStudent(), 'groupMembers', 'ECOM-A01__student_b'), {
        groupId: 'G1',
        classId: 'ECOM-A01',
        studentUid: OTHER_STUDENT_UID,
        studentId: 'SV002',
        fullName: 'Tran Thi B',
        roleIds: [],
      }),
    );
  });

  it('stops a student making room by editing the member count', async () => {
    await assertFails(updateDoc(doc(student(), 'groups', 'G1'), { memberCount: 0 }));
    await assertFails(updateDoc(doc(student(), 'groups', 'G1'), { maxMembers: 99 }));
  });

  it('stops a student giving themselves a different presentation role', async () => {
    await assertFails(
      updateDoc(doc(student(), 'groupMembers', 'ECOM-A01__student_a'), { roleIds: ['R3'] }),
    );
  });

  it('stops a student unlocking a locked group or leaving by deletion', async () => {
    await assertFails(updateDoc(doc(student(), 'groups', 'G1'), { locked: false }));
    await assertFails(deleteDoc(doc(student(), 'groupMembers', 'ECOM-A01__student_a')));
  });

  it('stops even a lecturer writing directly', async () => {
    await assertFails(updateDoc(doc(lecturer(), 'groups', 'G1'), { locked: true }));
  });
});
