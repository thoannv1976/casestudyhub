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
  caseClaims: 'caseClaims',
  /**
   * The assessment framework, versioned and immutable. `presentationGuides`
   * and `rubrics` were declared beside this and never written to: the guide's
   * rules and the rubric both live inside a policy version, and a second home
   * for either would be a source of truth nothing freezes.
   */
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
  // `cloMappings` was declared here too. The mapping from a rubric criterion
  // to a learning outcome lives on the criterion, inside the framework, so it
  // is frozen with everything else a mark was computed from.
  notifications: 'notifications',
  auditLogs: 'auditLogs',
  aiUsage: 'aiUsage',
  systemSettings: 'systemSettings',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
