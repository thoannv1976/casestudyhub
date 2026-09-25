import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESENTATION_POLICY, hostOfLink, validateLink } from '../index';

/**
 * A deliverable satisfied by a link rather than a file.
 *
 * A presentation video is recorded on a phone and put on YouTube; asking a
 * group to push a gigabyte through this platform as well would be asking them
 * to do the same work twice. What has to hold is that the link is one a
 * browser can open safely, and that a reader sees where it goes first.
 */

const LINK_ONLY = ['LINK'] as const;
const FILE_ONLY = ['PDF'] as const;

describe('the host a reader is shown', () => {
  it('is the domain, without the www nobody reads', () => {
    expect(hostOfLink('https://www.youtube.com/watch?v=abc')).toBe('youtube.com');
    expect(hostOfLink('https://drive.google.com/file/d/xyz/view')).toBe('drive.google.com');
  });

  it('refuses anything a browser should not be sent to', () => {
    expect(hostOfLink('http://youtube.com/watch')).toBeNull();
    expect(hostOfLink('file:///etc/passwd')).toBeNull();
    expect(hostOfLink('javascript:alert(1)')).toBeNull();
    expect(hostOfLink('youtube.com/watch')).toBeNull();
    expect(hostOfLink('')).toBeNull();
  });
});

describe('submitting a link', () => {
  it('accepts any https address, whatever the faculty uses', () => {
    // Restricting to a list of hosts would block a faculty that uses
    // something this project never heard of, without making anything safer.
    for (const url of [
      'https://www.youtube.com/watch?v=abc',
      'https://vimeo.com/123456',
      'https://drive.google.com/file/d/xyz/view',
      'https://video.ftu.edu.vn/2026/nhom1',
    ]) {
      expect(validateLink(url, LINK_ONLY)).toBeNull();
    }
  });

  it('refuses an address that is not https', () => {
    expect(validateLink('http://youtube.com/watch', LINK_ONLY)?.messageKey).toBe(
      'errors.linkNotHttps',
    );
    expect(validateLink('youtube.com', LINK_ONLY)?.messageKey).toBe('errors.linkNotHttps');
  });

  it('refuses a link for a deliverable that is meant to be a file', () => {
    expect(validateLink('https://youtube.com/watch', FILE_ONLY)?.messageKey).toBe(
      'errors.deliverableIsNotALink',
    );
  });

  it('refuses an address too long to be one', () => {
    const long = `https://example.com/${'a'.repeat(2100)}`;
    expect(validateLink(long, LINK_ONLY)?.messageKey).toBe('errors.linkTooLong');
  });
});

describe('the framework as shipped', () => {
  it('asks for a presentation video as a link, and does not require it', () => {
    const video = DEFAULT_PRESENTATION_POLICY.deliverables.find(
      (item) => item.id === 'presentation-video',
    );

    expect(video?.formats).toEqual(['LINK']);
    // Not every course records. A required deliverable nobody can produce
    // would show every group as behind for ever.
    expect(video?.required).toBe(false);
  });

  it('still asks for the slides and the report as files', () => {
    const byId = new Map(DEFAULT_PRESENTATION_POLICY.deliverables.map((item) => [item.id, item]));
    expect(byId.get('slides-pdf')?.formats).toEqual(['PDF']);
    expect(byId.get('case-analysis-report')?.formats).toContain('DOCX');
  });
});
