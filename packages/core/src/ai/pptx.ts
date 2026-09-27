import { unzipSync } from 'fflate';

/**
 * Reading the words out of a PowerPoint deck, slide by slide.
 *
 * The platform used to skip Office formats outright, with a reason worth
 * keeping in mind: a deck read badly produces citations pointing at slides
 * that do not say what the citation claims, which is worse than no citation at
 * all. This does not read a deck "badly" in that sense - a `.pptx` is a zip,
 * and each slide is its own XML part named `ppt/slides/slide7.xml`, so the
 * slide a quote came from is known exactly rather than guessed.
 *
 * What is genuinely lost is everything that is not text: charts, screenshots,
 * numbers living inside a picture. That shows up as a gap in the model's
 * answer rather than as a wrong citation, and the interface says which sources
 * were read in full and which as text only. A group that hands in a PDF gets
 * the better reading, and the submission screen says so.
 */

export interface SlideText {
  slide: number;
  text: string;
}

/** `ppt/slides/slide12.xml` → 12. Anything else is not a slide. */
function slideNumberOf(path: string): number | null {
  const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/**
 * The visible words of one slide, in reading order.
 *
 * `<a:t>` holds every run of text a viewer sees - titles, bullets, table
 * cells, text inside shapes. Paragraph and line breaks become newlines so a
 * bullet list stays a list rather than collapsing into one sentence.
 */
export function slideTextOf(xml: string): string {
  const withBreaks = xml
    .replace(/<a:br\s*\/>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<\/a:tr>/g, '\n');

  const runs = [...withBreaks.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]);
  if (runs.length === 0) return '';

  // Reassembled from the runs, with the newlines the replacements above left
  // between them: a paragraph split across three runs is one line, not three.
  const text = withBreaks
    .replace(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g, (_full, run: string) => `\u0000${run}\u0000`)
    .replace(/<[^>]+>/g, '')
    .split('\u0000')
    .map((piece, index) => (index % 2 === 1 ? piece : piece.replace(/[^\n]/g, '')))
    .join('');

  return text
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_full, code: string) => String.fromCodePoint(Number(code)))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Every slide of a deck that has any words on it, in order.
 *
 * Returns nothing for a file that is not a readable deck rather than throwing:
 * a lecturer's marking screen should say "this one could not be read", not
 * fail.
 */
export function slidesOfPptx(file: Uint8Array): SlideText[] {
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(file, {
      filter: (entry) => slideNumberOf(entry.name) !== null,
    });
  } catch {
    return [];
  }

  const decoder = new TextDecoder();
  const slides: SlideText[] = [];

  for (const [path, bytes] of Object.entries(parts)) {
    const slide = slideNumberOf(path);
    if (slide === null) continue;
    const text = slideTextOf(decoder.decode(bytes));
    if (text.length > 0) slides.push({ slide, text });
  }

  return slides.sort((a, b) => a.slide - b.slide);
}

/** The deck as one labelled document, which is what a model is handed. */
export function pptxAsText(file: Uint8Array): string {
  return slidesOfPptx(file)
    .map((slide) => `--- slide ${slide.slide} ---\n${slide.text}`)
    .join('\n\n');
}
