import { z } from 'zod';

/** Platform-wide role. Class-level capabilities are checked separately. */
export const USER_ROLES = ['admin', 'lecturer', 'student'] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

export const USER_STATUSES = ['active', 'suspended', 'pending'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

/** Supported interface languages. Document language is tracked separately. */
export const LOCALES = ['vi', 'en'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;
export const DEFAULT_LOCALE: Locale = 'vi';

/**
 * Business identifier of a student, unique across the platform.
 * The Firebase UID stays the authentication identifier (SRS 19).
 */
export const studentIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, 'Student ID may contain letters, digits, dot, underscore and hyphen');

export const classCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .regex(/^[A-Z0-9-]+$/, 'Class code may contain upper-case letters, digits and hyphen');

export const userProfileSchema = z.object({
  uid: z.string().min(1),
  email: z.email(),
  fullName: z.string().trim().min(1).max(120),
  studentId: studentIdSchema.optional(),
  globalRole: userRoleSchema,
  preferredLanguage: localeSchema,
  status: userStatusSchema,
  photoUrl: z.url().optional(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/** Capabilities checked on the server and mirrored in Firestore rules. */
export const PERMISSIONS = [
  'user.manage',
  'course.create',
  'class.create',
  'class.manage',
  'group.create',
  'group.join',
  'case.upload',
  'case.publish',
  'assignment.manage',
  'submission.create',
  'question.ask',
  'presentation.control',
  'peerReview.submit',
  'grade.draft',
  'grade.publish',
  'grade.viewClass',
  'grade.viewPlatform',
  'ai.configure',
  'system.configure',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permission matrix of SRS Module 02. */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  admin: [
    'user.manage',
    'course.create',
    'class.create',
    'class.manage',
    'group.create',
    'case.upload',
    'case.publish',
    'assignment.manage',
    'question.ask',
    'grade.viewClass',
    'grade.viewPlatform',
    'ai.configure',
    'system.configure',
    'audit.read',
  ],
  lecturer: [
    'class.create',
    'class.manage',
    'group.create',
    'case.upload',
    'case.publish',
    'assignment.manage',
    'question.ask',
    'presentation.control',
    'grade.draft',
    'grade.publish',
    'grade.viewClass',
  ],
  student: ['group.join', 'submission.create', 'question.ask', 'peerReview.submit'],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
