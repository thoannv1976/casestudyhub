import { z } from 'zod';
import { localeSchema, studentIdSchema } from '../domain/identity';

/**
 * Request contracts for the authentication endpoints. Shared so the form, the
 * route handler and the tests all validate against exactly the same rules.
 */

export const passwordSchema = z
  .string({ error: 'errors.passwordTooShort' })
  .min(8, 'errors.passwordTooShort')
  .max(128, 'errors.passwordTooLong')
  .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), 'errors.passwordTooSimple');

export const registerRequestSchema = z
  .object({
    studentId: studentIdSchema,
    fullName: z
      .string({ error: 'errors.fullNameInvalid' })
      .trim()
      .min(2, 'errors.fullNameInvalid')
      .max(120, 'errors.fullNameInvalid'),
    email: z.email({ error: 'errors.emailInvalid' }),
    password: passwordSchema,
    confirmPassword: z.string({ error: 'errors.passwordMismatch' }),
    preferredLanguage: localeSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'errors.passwordMismatch',
    path: ['confirmPassword'],
  });
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const sessionRequestSchema = z.object({
  idToken: z.string({ error: 'errors.unexpected' }).min(1, 'errors.unexpected'),
});
export type SessionRequest = z.infer<typeof sessionRequestSchema>;

export const profileUpdateSchema = z
  .object({
    fullName: z
      .string({ error: 'errors.fullNameInvalid' })
      .trim()
      .min(2, 'errors.fullNameInvalid')
      .max(120, 'errors.fullNameInvalid')
      .optional(),
    preferredLanguage: localeSchema.optional(),
  })
  .refine((data) => data.fullName !== undefined || data.preferredLanguage !== undefined, {
    message: 'errors.nothingToUpdate',
  });
export type ProfileUpdateRequest = z.infer<typeof profileUpdateSchema>;
