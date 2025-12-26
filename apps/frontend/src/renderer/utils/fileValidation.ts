/**
 * File validation utilities for Insights chat file attachments
 *
 * Provides validation, formatting, and utility functions for handling
 * file attachments with 1GB per file limit and 50 files per message.
 */

import type { AttachedFile } from '../../shared/types';

// ============================================
// Constants
// ============================================

/** Maximum file size in bytes (1GB) */
export const MAX_FILE_SIZE = 1024 * 1024 * 1024;

/** Maximum number of files per message */
export const MAX_FILES_PER_MESSAGE = 50;

/** Minimum file size (0 bytes not allowed) */
export const MIN_FILE_SIZE = 1;

/** Size threshold for showing loading indicator (100MB) */
export const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;

// ============================================
// Types
// ============================================

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export interface FilesValidationResult {
  validFiles: File[];
  errors: string[];
  skippedCount: number;
}

// ============================================
// Validation Functions
// ============================================

/**
 * Validate a single file for size and empty file constraints
 * @param file - The file to validate
 * @returns Validation result with error message if invalid
 */
export function validateFile(file: File): FileValidationResult {
  // Check for empty files
  if (file.size < MIN_FILE_SIZE) {
    return {
      valid: false,
      error: `"${file.name}" is empty (0 bytes) and cannot be attached`
    };
  }

  // Check file size limit
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `"${file.name}" exceeds the 1GB file size limit`
    };
  }

  return { valid: true };
}

/**
 * Validate if more files can be added based on current count
 * @param currentCount - Current number of attached files
 * @param filesToAdd - Number of files to add
 * @returns Validation result with error message if limit exceeded
 */
export function validateFileCount(
  currentCount: number,
  filesToAdd: number = 1
): FileValidationResult {
  if (currentCount >= MAX_FILES_PER_MESSAGE) {
    return {
      valid: false,
      error: `Maximum of ${MAX_FILES_PER_MESSAGE} files per message reached`
    };
  }

  const remainingSlots = MAX_FILES_PER_MESSAGE - currentCount;
  if (filesToAdd > remainingSlots) {
    return {
      valid: false,
      error: `Only ${remainingSlots} more file(s) can be added`
    };
  }

  return { valid: true };
}

/**
 * Validate multiple files and return valid files with any errors
 * @param files - Array of files to validate
 * @param currentCount - Current number of already attached files
 * @returns Object containing valid files, errors, and skipped count
 */
export function validateFiles(
  files: File[],
  currentCount: number = 0
): FilesValidationResult {
  const validFiles: File[] = [];
  const errors: string[] = [];
  let skippedCount = 0;

  // Calculate remaining slots
  const remainingSlots = MAX_FILES_PER_MESSAGE - currentCount;

  if (remainingSlots <= 0) {
    return {
      validFiles: [],
      errors: [`Maximum of ${MAX_FILES_PER_MESSAGE} files per message reached`],
      skippedCount: files.length
    };
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // Check if we've reached the limit
    if (validFiles.length >= remainingSlots) {
      skippedCount = files.length - i;
      errors.push(
        `${skippedCount} file(s) skipped - maximum ${MAX_FILES_PER_MESSAGE} files per message`
      );
      break;
    }

    // Validate individual file
    const result = validateFile(file);
    if (result.valid) {
      validFiles.push(file);
    } else {
      errors.push(result.error!);
    }
  }

  return { validFiles, errors, skippedCount };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Format file size for display (supports B, KB, MB, GB)
 * @param bytes - Size in bytes
 * @returns Human-readable size string
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Generate a unique ID for file attachments
 * @returns Unique file ID string
 */
export function generateFileId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Resolve duplicate filenames by appending timestamp
 * @param filename - Original filename
 * @param existingFilenames - Array of existing filenames
 * @returns Unique filename
 */
export function resolveFilename(filename: string, existingFilenames: string[]): string {
  if (!existingFilenames.includes(filename)) {
    return filename;
  }

  const lastDot = filename.lastIndexOf('.');
  const name = lastDot !== -1 ? filename.substring(0, lastDot) : filename;
  const ext = lastDot !== -1 ? filename.substring(lastDot) : '';
  const timestamp = Date.now();

  return `${name}-${timestamp}${ext}`;
}

/**
 * Check if a file is considered "large" (>100MB) for loading indicator
 * @param file - File to check
 * @returns True if file is larger than threshold
 */
export function isLargeFile(file: File): boolean {
  return file.size > LARGE_FILE_THRESHOLD;
}

/**
 * Check if any files in the array are large
 * @param files - Array of files to check
 * @returns True if any file exceeds threshold
 */
export function hasLargeFiles(files: File[]): boolean {
  return files.some(isLargeFile);
}

/**
 * Get the remaining file slots available
 * @param currentCount - Current number of attached files
 * @returns Number of remaining slots
 */
export function getRemainingSlots(currentCount: number): number {
  return Math.max(0, MAX_FILES_PER_MESSAGE - currentCount);
}

/**
 * Check if more files can be added
 * @param currentCount - Current number of attached files
 * @returns True if more files can be added
 */
export function canAddMoreFiles(currentCount: number): boolean {
  return currentCount < MAX_FILES_PER_MESSAGE;
}

// ============================================
// File Conversion Functions
// ============================================

/**
 * Convert a File to base64 data URL
 * @param file - File to convert
 * @returns Promise resolving to base64 data URL string
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Extract base64 data from a data URL (removes the prefix)
 * @param dataUrl - Data URL string (e.g., "data:image/png;base64,...")
 * @returns Base64 data without prefix
 */
export function extractBase64Data(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    return dataUrl;
  }
  return dataUrl.substring(commaIndex + 1);
}

/**
 * Convert a File to an AttachedFile object
 * @param file - File to convert
 * @param existingFilenames - Array of existing filenames for deduplication
 * @returns Promise resolving to AttachedFile object
 */
export async function fileToAttachment(
  file: File,
  existingFilenames: string[] = []
): Promise<AttachedFile> {
  const dataUrl = await fileToBase64(file);
  const resolvedFilename = resolveFilename(file.name, existingFilenames);

  return {
    id: generateFileId(),
    filename: resolvedFilename,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    data: extractBase64Data(dataUrl),
    status: 'ready'
  };
}

/**
 * Process multiple files into AttachedFile objects
 * @param files - Array of files to process
 * @param existingAttachments - Existing attachments for filename deduplication
 * @returns Promise resolving to array of AttachedFile objects and any errors
 */
export async function processFilesToAttachments(
  files: File[],
  existingAttachments: AttachedFile[] = []
): Promise<{ attachments: AttachedFile[]; errors: string[] }> {
  const attachments: AttachedFile[] = [];
  const errors: string[] = [];
  const existingFilenames = existingAttachments.map((a) => a.filename);

  for (const file of files) {
    try {
      const attachment = await fileToAttachment(file, [
        ...existingFilenames,
        ...attachments.map((a) => a.filename)
      ]);
      attachments.push(attachment);
    } catch {
      errors.push(`Failed to process "${file.name}"`);
    }
  }

  return { attachments, errors };
}

// ============================================
// MIME Type Utilities
// ============================================

/**
 * Get file category based on MIME type
 * @param mimeType - MIME type string
 * @returns Category string for icon selection
 */
export function getFileCategory(
  mimeType: string
): 'image' | 'document' | 'code' | 'archive' | 'video' | 'audio' | 'other' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';

  // Document types
  if (
    mimeType === 'application/pdf' ||
    mimeType.includes('word') ||
    mimeType.includes('document') ||
    mimeType === 'text/plain' ||
    mimeType === 'text/rtf' ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType.includes('presentation') ||
    mimeType.includes('powerpoint')
  ) {
    return 'document';
  }

  // Code/text types
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/typescript' ||
    mimeType === 'application/xml' ||
    mimeType.includes('script')
  ) {
    return 'code';
  }

  // Archive types
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-rar-compressed' ||
    mimeType === 'application/x-tar' ||
    mimeType === 'application/gzip' ||
    mimeType === 'application/x-7z-compressed'
  ) {
    return 'archive';
  }

  return 'other';
}

/**
 * Get file extension from filename
 * @param filename - Filename to extract extension from
 * @returns Extension including the dot (e.g., ".pdf") or empty string
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return '';
  }
  return filename.substring(lastDot).toLowerCase();
}
