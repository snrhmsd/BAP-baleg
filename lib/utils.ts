import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { FileType, TimeStatus, VerificationStatus } from '@/types';

// ─── Tailwind class merger ────────────────────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Date utilities ───────────────────────────────────────────────────────────

/**
 * Parse an Indonesian date string like "29 Juni 2026, 14:30" into a Date object.
 * Falls back to standard Date parsing if needed.
 */
export function parseIndonesianDate(dateStr: string): Date {
  const months: Record<string, string> = {
    januari: 'january', februari: 'february', maret: 'march',
    april: 'april', mei: 'may', juni: 'june', juli: 'july',
    agustus: 'august', september: 'september', oktober: 'october',
    november: 'november', desember: 'december',
  };
  let cleaned = dateStr.toLowerCase().replace(/,/g, '');
  Object.keys(months).forEach((indo) => {
    cleaned = cleaned.replace(new RegExp(indo, 'g'), months[indo]);
  });
  return new Date(cleaned);
}

/**
 * Safely parse a date string — handles both ISO strings and Indonesian locale strings.
 */
function safeParse(date: Date | string): Date {
  if (typeof date !== 'string') return date;
  const standard = new Date(date);
  if (!isNaN(standard.getTime())) return standard;
  // Fallback: try Indonesian date parsing
  const indo = parseIndonesianDate(date);
  return indo;
}

/**
 * Format a Date or date string to Indonesian locale
 * Handles both ISO strings and Indonesian-formatted strings (e.g. from Sheets).
 * e.g. "29 Juni 2026"
 */
export function formatTanggal(date: Date | string): string {
  const d = safeParse(date);
  if (isNaN(d.getTime())) return String(date); // return as-is if still invalid
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

/**
 * Format a Date or date string to Indonesian locale with time
 * Handles both ISO strings and Indonesian-formatted strings (e.g. from Sheets).
 * e.g. "29 Juni 2026, 14:30"
 */
export function formatTanggalWaktu(date: Date | string): string {
  const d = safeParse(date);
  if (isNaN(d.getTime())) return String(date); // return as-is if still invalid
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

/**
 * Returns a date string (YYYY-MM-DD) that is `days` days after `from`
 */
export function addDays(from: Date | string, days: number): string {
  const d = typeof from === 'string' ? new Date(from) : new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Compute deadline: H+3 after submission date
 */
export function computeDeadline(submissionDate?: Date): string {
  return addDays(submissionDate ?? new Date(), 3);
}

/**
 * Calculate time status based on submission timestamp vs deadline
 */
export function calcTimeStatus(
  submissionTimestamp: string,
  deadline: string,
): TimeStatus {
  const submitted = new Date(submissionTimestamp);
  const deadlineDate = new Date(deadline + 'T23:59:59');
  return submitted <= deadlineDate ? 'Tepat Waktu' : 'Terlambat';
}

/**
 * Format YYYY-MM to folder-friendly month string
 * e.g. "2026-06" → "2026-06"
 */
export function getMonthFolder(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Sanitize a string for use as a folder/file name
 * Removes characters that may cause issues on Drive or filesystem
 */
export function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

// ─── File utilities ───────────────────────────────────────────────────────────

export const ALLOWED_FILE_TYPES: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export function isAllowedFileType(file: File, allowedTypes: Record<string, string[]> = ALLOWED_FILE_TYPES): boolean {
  return Object.keys(allowedTypes).includes(file.type);
}

export function isAllowedFileSize(file: File): boolean {
  return file.size <= MAX_FILE_SIZE_BYTES;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateFiles(
  files: File[],
  customAllowedTypes?: Record<string, string[]>
): {
  valid: File[];
  errors: string[];
} {
  const valid: File[] = [];
  const errors: string[] = [];
  const allowed = customAllowedTypes || ALLOWED_FILE_TYPES;

  for (const file of files) {
    if (!isAllowedFileType(file, allowed)) {
      errors.push(`${file.name}: tipe file tidak didukung`);
      continue;
    }
    if (!isAllowedFileSize(file)) {
      errors.push(`${file.name}: ukuran melebihi batas 25 MB`);
      continue;
    }
    valid.push(file);
  }

  return { valid, errors };
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export function getVerificationStatusColor(
  status: VerificationStatus,
): string {
  switch (status) {
    case 'Draft':
      return 'text-gray-700 bg-gray-50 border-gray-200';
    case 'Sesuai':
      return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'Perlu Revisi':
      return 'text-red-700 bg-red-50 border-red-200';
    default:
      return 'text-amber-700 bg-amber-50 border-amber-200';
  }
}

export function getTimeStatusColor(status: TimeStatus): string {
  switch (status) {
    case 'Tepat Waktu':
      return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'Terlambat':
      return 'text-red-700 bg-red-50 border-red-200';
    case 'Mohon Upload BAP':
      return 'text-amber-700 bg-amber-50 border-amber-200';
    default:
      return 'text-gray-500 bg-gray-100 border-gray-200';
  }
}

export function getFileTypeIcon(type: FileType): string {
  switch (type) {
    case 'Foto':
      return '🖼️';
    case 'Video':
      return '🎬';
    case 'Dokumen':
      return '📄';
    default:
      return '📁';
  }
}
