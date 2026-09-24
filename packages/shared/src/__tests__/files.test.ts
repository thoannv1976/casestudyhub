import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, extensionOf, safeFileName, validateUpload } from '../index';

const pdf = {
  fileName: 'Amazon case.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1024,
};

describe('safeFileName', () => {
  it('keeps an ordinary name readable', () => {
    expect(safeFileName('Amazon case.pdf')).toBe('Amazon-case.pdf');
    expect(safeFileName('G1_Case-01.docx')).toBe('G1_Case-01.docx');
  });

  it('refuses to let a name climb out of its folder', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('/absolute/path/file.pdf')).toBe('file.pdf');
    expect(safeFileName('..\\\\windows\\\\system32\\\\evil.pdf')).toBe('evil.pdf');
  });

  it('never returns an empty or hidden name', () => {
    expect(safeFileName('')).toBe('file');
    expect(safeFileName('...')).toBe('file');
    expect(safeFileName('.hidden')).toBe('hidden');
  });

  it('strips characters that do not belong in a storage path', () => {
    expect(safeFileName('bài trình bày (bản 2).pdf')).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('extensionOf', () => {
  it('reads the last extension, lower-cased', () => {
    expect(extensionOf('slides.PDF')).toBe('.pdf');
    expect(extensionOf('archive.tar.gz')).toBe('.gz');
    expect(extensionOf('noextension')).toBe('');
  });
});

describe('validateUpload', () => {
  it('accepts a PDF where a PDF is allowed', () => {
    expect(validateUpload(pdf, ['PDF'])).toBeNull();
  });

  it('rejects an empty file', () => {
    expect(validateUpload({ ...pdf, sizeBytes: 0 }, ['PDF'])?.messageKey).toBe('errors.fileEmpty');
  });

  it('rejects a file above the platform ceiling even when the policy allows more', () => {
    const problem = validateUpload({ ...pdf, sizeBytes: MAX_UPLOAD_BYTES + 1 }, ['PDF'], 100);
    expect(problem?.messageKey).toBe('errors.fileTooLarge');
    expect(problem?.details?.maxMb).toBe(32);
  });

  it('honours a stricter limit set by the policy', () => {
    const problem = validateUpload({ ...pdf, sizeBytes: 11 * 1024 * 1024 }, ['PDF'], 10);
    expect(problem?.messageKey).toBe('errors.fileTooLarge');
    expect(problem?.details?.maxMb).toBe(10);
  });

  it('rejects an executable wearing a PDF extension', () => {
    // The extension says PDF, the content type does not: refuse.
    const problem = validateUpload(
      { fileName: 'payload.pdf', contentType: 'application/x-msdownload', sizeBytes: 2048 },
      ['PDF'],
    );
    expect(problem?.messageKey).toBe('errors.fileFormatRejected');
  });

  it('rejects a real PDF sent with a mismatched extension', () => {
    const problem = validateUpload(
      { fileName: 'notes.txt', contentType: 'application/pdf', sizeBytes: 2048 },
      ['PDF'],
    );
    expect(problem?.messageKey).toBe('errors.fileFormatRejected');
  });

  it('rejects a format the deliverable does not allow', () => {
    expect(validateUpload(pdf, ['PPTX'])?.messageKey).toBe('errors.fileFormatRejected');
  });

  it('accepts any of several allowed formats', () => {
    const pptx = {
      fileName: 'slides.pptx',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: 4096,
    };
    expect(validateUpload(pptx, ['PDF', 'PPTX'])).toBeNull();
    expect(validateUpload(pdf, ['PDF', 'PPTX'])).toBeNull();
  });

  it('says so when a deliverable takes no file at all', () => {
    expect(validateUpload(pdf, ['LINK'])?.messageKey).toBe('errors.fileFormatNotUploadable');
  });

  it('ignores a charset parameter on the content type', () => {
    expect(
      validateUpload({ ...pdf, contentType: 'application/pdf; charset=binary' }, ['PDF']),
    ).toBeNull();
  });
});
