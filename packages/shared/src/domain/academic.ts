import { z } from 'zod';
import { classCodeSchema, localeSchema } from './identity';

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

export const GROUP_FORMATION_MODES = [
  'lecturer_assignment',
  'student_self_join',
  'random',
] as const;
export const groupFormationModeSchema = z.enum(GROUP_FORMATION_MODES);
export type GroupFormationMode = z.infer<typeof groupFormationModeSchema>;

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
