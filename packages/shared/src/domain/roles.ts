import { z } from 'zod';

/**
 * The six presentation roles of the Case Study Presentation Guide.
 * Order matters: it is the chain of reasoning the presentation must follow.
 * Context -> Mechanism -> Numbers -> Critique -> Transfer -> Decision
 */
export const PRESENTATION_ROLE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] as const;

export const presentationRoleIdSchema = z.enum(PRESENTATION_ROLE_IDS);
export type PresentationRoleId = z.infer<typeof presentationRoleIdSchema>;

export const presentationRoleSchema = z.object({
  id: presentationRoleIdSchema,
  /** Short key used by the i18n layer, e.g. `roles.R1.title`. */
  key: z.string().min(1),
  order: z.number().int().min(1),
  /** Suggested speaking time in minutes (Guide, Table 2). */
  minutes: z.number().int().min(1),
  /**
   * Roles the Guide forbids dropping when a team is smaller than six.
   * R3 (Data) and R4 (Critique) measure analytical and critical capability.
   */
  mandatory: z.boolean(),
});
export type PresentationRole = z.infer<typeof presentationRoleSchema>;

export const DEFAULT_PRESENTATION_ROLES: readonly PresentationRole[] = [
  { id: 'R1', key: 'contextSetter', order: 1, minutes: 3, mandatory: true },
  { id: 'R2', key: 'modelAnalyst', order: 2, minutes: 4, mandatory: true },
  { id: 'R3', key: 'dataAnalyst', order: 3, minutes: 4, mandatory: true },
  { id: 'R4', key: 'critic', order: 4, minutes: 3, mandatory: true },
  { id: 'R5', key: 'transferLead', order: 5, minutes: 3, mandatory: false },
  { id: 'R6', key: 'decisionLead', order: 6, minutes: 3, mandatory: false },
] as const;

/**
 * Role merging by team size (Guide, Table 3).
 * Each entry maps a role to the 1-based index of the member who owns it.
 * A member index appearing twice means that member carries two roles.
 */
export const ROLE_ALLOCATION_BY_TEAM_SIZE: Readonly<
  Record<4 | 5 | 6, Readonly<Record<PresentationRoleId, number>>>
> = {
  6: { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 },
  5: { R1: 1, R2: 2, R3: 3, R4: 4, R5: 1, R6: 5 },
  4: { R1: 1, R2: 2, R3: 3, R4: 4, R5: 1, R6: 4 },
} as const;
