import { describe, expect, it } from 'vitest';
import { nextCaseCodes, studentMayReadCase, titleFromFileName } from '../index';

describe('codes for a batch of new cases', () => {
  it('numbers on from the highest code already using the prefix', () => {
    expect(nextCaseCodes('CASE', ['CASE01', 'CASE27', 'CASE09'], 3)).toEqual([
      'CASE28',
      'CASE29',
      'CASE30',
    ]);
  });

  it('starts at 01 for a prefix nobody uses yet, and ignores other prefixes', () => {
    expect(nextCaseCodes('MKT', ['CASE27'], 2)).toEqual(['MKT01', 'MKT02']);
  });

  it('keeps a wider numbering where the library already has one', () => {
    expect(nextCaseCodes('C', ['C007'], 1)).toEqual(['C008']);
  });

  it('cleans the prefix to what a case code may contain', () => {
    expect(nextCaseCodes(' ca se!', [], 1)).toEqual(['CASE01']);
    expect(nextCaseCodes('', [], 1)).toEqual(['CASE01']);
  });
});

describe('a title from a file name', () => {
  it('turns the separators of a file name into spaces', () => {
    expect(titleFromFileName('G1-Case-07---Shein-EN-.pdf')).toBe('G1 Case 07 Shein EN');
    expect(titleFromFileName('booking_com.case.docx')).toBe('booking com case');
  });

  it('is never too short to be a valid title', () => {
    expect(titleFromFileName('a.pdf').length).toBeGreaterThanOrEqual(2);
  });
});

describe('an archived case', () => {
  const archived = { id: 'old', courseId: 'aug', status: 'archived' as const };

  it('stays readable for the group working on it', () => {
    expect(studentMayReadCase(archived, [], new Set(['old']))).toBe(true);
  });

  it('is offered to nobody new, even a class whose set still lists it', () => {
    expect(
      studentMayReadCase(archived, [{ courseId: 'aug', caseSetIds: ['old'] }], new Set()),
    ).toBe(false);
  });
});
