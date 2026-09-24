import { z } from 'zod';
import { presentationRoleIdSchema } from '../domain/roles';
import { groupFormationModeSchema } from '../domain/academic';

/** Request contracts for group formation and role allocation (SRS Module 07). */

export const createGroupsSchema = z
  .object({
    /** How many groups to create at once, named G01, G02, ... */
    count: z.number().int().min(1, 'errors.groupCountInvalid').max(50, 'errors.groupCountInvalid'),
    maxMembers: z
      .number()
      .int()
      .min(2, 'errors.maxMembersInvalid')
      .max(12, 'errors.maxMembersInvalid'),
    formationMode: groupFormationModeSchema,
  })
  .refine((data) => data.count * data.maxMembers >= 1, { message: 'errors.groupCountInvalid' });
export type CreateGroupsRequest = z.infer<typeof createGroupsSchema>;

export const joinGroupSchema = z.object({
  groupId: z.string().min(1),
});

export const assignMemberSchema = z.object({
  groupId: z.string().min(1),
  studentUid: z.string().min(1),
});

export const setRolesSchema = z.object({
  /** Empty clears the allocation and lets the lecturer start again. */
  assignments: z
    .array(
      z.object({
        studentUid: z.string().min(1),
        roleIds: z.array(presentationRoleIdSchema).max(6),
      }),
    )
    .max(12),
});
export type SetRolesRequest = z.infer<typeof setRolesSchema>;

export const lockGroupSchema = z.object({
  locked: z.boolean(),
});
