// Lab reports & scans attached at the vital-signs step – checked the same way by the UI (before upload)
// and the API (before saving). A file is a Photo (JPG / PNG / WEBP) or a PDF, at most 5 MB.

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const CATEGORY_MAX = 60;

export const ATTACHMENT_TYPES = {
  photo: { mimes: ['image/jpeg', 'image/png', 'image/webp'], accept: 'image/jpeg,image/png,image/webp' },
  pdf: { mimes: ['application/pdf'], accept: 'application/pdf,.pdf' },
};

// English messages; the UI shows its own translation of each code (attach.err.<code>).
export const ATTACHMENT_ERRORS = {
  type: 'choose Photo or PDF',
  empty: 'the file is empty',
  size: 'the file is larger than 5 MB',
  mismatch: 'the file does not match the chosen attachment type',
  category: `category must be at most ${CATEGORY_MAX} characters`,
};

/** Checks type / mime / size before upload. Returns an error code or null. */
export function checkAttachment({ type, mime, size, category }) {
  const spec = ATTACHMENT_TYPES[type];
  if (!spec) return 'type';
  if (!size) return 'empty';
  if (size > MAX_ATTACHMENT_BYTES) return 'size';
  if (!spec.mimes.includes(mime)) return 'mismatch';
  if (category && String(category).trim().length > CATEGORY_MAX) return 'category';
  return null;
}

/** The real format of a file from its first bytes (so a renamed file cannot pass as a PDF or photo). */
export function sniffMime(bytes) {
  const b = (i) => bytes[i];
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return 'application/pdf';    // %PDF
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46
    && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp';     // RIFF....WEBP
  return null;
}

/** 1536 → "1.5 KB" */
export function fileSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
