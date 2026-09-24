import { z } from 'zod';
import { classCodeSchema, localeSchema, studentIdSchema, userRoleSchema } from '../domain/identity';

/** Request contracts for the academic structure and user administration. */

export const createAcademicYearSchema = z.object({
  name: z.string().trim().min(4, 'errors.nameInvalid').max(32, 'errors.nameInvalid'),
  startDate: z.iso.date('errors.dateInvalid'),
  endDate: z.iso.date('errors.dateInvalid'),
});

export const createSemesterSchema = z.object({
  academicYearId: z.string().min(1, 'errors.academicYearRequired'),
  name: z.string().trim().min(2, 'errors.nameInvalid').max(32, 'errors.nameInvalid'),
});

export const createCourseSchema = z.object({
  code: z.string().trim().min(2, 'errors.courseCodeInvalid').max(32, 'errors.courseCodeInvalid'),
  name: z.string().trim().min(2, 'errors.nameInvalid').max(160, 'errors.nameInvalid'),
  description: z.string().trim().max(2000).optional(),
  cloIds: z.array(z.string().trim().min(1).max(16)).max(20).default([]),
  defaultLanguage: localeSchema,
});

export const createClassSchema = z.object({
  classCode: classCodeSchema,
  className: z.string().trim().min(2, 'errors.nameInvalid').max(160, 'errors.nameInvalid'),
  courseId: z.string().min(1, 'errors.courseRequired'),
  semesterId: z.string().min(1, 'errors.semesterRequired'),
  language: localeSchema,
  expectedStudents: z.number().int().positive().max(1000).optional(),
  joinMode: z.enum(['code', 'approval', 'closed'], { error: 'errors.joinModeInvalid' }),
  /** Lecturers beside the creator. The creator is always added. */
  lecturerIds: z.array(z.string().min(1)).max(10).default([]),
});

export const updateClassSchema = createClassSchema.partial().extend({
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

export const joinClassSchema = z.object({
  classCode: classCodeSchema,
});

export const removeEnrollmentSchema = z.object({
  enrollmentId: z.string().min(1),
  reason: z.string().trim().min(3, 'errors.reasonRequired').max(500),
});

export const approveEnrollmentSchema = z.object({
  enrollmentId: z.string().min(1),
});

/**
 * A password an administrator types for somebody else. Long enough not to be
 * guessed, mixed enough not to be a word, and short-lived either way: whoever
 * receives one must replace it before they can do anything.
 */
export const temporaryPasswordSchema = z
  .string({ error: 'errors.passwordTooShort' })
  .min(8, 'errors.passwordTooShort')
  .max(128, 'errors.passwordTooLong')
  .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), 'errors.passwordTooSimple');

/**
 * Admin creates an account. The temporary password is handed over out of band
 * and must be changed at first sign-in, so it never becomes a shared long-term
 * credential.
 *
 * Students normally register themselves; this covers the ones who cannot -
 * an exchange student without a university address yet, somebody whose
 * registration failed. A student account needs a student code, because that
 * code is what a class roster is matched against.
 */
export const createAccountSchema = z
  .object({
    email: z.email('errors.emailInvalid'),
    fullName: z.string().trim().min(2, 'errors.fullNameInvalid').max(120, 'errors.fullNameInvalid'),
    // Spelled out rather than reusing `userRoleSchema`, which carries no
    // message key: a form that rejects a role has to say so in both languages.
    role: z.enum(['lecturer', 'admin', 'student'], { error: 'errors.roleInvalid' }),
    temporaryPassword: temporaryPasswordSchema,
    preferredLanguage: localeSchema,
    /** Required for a student, meaningless for anybody else. */
    studentId: z.union([studentIdSchema, z.literal('')]).optional(),
  })
  .refine((input) => input.role !== 'student' || Boolean(input.studentId), {
    message: 'errors.studentIdRequired',
    path: ['studentId'],
  });

/**
 * An administrator sets somebody else's password.
 *
 * It asks for more of a reason than a role change does: this is the one action
 * that hands one person the ability to sign in as another, and the note is
 * what a later reader has to go on.
 */
export const resetUserPasswordSchema = z.object({
  targetUid: z.string().min(1),
  temporaryPassword: temporaryPasswordSchema,
  reason: z.string().trim().min(10, 'errors.reasonTooShort').max(500),
});

/** An administrator corrects somebody's name or the language they read in. */
export const updateUserProfileSchema = z.object({
  targetUid: z.string().min(1),
  fullName: z.string().trim().min(2, 'errors.fullNameInvalid').max(120, 'errors.fullNameInvalid'),
  preferredLanguage: localeSchema,
  reason: z.string().trim().min(3, 'errors.reasonRequired').max(500),
});

export const changePasswordSchema = z
  .object({
    newPassword: z
      .string({ error: 'errors.passwordTooShort' })
      .min(8, 'errors.passwordTooShort')
      .max(128, 'errors.passwordTooLong')
      .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), 'errors.passwordTooSimple'),
    confirmPassword: z.string({ error: 'errors.passwordMismatch' }),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'errors.passwordMismatch',
    path: ['confirmPassword'],
  });

export const setRoleSchema = z.object({
  targetUid: z.string().min(1),
  role: userRoleSchema,
  reason: z.string().trim().min(3, 'errors.reasonRequired').max(500),
});

export const setStatusSchema = z.object({
  targetUid: z.string().min(1),
  status: z.enum(['active', 'suspended'], { error: 'errors.statusInvalid' }),
  reason: z.string().trim().min(3, 'errors.reasonRequired').max(500),
});

/** One row of a student import file, after parsing. */
export const importedStudentSchema = z.object({
  studentId: studentIdSchema,
  fullName: z.string().trim().min(2, 'errors.fullNameInvalid').max(120, 'errors.fullNameInvalid'),
  email: z.email('errors.emailInvalid'),
});
export type ImportedStudent = z.infer<typeof importedStudentSchema>;

/**
 * Schemas with `.default()` have a different input and output type: a form
 * binds to the input (the field may be absent), a service receives the output
 * (the default has been applied). Both are exported so neither side has to
 * guess.
 */
export type CreateClassInput = z.input<typeof createClassSchema>;
export type CreateCourseInput = z.input<typeof createCourseSchema>;

export type CreateAcademicYearRequest = z.infer<typeof createAcademicYearSchema>;
export type CreateSemesterRequest = z.infer<typeof createSemesterSchema>;
export type CreateCourseRequest = z.infer<typeof createCourseSchema>;
export type CreateClassRequest = z.infer<typeof createClassSchema>;
export type JoinClassRequest = z.infer<typeof joinClassSchema>;
export type CreateAccountRequest = z.infer<typeof createAccountSchema>;
export type ResetUserPasswordRequest = z.infer<typeof resetUserPasswordSchema>;
export type UpdateUserProfileRequest = z.infer<typeof updateUserProfileSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

/** Creating a case study in the library (SRS 5.2). */
export const createCaseSchema = z.object({
  caseCode: z
    .string({ error: 'errors.caseCodeInvalid' })
    .trim()
    .min(2, 'errors.caseCodeInvalid')
    .max(32, 'errors.caseCodeInvalid')
    .regex(/^[A-Za-z0-9-]+$/, 'errors.caseCodeInvalid'),
  title: z.string({ error: 'errors.nameInvalid' }).trim().min(2, 'errors.nameInvalid').max(200),
  subtitle: z.string().trim().max(300).optional(),
  company: z.string().trim().max(160).optional(),
  industry: z.string().trim().max(160).optional(),
  courseId: z.string().min(1, 'errors.courseRequired'),
  chapter: z.string().trim().max(160).optional(),
  description: z.string().trim().max(4000).optional(),
  language: localeSchema,
  learningObjectives: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  cloIds: z.array(z.string().trim().min(1).max(16)).max(20).default([]),
  mainQuestions: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  references: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
});
export type CreateCaseInput2 = z.input<typeof createCaseSchema>;

/**
 * Revising a case. The code, the course and the language are not here: a case
 * code identifies the case to a lecturer looking for it, and moving a case
 * between courses would move work already set under it.
 */
export const updateCaseSchema = z.object({
  title: z.string({ error: 'errors.nameInvalid' }).trim().min(2, 'errors.nameInvalid').max(200),
  subtitle: z.string().trim().max(300).optional(),
  company: z.string().trim().max(160).optional(),
  industry: z.string().trim().max(160).optional(),
  chapter: z.string().trim().max(160).optional(),
  description: z.string().trim().max(4000).optional(),
  learningObjectives: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  cloIds: z.array(z.string().trim().min(1).max(16)).max(20).default([]),
  mainQuestions: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  supportingQuestions: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  references: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  reason: z.string().trim().min(10, 'errors.reasonTooShort').max(500),
});
export type UpdateCaseRequest = z.infer<typeof updateCaseSchema>;

export const setCaseStatusSchema = z.object({
  status: z.enum(['draft', 'published', 'archived'], { error: 'errors.statusInvalid' }),
});
