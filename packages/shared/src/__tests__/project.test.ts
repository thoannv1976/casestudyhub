import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_POLICY,
  DEFAULT_PROJECT_DELIVERABLES,
  parseProjectTargetId,
  parsePresentationPolicy,
  projectTargetId,
} from '../index';

/**
 * The class group project, as data.
 *
 * Two things are load-bearing here. The target id, because it is what keeps
 * one group's submissions apart from another's without a stored row per group.
 * And the defaulted deliverable list, because a framework version written
 * before the project existed has to keep working - and has to ask for the
 * three things the course guide asks for.
 */

describe('what a group hands project work in against', () => {
  it('round-trips the class and the group', () => {
    const id = projectTargetId('CLASS1', 'GROUP7');
    expect(parseProjectTargetId(id)).toEqual({ classId: 'CLASS1', groupId: 'GROUP7' });
  });

  it('keeps two groups of one class apart', () => {
    // This is the whole reason the id carries both: the version counter and
    // every submission query work per target id.
    expect(projectTargetId('CLASS1', 'GROUP7')).not.toBe(projectTargetId('CLASS1', 'GROUP8'));
  });

  it('does not mistake an assignment id for a project', () => {
    // Firestore's own ids have no underscores, but an id typed by hand might.
    expect(parseProjectTargetId('N0ZKaOEPpGUeQ6mSVq1x')).toBeNull();
    expect(parseProjectTargetId('CLASS1__GROUP7')).toBeNull();
    expect(parseProjectTargetId('CLASS1__GROUP7__projects')).toBeNull();
    expect(parseProjectTargetId('CLASS1__GROUP7__project__extra')).toBeNull();
    expect(parseProjectTargetId('__GROUP7__project')).toBeNull();
  });
});

describe('what the course guide asks a group to hand in', () => {
  const byId = new Map(DEFAULT_PROJECT_DELIVERABLES.map((item) => [item.id, item]));

  it('is a deck, a report and a video link - all three required', () => {
    expect([...byId.keys()]).toEqual(['project-pitch-deck', 'project-report', 'project-video']);
    expect(DEFAULT_PROJECT_DELIVERABLES.every((item) => item.required)).toBe(true);
  });

  it('takes the deck as a PDF or the PowerPoint file itself', () => {
    expect(byId.get('project-pitch-deck')?.formats).toEqual(['PDF', 'PPTX']);
  });

  it('takes the video as a link and never as an upload', () => {
    // A 3-5 minute video is already on YouTube. Asking a group to push it
    // through this platform as well is asking for the same work twice.
    expect(byId.get('project-video')?.formats).toEqual(['LINK']);
    expect(byId.get('project-video')?.maxFileSizeMb).toBe(0);
  });

  it('is not the case study checklist', () => {
    // Different work, different deadline. Sharing a list would make a group
    // that handed in its case study slides look as if it had started the
    // project.
    const caseStudy = DEFAULT_PRESENTATION_POLICY.deliverables.map((item) => item.id);
    for (const item of DEFAULT_PROJECT_DELIVERABLES) {
      expect(caseStudy).not.toContain(item.id);
    }
  });
});

describe('a framework version stored before the project existed', () => {
  it('still parses, and still asks for the three deliverables', () => {
    const { projectDeliverables: _dropped, ...older } = DEFAULT_PRESENTATION_POLICY;
    const parsed = parsePresentationPolicy(older);

    expect(parsed.projectDeliverables.map((item) => item.id)).toEqual([
      'project-pitch-deck',
      'project-report',
      'project-video',
    ]);
  });

  it('keeps a version that names its own list', () => {
    const custom = {
      ...DEFAULT_PRESENTATION_POLICY,
      projectDeliverables: [
        {
          id: 'only-report',
          key: 'deliverables.projectReport',
          formats: ['PDF'],
          required: true,
          maxFileSizeMb: 10,
        },
      ],
    };
    expect(parsePresentationPolicy(custom).projectDeliverables).toHaveLength(1);
  });
});
