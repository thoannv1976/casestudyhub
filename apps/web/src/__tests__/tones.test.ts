import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROGRESS_STATES, PROGRESS_TONE } from '@casestudyhub/shared';

/**
 * The colours that carry meaning, checked rather than asserted.
 *
 * Four states used to be drawn identically, so a lecturer scanning the class
 * overview had to read every word to find the rows in trouble. Giving each one
 * a colour only helps if the colour can be read, and "it looks fine to me" is
 * not a measurement - so the pairs are pulled out of the stylesheet and put
 * through the WCAG contrast formula here.
 */

const CSS = readFileSync(join(import.meta.dirname, '../app/globals.css'), 'utf8');

const TONES = ['success', 'warning', 'danger', 'info'] as const;

/** The value of one custom property, inside the block that `anchor` opens. */
function token(anchor: string, name: string): string {
  const block = CSS.slice(CSS.indexOf(anchor));
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  if (!match?.[1]) throw new Error(`no --${name} after ${anchor}`);
  return match[1];
}

function channel(value: number): number {
  const ratio = value / 255;
  return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

/** WCAG 2.2 contrast ratio, from 1 (identical) to 21 (black on white). */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe('the colours a state is read by', () => {
  it('gives every state a tone, so none comes out grey by accident', () => {
    for (const state of PROGRESS_STATES) {
      expect(PROGRESS_TONE[state], `no tone for "${state}"`).toBeTruthy();
    }
    expect(Object.keys(PROGRESS_TONE).sort()).toEqual([...PROGRESS_STATES].sort());
  });

  it('never gives two neighbouring states the same tone', () => {
    // If everything in trouble and everything finished read the same, the
    // colour has bought nothing. These three are the ones a lecturer sorts by.
    expect(PROGRESS_TONE.overdue).not.toBe(PROGRESS_TONE.published);
    expect(PROGRESS_TONE.awaiting).not.toBe(PROGRESS_TONE.overdue);
    expect(PROGRESS_TONE.published).not.toBe(PROGRESS_TONE.marked);
  });

  it('is readable in the light theme', () => {
    for (const tone of TONES) {
      const ratio = contrast(
        token(':root {', `tone-${tone}-bg`),
        token(':root {', `tone-${tone}-fg`),
      );
      expect(ratio, `${tone} is ${ratio.toFixed(2)}:1 in the light theme`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('is readable in the dark theme, where the pair is inverted', () => {
    for (const tone of TONES) {
      const ratio = contrast(
        token(":root[data-theme='dark']", `tone-${tone}-bg`),
        token(":root[data-theme='dark']", `tone-${tone}-fg`),
      );
      expect(ratio, `${tone} is ${ratio.toFixed(2)}:1 in the dark theme`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('keeps body text readable on the tinted page background', () => {
    // The page stopped being pure white, so this is the pair that changed.
    expect(
      contrast(token(':root {', 'surface'), token(':root {', 'text-body')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(token(':root {', 'surface'), token(':root {', 'text-muted')),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
