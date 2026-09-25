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
export * from './academic/access';
export * from './groups/groups';
export * from './case-selection/case-selection';
export * from './cases/cases';
export * from './assignments/assignments';
export * from './submissions/submissions';
export * from './sessions/sessions';
export * from './questions/questions';
export * from './peer-reviews/peer-reviews';
export * from './grading/assessments';
export * from './ai/provider';
export * from './ai/vertex';
export * from './ai/evaluation';
export * from './ai/answers';
export * from './ai/tutor';
export * from './dashboard/dashboard';
export * from './dossier/dossier';
export * from './ai/diagnostics';
export * from './settings/settings';
export * from './notifications/notifications';
export * from './policy/policy-store';
export * from './analytics/reports';

// Next.js-specific entry points are NOT re-exported here: `auth/session` and
// `auth/authorize` import `next/headers`, which only resolves inside the web
// app. Import them by path instead:
//   import { getSessionUser } from '@casestudyhub/core/auth/session';
