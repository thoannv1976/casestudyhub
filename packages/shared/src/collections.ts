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
  /** One group project per class, so the class id is the document id. */
  classProjects: 'classProjects',
  /** Groups that put their hand up to present the class project. */
  projectVolunteers: 'projectVolunteers',
  submissions: 'submissions',
  presentationSessions: 'presentationSessions',
  questions: 'questions',
  questionVotes: 'questionVotes',
  /** The model's grouping of one presentation's questions into themes. */
  questionClusters: 'questionClusters',
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
  // The Moodle connection through UniGame Hub (LTI 1.3). Server-only: rules
  // deny every client read and write. See packages/core/src/lti.
  /** One per Moodle user, id = Hub user id: which account they are here. */
  ltiUsers: 'ltiUsers',
  /** One per Moodle course, id = context key: which class it is. */
  ltiContexts: 'ltiContexts',
  /** A lecturer opened a course that is not linked yet. id = context key. */
  ltiPending: 'ltiPending',
  /** One per Moodle activity, id = resource key: its class, kind and gradebook column. */
  ltiActivities: 'ltiActivities',
  /** Where one student's mark goes for one activity. id = `${uid}__${resourceKey}`. */
  ltiGradeTargets: 'ltiGradeTargets',
  /** Launch tickets already used (replay protection), id = ticket id. */
  ltiUsedTickets: 'ltiUsedTickets',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
