/**
 * Firestore collection names (SRS Part XI). Kept in one place so security
 * rules, indexes and server code cannot drift apart.
 */
export const COLLECTIONS = {
  users: 'users',
  studentIdIndex: 'studentIdIndex',
  academicYears: 'academicYears',
  semesters: 'semesters',
  courses: 'courses',
  classes: 'classes',
  classEnrollments: 'classEnrollments',
  groups: 'groups',
  groupMembers: 'groupMembers',
  caseStudies: 'caseStudies',
  caseVersions: 'caseVersions',
  presentationGuides: 'presentationGuides',
  rubrics: 'rubrics',
  policies: 'policies',
  assignments: 'assignments',
  submissions: 'submissions',
  presentationSessions: 'presentationSessions',
  questions: 'questions',
  questionVotes: 'questionVotes',
  questionResponses: 'questionResponses',
  peerReviews: 'peerReviews',
  aiAssessments: 'aiAssessments',
  aiTutorSessions: 'aiTutorSessions',
  lecturerAssessments: 'lecturerAssessments',
  grades: 'grades',
  cloMappings: 'cloMappings',
  notifications: 'notifications',
  auditLogs: 'auditLogs',
  systemSettings: 'systemSettings',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
