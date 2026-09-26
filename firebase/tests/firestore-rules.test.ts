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

describe('platform settings and what the model cost', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'systemSettings', 'platform'), { aiMonthlyCallBudget: 500 });
      await setDoc(doc(db, 'systemSettings', 'aiCredentials'), {
        openai: { key: 'sk-stored', hint: 'ored' },
      });
      await setDoc(doc(db, 'aiUsage', '2026-03'), { period: '2026-03', calls: 3 });
    });
  });

  it('cannot be read or changed by any client, administrator included', async () => {
    await assertFails(getDoc(doc(admin(), 'systemSettings', 'platform')));
    await assertFails(
      updateDoc(doc(admin(), 'systemSettings', 'platform'), { aiMonthlyCallBudget: 99999 }),
    );
  });

  it('keeps the stored API keys unreadable, which is what lets them live here', async () => {
    // The administration page shows four characters of a key and no more. If a
    // client could read this document, that restraint would be decoration.
    await assertFails(getDoc(doc(admin(), 'systemSettings', 'aiCredentials')));
    await assertFails(getDoc(doc(student(), 'systemSettings', 'aiCredentials')));
    await assertFails(
      setDoc(doc(admin(), 'systemSettings', 'aiCredentials'), { openai: { key: 'sk-forged' } }),
    );
  });

  it('will not let anybody spend somebody else’s budget by rewriting the count', async () => {
    await assertFails(getDoc(doc(student(), 'aiUsage', '2026-03')));
    await assertFails(updateDoc(doc(admin(), 'aiUsage', '2026-03'), { calls: 0 }));
    await assertFails(deleteDoc(doc(admin(), 'aiUsage', '2026-03')));
  });
});

describe('the assessment framework', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'policies', 'ecommerce-2026__2026.1'), {
        id: 'ecommerce-2026',
        version: '2026.1',
      });
    });
  });

  it('is served by the server, because which version applies depends on a stamp', async () => {
    await assertFails(getDoc(doc(student(), 'policies', 'ecommerce-2026__2026.1')));
    await assertFails(getDoc(doc(lecturer(), 'policies', 'ecommerce-2026__2026.1')));
    await assertFails(getDoc(doc(admin(), 'policies', 'ecommerce-2026__2026.1')));
  });

  it('cannot be rewritten by a client - a mark was computed from this', async () => {
    await assertFails(
      updateDoc(doc(admin(), 'policies', 'ecommerce-2026__2026.1'), { version: '2026.2' }),
    );
    await assertFails(deleteDoc(doc(admin(), 'policies', 'ecommerce-2026__2026.1')));
    await assertFails(
      setDoc(doc(lecturer(), 'policies', 'forged__1'), { id: 'forged', version: '1' }),
    );
  });
});

describe('notifications', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'notifications', 'n1'), {
        id: 'n1',
        recipientUid: STUDENT_UID,
        kind: 'grade.published',
        params: {},
        href: '/classes/C1',
        createdAt: '2026-03-01T08:00:00.000Z',
      });
    });
  });

  it('are served by the server, so not even their owner reads them directly', async () => {
    await assertFails(getDoc(doc(student(), 'notifications', 'n1')));
    await assertFails(getDoc(doc(anonymous(), 'notifications', 'n1')));
  });

  it("cannot be marked read by a client, which could mark anyone else's too", async () => {
    await assertFails(updateDoc(doc(student(), 'notifications', 'n1'), { readAt: 'now' }));
    await assertFails(deleteDoc(doc(student(), 'notifications', 'n1')));
  });

  it('cannot be forged - a student could otherwise announce their own mark', async () => {
    await assertFails(
      setDoc(doc(student(), 'notifications', 'forged'), {
        id: 'forged',
        recipientUid: OTHER_STUDENT_UID,
        kind: 'grade.published',
        params: {},
        href: '/classes/C1',
        createdAt: '2026-03-01T08:00:00.000Z',
      }),
    );
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

describe('case study library', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'caseStudies', 'published_case'), {
        id: 'published_case',
        caseCode: 'CASE01',
        title: 'Amazon',
        courseId: 'ECOM2026',
        language: 'en',
        status: 'published',
        attachments: [],
      });
      await setDoc(doc(db, 'caseStudies', 'draft_case'), {
        id: 'draft_case',
        caseCode: 'CASE02',
        title: 'Walmart',
        courseId: 'ECOM2026',
        language: 'en',
        status: 'draft',
        attachments: [],
      });
    });
  });

  it('lets a student read a published case', async () => {
    await assertSucceeds(getDoc(doc(student(), 'caseStudies', 'published_case')));
  });

  it('stops a student reading a case the lecturer is still preparing', async () => {
    await assertFails(getDoc(doc(student(), 'caseStudies', 'draft_case')));
  });

  it('lets a lecturer read a draft', async () => {
    await assertSucceeds(getDoc(doc(lecturer(), 'caseStudies', 'draft_case')));
  });

  it('stops an anonymous visitor reading any case', async () => {
    await assertFails(getDoc(doc(anonymous(), 'caseStudies', 'published_case')));
  });

  it('stops a student publishing a case or attaching a file', async () => {
    await assertFails(
      updateDoc(doc(student(), 'caseStudies', 'draft_case'), { status: 'published' }),
    );
    await assertFails(
      updateDoc(doc(student(), 'caseStudies', 'published_case'), { attachments: [] }),
    );
  });

  it('stops even a lecturer writing a case directly', async () => {
    await assertFails(
      updateDoc(doc(lecturer(), 'caseStudies', 'draft_case'), { status: 'published' }),
    );
  });
});

describe('assignments and submissions', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'assignments', 'A1'), {
        id: 'A1',
        classId: 'ECOM-A01',
        groupId: 'G1',
        caseStudyId: 'published_case',
        submissionDeadline: '2026-10-01T02:00:00.000Z',
        status: 'submission_open',
      });
      await setDoc(doc(db, 'submissions', 'S1'), {
        id: 'S1',
        assignmentId: 'A1',
        groupId: 'G1',
        deliverableId: 'slides-pdf',
        versionNumber: 1,
        isLate: false,
        status: 'ready',
      });
    });
  });

  it('lets the class see what has been set and when it is due', async () => {
    await assertSucceeds(getDoc(doc(student(), 'assignments', 'A1')));
  });

  it('stops a student moving their own deadline', async () => {
    await assertFails(
      updateDoc(doc(student(), 'assignments', 'A1'), {
        submissionDeadline: '2027-01-01T00:00:00.000Z',
      }),
    );
  });

  it('stops even a lecturer changing a deadline without the audited path', async () => {
    await assertFails(updateDoc(doc(lecturer(), 'assignments', 'A1'), { status: 'completed' }));
  });

  it('keeps submissions out of every client, so membership is checked server-side', async () => {
    await assertFails(getDoc(doc(student(), 'submissions', 'S1')));
    await assertFails(getDoc(doc(otherStudent(), 'submissions', 'S1')));
    await assertFails(getDoc(doc(lecturer(), 'submissions', 'S1')));
  });

  it('stops a student rewriting a submission to look on time', async () => {
    await assertFails(updateDoc(doc(student(), 'submissions', 'S1'), { isLate: false }));
    await assertFails(
      setDoc(doc(student(), 'submissions', 'forged'), {
        assignmentId: 'A1',
        groupId: 'G1',
        deliverableId: 'slides-pdf',
        versionNumber: 99,
        isLate: false,
      }),
    );
  });
});

describe('presentation sessions and the question wall', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'presentationSessions', 'PS1'), {
        id: 'PS1',
        classId: 'C1',
        assignmentId: 'A1',
        groupId: 'G1',
        caseStudyId: 'CS1',
        status: 'live',
        currentRoleId: 'R1',
        runningSinceMs: 1_000,
        accumulatedMs: 0,
        roleMs: {},
        questionsOpen: true,
        peerReviewOpen: false,
      });
      await setDoc(doc(db, 'questions', 'PS1__student_b'), {
        id: 'PS1__student_b',
        caseStudyId: 'CS1',
        sessionId: 'PS1',
        classId: 'C1',
        groupId: 'G1',
        askedByUid: OTHER_STUDENT_UID,
        askedByName: 'Tran Thi B',
        askedByStudentId: 'SV002',
        anonymousToClass: true,
        roleId: 'R3',
        category: 'evidence',
        text: 'Which number proves the unit economics claim?',
        upvotes: 0,
        status: 'submitted',
        answeredByAi: false,
      });
      await setDoc(doc(db, 'questionVotes', 'PS1__student_b__student_a'), {
        questionId: 'PS1__student_b',
        voterUid: STUDENT_UID,
      });
      await setDoc(doc(db, 'questionResponses', 'QR1'), {
        questionId: 'PS1__student_b',
        sessionId: 'PS1',
        responderUid: STUDENT_UID,
      });
    });
  });

  it('lets the class see the room: which group is on and where the clock is', async () => {
    await assertSucceeds(getDoc(doc(student(), 'presentationSessions', 'PS1')));
    await assertSucceeds(getDoc(doc(lecturer(), 'presentationSessions', 'PS1')));
  });

  it('refuses the room to someone who is not signed in', async () => {
    await assertFails(getDoc(doc(anonymous(), 'presentationSessions', 'PS1')));
  });

  it('stops a group awarding itself time on the clock', async () => {
    await assertFails(
      updateDoc(doc(student(), 'presentationSessions', 'PS1'), { accumulatedMs: 0 }),
    );
    await assertFails(
      updateDoc(doc(student(), 'presentationSessions', 'PS1'), { runningSinceMs: null }),
    );
    // Even the lecturer goes through the server, which settles the running
    // stretch into the totals before writing.
    await assertFails(
      updateDoc(doc(lecturer(), 'presentationSessions', 'PS1'), { currentRoleId: 'R4' }),
    );
  });

  it('keeps an anonymous question anonymous by keeping the document off the client', async () => {
    // The wall is read through a route handler that strips the asker's name
    // per viewer. If the document itself were readable, that would be theatre.
    await assertFails(getDoc(doc(student(), 'questions', 'PS1__student_b')));
    await assertFails(getDocs(collection(student(), 'questions')));
    await assertFails(getDoc(doc(lecturer(), 'questions', 'PS1__student_b')));
  });

  it('stops a student writing a question straight into the collection', async () => {
    // The document id carries the one-question-per-student rule and the group
    // being asked cannot ask itself; both are checked server-side.
    await assertFails(
      setDoc(doc(student(), 'questions', 'PS1__student_a'), {
        sessionId: 'PS1',
        askedByUid: STUDENT_UID,
        text: 'A question written round the back.',
        status: 'submitted',
      }),
    );
    await assertFails(
      updateDoc(doc(student(), 'questions', 'PS1__student_b'), { status: 'selected' }),
    );
    await assertFails(deleteDoc(doc(student(), 'questions', 'PS1__student_b')));
  });

  it('stops a student stuffing the upvotes', async () => {
    await assertFails(updateDoc(doc(student(), 'questions', 'PS1__student_b'), { upvotes: 99 }));
    await assertFails(
      setDoc(doc(student(), 'questionVotes', 'PS1__student_b__forged'), {
        questionId: 'PS1__student_b',
        voterUid: STUDENT_UID,
      }),
    );
    await assertFails(getDoc(doc(student(), 'questionVotes', 'PS1__student_b__student_a')));
  });

  it('keeps who answered what out of the client, since it feeds the individual mark', async () => {
    await assertFails(getDoc(doc(student(), 'questionResponses', 'QR1')));
    await assertFails(
      setDoc(doc(student(), 'questionResponses', 'forged'), {
        questionId: 'PS1__student_b',
        sessionId: 'PS1',
        responderUid: STUDENT_UID,
      }),
    );
  });
});

describe('peer assessment', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'peerReviews', 'PS1__student_b'), {
        id: 'PS1__student_b',
        sessionId: 'PS1',
        classId: 'C1',
        caseStudyId: 'CS1',
        groupId: 'G1',
        reviewerUid: OTHER_STUDENT_UID,
        reviewerName: 'Tran Thi B',
        reviewerStudentId: 'SV002',
        reviewerGroupId: 'G2',
        scores: { understanding: 18 },
        total: 82,
        rubricId: 'rubric-standard-100',
        rubricVersion: '2026.1',
        submittedAt: '2026-10-01T02:00:00.000Z',
      });
    });
  });

  it('keeps one student from reading what another gave', async () => {
    // A class that could read each other's scores would start scoring each
    // other's scores, and a group would see which classmates marked it down.
    await assertFails(getDoc(doc(student(), 'peerReviews', 'PS1__student_b')));
    await assertFails(getDocs(collection(student(), 'peerReviews')));
  });

  it('keeps the distribution behind the server even for the lecturer', async () => {
    await assertFails(getDoc(doc(lecturer(), 'peerReviews', 'PS1__student_b')));
    await assertFails(getDoc(doc(admin(), 'peerReviews', 'PS1__student_b')));
  });

  it('stops a student writing or editing a score directly', async () => {
    await assertFails(
      setDoc(doc(student(), 'peerReviews', 'PS1__student_a'), {
        sessionId: 'PS1',
        groupId: 'G1',
        reviewerUid: STUDENT_UID,
        total: 100,
      }),
    );
    await assertFails(updateDoc(doc(student(), 'peerReviews', 'PS1__student_b'), { total: 0 }));
    await assertFails(deleteDoc(doc(student(), 'peerReviews', 'PS1__student_b')));
  });
});

describe('marking and grades', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lecturerAssessments', 'A1'), {
        id: 'A1',
        assignmentId: 'A1',
        classId: 'C1',
        groupId: 'G1',
        caseStudyId: 'CS1',
        criterionScores: { understanding: 18 },
        groupScoreRaw: 88,
        latePenaltyWaived: false,
        individual: {},
        rubricId: 'rubric-standard-100',
        rubricVersion: '2026.1',
        policyId: 'ecom-2026-standard',
        policyVersion: '2026.1',
        status: 'draft',
        assessedByUid: LECTURER_UID,
        assessedByName: 'Tran Thi B',
        updatedAt: '2026-10-01T02:00:00.000Z',
      });
      await setDoc(doc(db, 'grades', 'A1__student_a'), {
        id: 'A1__student_a',
        assignmentId: 'A1',
        groupId: 'G1',
        studentUid: STUDENT_UID,
        groupScore: 88,
        individualScore: 70,
        finalScore: 84.4,
        policyId: 'ecom-2026-standard',
        policyVersion: '2026.1',
        status: 'published',
      });
    });
  });

  it('keeps a draft mark out of every client, students included', async () => {
    // A draft is the lecturer's working note. A student who could read it
    // would learn their mark before the lecturer decided to give it.
    await assertFails(getDoc(doc(student(), 'lecturerAssessments', 'A1')));
    await assertFails(getDocs(collection(student(), 'lecturerAssessments')));
  });

  it('serves a published grade through the server, not through the client', async () => {
    // Reading is fine; what a rule cannot express is "published grades only,
    // and only your own", so the route handler does both.
    await assertFails(getDoc(doc(student(), 'grades', 'A1__student_a')));
    await assertFails(getDocs(collection(student(), 'grades')));
  });

  it('stops a student improving their own mark', async () => {
    await assertFails(updateDoc(doc(student(), 'grades', 'A1__student_a'), { finalScore: 100 }));
    await assertFails(
      setDoc(doc(student(), 'grades', 'A1__forged'), {
        assignmentId: 'A1',
        studentUid: STUDENT_UID,
        finalScore: 100,
        status: 'published',
      }),
    );
    await assertFails(deleteDoc(doc(student(), 'grades', 'A1__student_a')));
  });

  it('stops even a lecturer publishing a grade round the back of the engine', async () => {
    // Publishing computes every member's mark from the frozen policy version
    // in one transaction. A direct write would skip all of it.
    await assertFails(
      updateDoc(doc(lecturer(), 'lecturerAssessments', 'A1'), { status: 'published' }),
    );
    await assertFails(updateDoc(doc(lecturer(), 'grades', 'A1__student_a'), { finalScore: 100 }));
  });
});

describe('AI suggestions', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'aiAssessments', 'A1'), {
        id: 'A1',
        assignmentId: 'A1',
        classId: 'C1',
        groupId: 'G1',
        caseStudyId: 'CS1',
        criteria: [],
        suggestedTotal: 72,
        assessableMaxPoints: 90,
        gaps: [],
        rubricId: 'rubric-standard-100',
        rubricVersion: '2026.1',
        model: 'fake-model-1',
        createdAt: '2026-10-01T02:00:00.000Z',
        requestedByUid: LECTURER_UID,
      });
    });
  });

  it('keeps a suggestion no one has agreed to away from the student it is about', async () => {
    await assertFails(getDoc(doc(student(), 'aiAssessments', 'A1')));
    await assertFails(getDocs(collection(student(), 'aiAssessments')));
  });

  it('stops anyone writing a suggestion into the database directly', async () => {
    // Every suggestion is reconciled against the rubric on the way in, which a
    // direct write would skip: it could score the criterion judged in the room.
    await assertFails(
      setDoc(doc(lecturer(), 'aiAssessments', 'forged'), {
        assignmentId: 'A1',
        suggestedTotal: 100,
      }),
    );
    await assertFails(updateDoc(doc(lecturer(), 'aiAssessments', 'A1'), { suggestedTotal: 90 }));
  });
});

describe('tutor conversations', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'aiTutorSessions', `CS1__${OTHER_STUDENT_UID}`), {
        id: `CS1__${OTHER_STUDENT_UID}`,
        caseStudyId: 'CS1',
        studentUid: OTHER_STUDENT_UID,
        turns: [{ role: 'student', text: 'I do not understand the revenue split.', at: 'x' }],
        updatedAt: '2026-10-01T02:00:00.000Z',
      });
    });
  });

  it('keeps one student from reading what another asked the tutor', async () => {
    // What a student admits they do not understand is theirs alone.
    await assertFails(getDoc(doc(student(), 'aiTutorSessions', `CS1__${OTHER_STUDENT_UID}`)));
    await assertFails(getDocs(collection(student(), 'aiTutorSessions')));
    await assertFails(getDoc(doc(lecturer(), 'aiTutorSessions', `CS1__${OTHER_STUDENT_UID}`)));
  });

  it('is written only by the server, which knows whose it is', async () => {
    await assertFails(
      setDoc(doc(student(), 'aiTutorSessions', `CS1__${STUDENT_UID}`), {
        caseStudyId: 'CS1',
        studentUid: STUDENT_UID,
        turns: [],
      }),
    );
    await assertFails(
      updateDoc(doc(student(), 'aiTutorSessions', `CS1__${OTHER_STUDENT_UID}`), { turns: [] }),
    );
  });
});
