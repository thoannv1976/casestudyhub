import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { pptxAsText, slideTextOf, slidesOfPptx } from '../ai/pptx';

/**
 * Reading a PowerPoint deck.
 *
 * The rule that matters is that a citation naming slide nine is naming slide
 * nine. The platform used to refuse Office files outright because a deck read
 * badly points at slides that do not say what the citation claims - so these
 * tests are mostly about the slide numbers being real, not about the prose.
 */

function slideXml(paragraphs: readonly string[][]): string {
  const body = paragraphs
    .map(
      (runs) =>
        `<a:p>${runs.map((run) => `<a:r><a:rPr lang="en"/><a:t>${run}</a:t></a:r>`).join('')}</a:p>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="x" xmlns:p="y"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

function deck(slides: Record<number, readonly string[][]>): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types/>'),
    'ppt/presentation.xml': strToU8('<p:presentation/>'),
  };
  for (const [number, paragraphs] of Object.entries(slides)) {
    files[`ppt/slides/slide${number}.xml`] = strToU8(slideXml(paragraphs));
  }
  return zipSync(files);
}

describe('the words of one slide', () => {
  it('keeps a paragraph split across runs as one line', () => {
    // PowerPoint splits a sentence into runs wherever formatting changes; three
    // runs of one sentence are one sentence, not three bullets.
    const xml = slideXml([['Revenue is ', 'Traffic', ' x Conversion x AOV']]);
    expect(slideTextOf(xml)).toBe('Revenue is Traffic x Conversion x AOV');
  });

  it('keeps separate paragraphs on separate lines', () => {
    expect(slideTextOf(slideXml([['Problem'], ['Customer'], ['Solution']]))).toBe(
      'Problem\nCustomer\nSolution',
    );
  });

  it('turns XML entities back into the characters a reader saw', () => {
    expect(slideTextOf(slideXml([['CAC &lt; CLV &amp; margin &gt; 30%']]))).toBe(
      'CAC < CLV & margin > 30%',
    );
  });

  it('is empty for a slide with only a picture on it', () => {
    expect(slideTextOf('<p:sld><p:pic/></p:sld>')).toBe('');
  });
});

describe('a deck', () => {
  it('numbers slides from the file itself, in order', () => {
    // Zip entries come back in whatever order the writer used, and slide10
    // sorts before slide2 as a string.
    const slides = slidesOfPptx(deck({ 2: [['Two']], 10: [['Ten']], 1: [['One']] }));
    expect(slides.map((slide) => slide.slide)).toEqual([1, 2, 10]);
    expect(slides.map((slide) => slide.text)).toEqual(['One', 'Two', 'Ten']);
  });

  it('labels each slide so a citation can name it', () => {
    const text = pptxAsText(deck({ 1: [['Cover']], 9: [['KPI table']] }));
    expect(text).toContain('--- slide 1 ---\nCover');
    expect(text).toContain('--- slide 9 ---\nKPI table');
  });

  it('leaves out a slide with no words rather than leaving a gap in the numbering', () => {
    const slides = slidesOfPptx(deck({ 1: [['Cover']], 2: [[]], 3: [['Numbers']] }));
    expect(slides.map((slide) => slide.slide)).toEqual([1, 3]);
  });

  it('reads nothing from a file that is not a deck, instead of throwing', () => {
    // The marking screen should say "this one could not be read", not fail.
    expect(slidesOfPptx(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toEqual([]);
    expect(pptxAsText(new Uint8Array([]))).toBe('');
  });

  it('ignores parts of the file that are not slides', () => {
    const files = {
      'ppt/slides/slide1.xml': strToU8(slideXml([['Real slide']])),
      'ppt/notesSlides/notesSlide1.xml': strToU8(slideXml([['Speaker note']])),
      'ppt/slideLayouts/slideLayout1.xml': strToU8(slideXml([['Click to edit']])),
    };
    const slides = slidesOfPptx(zipSync(files));
    expect(slides).toHaveLength(1);
    expect(slides[0]?.text).toBe('Real slide');
  });
});
