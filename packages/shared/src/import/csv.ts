import { importedStudentSchema, type ImportedStudent } from '../api/academic';

/**
 * Student roster import (SRS 3.1).
 *
 * A faculty list arrives as a spreadsheet exported to CSV, written by a person,
 * so the parser tolerates what people actually produce: quoted fields with
 * commas inside, a UTF-8 BOM from Excel, CRLF line endings, semicolon
 * separators from a Vietnamese locale Excel, blank lines, and headers in either
 * language. What it does not do is guess at a row it cannot read - every bad
 * row is reported with its line number so the lecturer can fix the file.
 */

export interface RosterRow {
  /** 1-based line in the uploaded file, as the user sees it in Excel. */
  line: number;
  student: ImportedStudent;
}

export interface RosterProblem {
  line: number;
  /** i18n key, so the message shows in the reader's language. */
  messageKey: string;
  /** The offending value, echoed back to help find it in the file. */
  value?: string;
}

export interface RosterParseResult {
  rows: RosterRow[];
  problems: RosterProblem[];
}

/** Splits one CSV line, honouring quoted fields and doubled quotes. */
export function splitCsvLine(line: string, separator: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === separator) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

/** Excel in a Vietnamese locale writes semicolons; detect rather than assume. */
export function detectSeparator(headerLine: string): string {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = splitCsvLine(headerLine, candidate).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

const HEADER_ALIASES: Record<'studentId' | 'fullName' | 'email', string[]> = {
  studentId: ['studentid', 'student id', 'mssv', 'ma sinh vien', 'mã sinh viên', 'masv', 'id'],
  fullName: ['fullname', 'full name', 'name', 'ho ten', 'họ tên', 'ho va ten', 'họ và tên'],
  email: ['email', 'e-mail', 'thu dien tu', 'thư điện tử'],
};

function normaliseHeader(value: string): string {
  return value.replace(/^﻿/, '').trim().toLowerCase();
}

function matchHeader(value: string): keyof typeof HEADER_ALIASES | null {
  const normalised = normaliseHeader(value);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalised)) return field as keyof typeof HEADER_ALIASES;
  }
  return null;
}

export function parseStudentRoster(content: string): RosterParseResult {
  const rows: RosterRow[] = [];
  const problems: RosterProblem[] = [];

  const lines = content.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const headerIndex = lines.findIndex((line) => line.trim() !== '');

  if (headerIndex === -1) {
    return { rows, problems: [{ line: 1, messageKey: 'errors.importEmptyFile' }] };
  }

  const headerLine = lines[headerIndex] ?? '';
  const separator = detectSeparator(headerLine);
  const headers = splitCsvLine(headerLine, separator).map(matchHeader);

  const columnOf = (field: keyof typeof HEADER_ALIASES) => headers.indexOf(field);
  const missing = (['studentId', 'fullName', 'email'] as const).filter(
    (field) => columnOf(field) === -1,
  );
  if (missing.length > 0) {
    return {
      rows,
      problems: [
        {
          line: headerIndex + 1,
          messageKey: 'errors.importMissingColumns',
          value: missing.join(', '),
        },
      ],
    };
  }

  const seenStudentIds = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    if (raw.trim() === '') continue;

    const line = index + 1;
    const fields = splitCsvLine(raw, separator);
    const candidate = {
      studentId: fields[columnOf('studentId')] ?? '',
      fullName: fields[columnOf('fullName')] ?? '',
      email: fields[columnOf('email')] ?? '',
    };

    const parsed = importedStudentSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      problems.push({
        line,
        messageKey: issue?.message ?? 'errors.validationFailed',
        value: candidate[issue?.path[0] as keyof typeof candidate] || undefined,
      });
      continue;
    }

    // A duplicate inside the file itself would otherwise surface much later as
    // a confusing failure partway through the import.
    const idKey = parsed.data.studentId.toUpperCase();
    const emailKey = parsed.data.email.toLowerCase();
    const firstIdLine = seenStudentIds.get(idKey);
    const firstEmailLine = seenEmails.get(emailKey);

    if (firstIdLine !== undefined) {
      problems.push({
        line,
        messageKey: 'errors.importDuplicateStudentId',
        value: `${parsed.data.studentId} (dòng ${firstIdLine})`,
      });
      continue;
    }
    if (firstEmailLine !== undefined) {
      problems.push({
        line,
        messageKey: 'errors.importDuplicateEmail',
        value: `${parsed.data.email} (dòng ${firstEmailLine})`,
      });
      continue;
    }

    seenStudentIds.set(idKey, line);
    seenEmails.set(emailKey, line);
    rows.push({ line, student: parsed.data });
  }

  if (rows.length === 0 && problems.length === 0) {
    problems.push({ line: headerIndex + 1, messageKey: 'errors.importNoRows' });
  }

  return { rows, problems };
}

/**
 * Folds a Vietnamese name to something two spellings of it share.
 *
 * A lecturer looking for Nguyễn Văn A types "nguyen van a", because that is
 * what a keyboard gives them in a hurry. Matching without this would make the
 * search useless for exactly the names it will mostly be used on.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** Whether a name, a student code or an address contains what was typed. */
export function matchesSearch(
  haystack: { fullName: string; email: string; studentId?: string },
  term: string,
): boolean {
  const needle = foldForSearch(term);
  if (!needle) return true;

  return [haystack.fullName, haystack.email, haystack.studentId ?? '']
    .map(foldForSearch)
    .some((field) => field.includes(needle));
}
