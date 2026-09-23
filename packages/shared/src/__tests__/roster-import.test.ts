import { describe, expect, it } from 'vitest';
import { detectSeparator, parseStudentRoster, splitCsvLine } from '../index';

const header = 'studentId,fullName,email';

describe('splitCsvLine', () => {
  it('keeps a comma that sits inside a quoted field', () => {
    expect(splitCsvLine('SV001,"Nguyen Van A, Jr.",a@x.edu.vn', ',')).toEqual([
      'SV001',
      'Nguyen Van A, Jr.',
      'a@x.edu.vn',
    ]);
  });

  it('understands a doubled quote as one quote', () => {
    expect(splitCsvLine('SV001,"Nguyen ""Tuan"" A",a@x.edu.vn', ',')).toEqual([
      'SV001',
      'Nguyen "Tuan" A',
      'a@x.edu.vn',
    ]);
  });

  it('keeps empty fields in place', () => {
    expect(splitCsvLine('SV001,,a@x.edu.vn', ',')).toEqual(['SV001', '', 'a@x.edu.vn']);
  });
});

describe('detectSeparator', () => {
  it('finds the separator Excel actually used', () => {
    expect(detectSeparator('studentId,fullName,email')).toBe(',');
    // Excel in a Vietnamese locale writes semicolons.
    expect(detectSeparator('studentId;fullName;email')).toBe(';');
    expect(detectSeparator('studentId\tfullName\temail')).toBe('\t');
  });
});

describe('parseStudentRoster', () => {
  it('reads a plain list', () => {
    const result = parseStudentRoster(
      [
        header,
        'SV001,Nguyen Van A,sv001@university.edu.vn',
        'SV002,Tran Thi B,sv002@university.edu.vn',
      ].join('\n'),
    );

    expect(result.problems).toEqual([]);
    expect(result.rows.map((row) => row.student.studentId)).toEqual(['SV001', 'SV002']);
    expect(result.rows[0]?.line).toBe(2);
  });

  it('survives what Excel actually exports: a BOM, CRLF and semicolons', () => {
    const result = parseStudentRoster(
      '﻿Mã sinh viên;Họ và tên;Email\r\nSV001;Nguyen Van A;sv001@university.edu.vn\r\n',
    );

    expect(result.problems).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.student.fullName).toBe('Nguyen Van A');
  });

  it('accepts Vietnamese and English headers in any order', () => {
    const result = parseStudentRoster(
      ['Email,Họ tên,MSSV', 'sv001@university.edu.vn,Nguyen Van A,SV001'].join('\n'),
    );

    expect(result.problems).toEqual([]);
    expect(result.rows[0]?.student).toEqual({
      studentId: 'SV001',
      fullName: 'Nguyen Van A',
      email: 'sv001@university.edu.vn',
    });
  });

  it('ignores blank lines rather than reporting them as errors', () => {
    const result = parseStudentRoster(
      [header, '', 'SV001,Nguyen Van A,sv001@university.edu.vn', '', ''].join('\n'),
    );

    expect(result.problems).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it('reports a bad row with its line number and keeps the good ones', () => {
    const result = parseStudentRoster(
      [
        header,
        'SV001,Nguyen Van A,sv001@university.edu.vn',
        'SV002,Tran Thi B,not-an-email',
        'SV003,Le Van C,sv003@university.edu.vn',
      ].join('\n'),
    );

    expect(result.rows.map((row) => row.student.studentId)).toEqual(['SV001', 'SV003']);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.line).toBe(3);
    expect(result.problems[0]?.messageKey).toBe('errors.emailInvalid');
  });

  it('catches a student listed twice in the same file, naming the first line', () => {
    const result = parseStudentRoster(
      [
        header,
        'SV001,Nguyen Van A,sv001@university.edu.vn',
        'sv001,Nguyen Van A,another@university.edu.vn',
      ].join('\n'),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.problems[0]?.messageKey).toBe('errors.importDuplicateStudentId');
    expect(result.problems[0]?.value).toContain('2');
  });

  it('catches an email listed twice, which usually means a copy-paste slip', () => {
    const result = parseStudentRoster(
      [
        header,
        'SV001,Nguyen Van A,shared@university.edu.vn',
        'SV002,Tran Thi B,SHARED@university.edu.vn',
      ].join('\n'),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.problems[0]?.messageKey).toBe('errors.importDuplicateEmail');
  });

  it('refuses a file missing a required column, naming what is missing', () => {
    const result = parseStudentRoster(
      ['studentId,email', 'SV001,sv001@university.edu.vn'].join('\n'),
    );

    expect(result.rows).toEqual([]);
    expect(result.problems[0]?.messageKey).toBe('errors.importMissingColumns');
    expect(result.problems[0]?.value).toBe('fullName');
  });

  it('refuses an empty file and a header with no rows', () => {
    expect(parseStudentRoster('').problems[0]?.messageKey).toBe('errors.importEmptyFile');
    expect(parseStudentRoster('   \n  ').problems[0]?.messageKey).toBe('errors.importEmptyFile');
    expect(parseStudentRoster(header).problems[0]?.messageKey).toBe('errors.importNoRows');
  });

  it('reports every problem with an i18n key, so the lecturer reads it in their language', () => {
    const result = parseStudentRoster(
      [header, 'x,A,bad', ',,', 'SV001,Nguyen Van A,sv001@university.edu.vn'].join('\n'),
    );

    expect(result.problems.length).toBeGreaterThan(0);
    for (const problem of result.problems) {
      expect(problem.messageKey).toMatch(/^errors\./);
    }
  });

  it('does not let a student id smuggle a path separator into a document id', () => {
    const result = parseStudentRoster(
      [header, '../admin,Nguyen Van A,sv001@university.edu.vn'].join('\n'),
    );

    expect(result.rows).toEqual([]);
    expect(result.problems[0]?.messageKey).toBe('errors.studentIdInvalid');
  });
});
