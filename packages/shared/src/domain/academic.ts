import { z } from 'zod';
import { classCodeSchema, localeSchema } from './identity';
import { presentationRoleIdSchema } from './roles';

/** University -> Academic year -> Semester -> Course -> Class (SRS 3.2). */

export const academicYearSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(32),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  status: z.enum(['active', 'archived']),
});
export type AcademicYear = z.infer<typeof academicYearSchema>;

export const semesterSchema = z.object({
  id: z.string().min(1),
  academicYearId: z.string().min(1),
  name: z.string().trim().min(1).max(32),
  status: z.enum(['planned', 'active', 'closed']),
});
export type Semester = z.infer<typeof semesterSchema>;

export const courseSchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional(),
  /** Course Learning Outcomes the rubric criteria may be mapped to. */
  cloIds: z.array(z.string().min(1)).default([]),
  defaultLanguage: localeSchema,
  status: z.enum(['draft', 'active', 'archived']),
});
export type Course = z.infer<typeof courseSchema>;

export const classSchema = z.object({
  id: z.string().min(1),
  classCode: classCodeSchema,
  className: z.string().trim().min(1).max(160),
  courseId: z.string().min(1),
  semesterId: z.string().min(1),
  lecturerIds: z.array(z.string().min(1)).min(1),
  language: localeSchema,
  expectedStudents: z.number().int().positive().max(1000).optional(),
  /** Policy version governing this class. */
  presentationPolicyId: z.string().min(1),
  presentationPolicyVersion: z.string().min(1),
  joinMode: z.enum(['code', 'approval', 'closed']),
  status: z.enum(['draft', 'active', 'archived']),
});
export type Class = z.infer<typeof classSchema>;

export const ENROLLMENT_STATUSES = ['active', 'pending', 'removed'] as const;
export const enrollmentStatusSchema = z.enum(ENROLLMENT_STATUSES);
export type EnrollmentStatus = z.infer<typeof enrollmentStatusSchema>;

/**
 * One student in one class. Kept as its own document rather than an array on
 * the class: a class holds sixty students, and a student belongs to several
 * classes with separate results in each (SRS 1.2).
 */
export const classEnrollmentSchema = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  /** The student code is the key: one row per student per class. */
  studentId: z.string().min(1),
  /**
   * Empty while the row comes from an imported list and the student has not
   * signed up yet. An imported row and the student's own join therefore meet
   * in one document instead of becoming two competing records.
   */
  studentUid: z.string().min(1).optional(),
  fullName: z.string().min(1),
  email: z.email(),
  /** `pending` = on the faculty list, not signed in yet. */
  status: enrollmentStatusSchema,
  joinedVia: z.enum(['class_code', 'lecturer_added', 'import']),
  removedReason: z.string().max(500).optional(),
});
export type ClassEnrollment = z.infer<typeof classEnrollmentSchema>;

export const GROUP_FORMATION_MODES = [
  'lecturer_assignment',
  'student_self_join',
  'random',
] as const;
export const groupFormationModeSchema = z.enum(GROUP_FORMATION_MODES);
export type GroupFormationMode = z.infer<typeof groupFormationModeSchema>;

/**
 * One student in one group. The document id is `classId__studentUid`, which is
 * what enforces the rule that a student belongs to at most one group per class
 * (SRS 7.2): two simultaneous joins cannot both create it.
 */
export const groupMemberSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  classId: z.string().min(1),
  studentUid: z.string().min(1),
  studentId: z.string().min(1),
  fullName: z.string().min(1),
  /** Presentation roles this member owns; a small group may own two. */
  roleIds: z.array(presentationRoleIdSchema).default([]),
  isLeader: z.boolean().default(false),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const groupSchema = z.object({
  id: z.string().min(1),
  groupCode: z.string().trim().min(1).max(16),
  groupName: z.string().trim().min(1).max(120),
  classId: z.string().min(1),
  maxMembers: z.number().int().positive(),
  memberCount: z.number().int().nonnegative(),
  leaderId: z.string().min(1).optional(),
  formationMode: groupFormationModeSchema,
  /** A locked group may only be changed by a lecturer (SRS 7.2). */
  locked: z.boolean(),
  status: z.enum(['forming', 'active', 'archived']),
});
export type Group = z.infer<typeof groupSchema>;
