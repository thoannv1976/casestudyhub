import { describe, expect, it } from 'vitest';
import { foldForSearch, matchesSearch } from '../import/csv';

/**
 * Finding a person by name.
 *
 * Almost every name on this platform is Vietnamese, and almost nobody types
 * the diacritics when they are looking for somebody. A search that required
 * them would be useless for exactly the names it exists to find.
 */

const student = {
  fullName: 'Nguyễn Văn Ánh',
  email: 'nguyen.van.anh@ftu.edu.vn',
  studentId: 'K60-1234',
};

describe('folding a name', () => {
  it('drops the diacritics a keyboard in a hurry leaves out', () => {
    expect(foldForSearch('Nguyễn Văn Ánh')).toBe('nguyen van anh');
    expect(foldForSearch('Trần Thị Bích')).toBe('tran thi bich');
  });

  it('folds đ, which is a letter rather than a mark', () => {
    // NFD leaves đ alone, so without this "dang" would never find "Đặng".
    expect(foldForSearch('Đặng Hoài Đức')).toBe('dang hoai duc');
  });

  it('leaves a name with no diacritics exactly as it was, lowercased', () => {
    expect(foldForSearch('  John Smith ')).toBe('john smith');
  });
});

describe('matching a person', () => {
  it('finds them by a name typed without diacritics', () => {
    expect(matchesSearch(student, 'nguyen van anh')).toBe(true);
    expect(matchesSearch(student, 'Nguyễn')).toBe(true);
  });

  it('finds them by part of a name, not only from the beginning', () => {
    // An index could not do this, which is why the search is in memory.
    expect(matchesSearch(student, 'van anh')).toBe(true);
    expect(matchesSearch(student, 'anh')).toBe(true);
  });

  it('finds them by student code or address', () => {
    expect(matchesSearch(student, 'k60-1234')).toBe(true);
    expect(matchesSearch(student, 'ftu.edu.vn')).toBe(true);
  });

  it('does not find somebody else', () => {
    expect(matchesSearch(student, 'tran thi bich')).toBe(false);
  });

  it('matches everybody on an empty search, so clearing the box shows the list', () => {
    expect(matchesSearch(student, '')).toBe(true);
    expect(matchesSearch(student, '   ')).toBe(true);
  });

  it('works for somebody with no student code, like a lecturer', () => {
    const lecturer = { fullName: 'Trần Thị Bích', email: 'bich@ftu.edu.vn' };
    expect(matchesSearch(lecturer, 'tran thi')).toBe(true);
    expect(matchesSearch(lecturer, 'k60')).toBe(false);
  });
});
