// Modules that work anywhere: server, worker and scripts.
export * from './env';
export * from './errors';
export * from './firebase/admin';
export * from './audit/audit-log';
export * from './auth/types';
export * from './auth/tokens';
export * from './users/registration';
export * from './users/profile';
export * from './users/staff';
export * from './academic/structure';
export * from './academic/enrollment';
export * from './academic/rate-limit';
export * from './groups/groups';

// Next.js-specific entry points are NOT re-exported here: `auth/session` and
// `auth/authorize` import `next/headers`, which only resolves inside the web
// app. Import them by path instead:
//   import { getSessionUser } from '@casestudyhub/core/auth/session';
