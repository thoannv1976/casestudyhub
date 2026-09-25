import { z } from 'zod';
import type { DeliverableFormat } from '../policy/presentation-policy';

/**
 * File validation (SRS 9.3, 20).
 *
 * Every upload is checked on the server before a byte reaches storage. The
 * browser's declared content type is a hint, not evidence, so the extension
 * has to agree with it: a .exe renamed to .pdf fails, and so does a real PDF
 * sent with a content type that claims something else.
 */

/**
 * One platform-wide ceiling, below what the policy allows for a deliverable.
 * Uploads are buffered in the request handler, and a container that accepts
 * several 100 MB files at once runs out of memory. Raising this means moving
 * to resumable uploads first.
 */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

export const FORMAT_MIME_TYPES: Readonly<Record<DeliverableFormat, readonly string[]>> = {
  PDF: ['application/pdf'],
  DOCX: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ],
  PPTX: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
  ],
  IMAGE: ['image/png', 'image/jpeg', 'image/webp'],
  LINK: [],
  FORM: [],
};

export const FORMAT_EXTENSIONS: Readonly<Record<DeliverableFormat, readonly string[]>> = {
  PDF: ['.pdf'],
  DOCX: ['.docx', '.doc'],
  PPTX: ['.pptx', '.ppt'],
  IMAGE: ['.png', '.jpg', '.jpeg', '.webp'],
  LINK: [],
  FORM: [],
};

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

/**
 * Strips a name down to something safe to put in a storage path: no
 * directories, no separators, nothing that could climb out of its folder.
 */
export function safeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? 'file';
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'file';
}

export interface UploadCandidate {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface UploadProblem {
  messageKey: string;
  details?: Record<string, unknown>;
}

/** Returns null when the file is acceptable, or the reason it is not. */
export function validateUpload(
  candidate: UploadCandidate,
  allowedFormats: readonly DeliverableFormat[],
  maxSizeMb?: number,
): UploadProblem | null {
  if (candidate.sizeBytes <= 0) {
    return { messageKey: 'errors.fileEmpty' };
  }

  const ceiling = Math.min(
    maxSizeMb ? maxSizeMb * 1024 * 1024 : MAX_UPLOAD_BYTES,
    MAX_UPLOAD_BYTES,
  );
  if (candidate.sizeBytes > ceiling) {
    return {
      messageKey: 'errors.fileTooLarge',
      details: { maxMb: Math.floor(ceiling / (1024 * 1024)) },
    };
  }

  const uploadable = allowedFormats.filter((format) => FORMAT_MIME_TYPES[format].length > 0);
  if (uploadable.length === 0) {
    return { messageKey: 'errors.fileFormatNotUploadable' };
  }

  const extension = extensionOf(candidate.fileName);
  const contentType = candidate.contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  const matching = uploadable.find(
    (format) =>
      FORMAT_EXTENSIONS[format].includes(extension) &&
      FORMAT_MIME_TYPES[format].includes(contentType),
  );

  if (!matching) {
    return {
      messageKey: 'errors.fileFormatRejected',
      details: { allowed: uploadable.join(', '), extension },
    };
  }

  return null;
}

export const attachmentUploadSchema = z.object({
  kind: z.enum(['case', 'guide', 'slide_template', 'reference', 'video']),
});

/**
 * A submission that is a link rather than a file (SRS Module 09).
 *
 * A presentation video is recorded on a phone and uploaded to YouTube; asking
 * a group to also push a gigabyte through this platform would be asking them
 * to do the same work twice. So a deliverable whose format is `LINK` is
 * satisfied by a URL.
 *
 * Any https address is accepted. Restricting to a list of hosts would block a
 * faculty that uses something this project never heard of, and would not make
 * the link safer: what makes it readable is that the interface shows where it
 * goes before anybody follows it.
 */
export function hostOfLink(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

export function validateLink(
  url: string,
  allowedFormats: readonly DeliverableFormat[],
): UploadProblem | null {
  if (!allowedFormats.includes('LINK')) {
    return { messageKey: 'errors.deliverableIsNotALink' };
  }
  if (url.trim().length > 2000) return { messageKey: 'errors.linkTooLong' };

  // http, a bare domain or a file:// path all fail here, and they should: a
  // link a class will open for years has to be one a browser can open safely.
  if (!hostOfLink(url)) return { messageKey: 'errors.linkNotHttps' };

  return null;
}
