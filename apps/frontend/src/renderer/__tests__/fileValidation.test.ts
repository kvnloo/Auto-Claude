/**
 * Unit tests for file validation utilities
 *
 * Tests for file size/count validation, base64 conversion, and attachment processing.
 * These tests ensure the file attachment feature works correctly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateFile,
  validateFileCount,
  validateFiles,
  formatFileSize,
  generateFileId,
  resolveFilename,
  isLargeFile,
  hasLargeFiles,
  getRemainingSlots,
  canAddMoreFiles,
  extractBase64Data,
  getFileCategory,
  getFileExtension,
  MAX_FILE_SIZE,
  MAX_FILES_PER_MESSAGE,
  MIN_FILE_SIZE,
  LARGE_FILE_THRESHOLD
} from '../utils/fileValidation';

describe('File Validation Utilities', () => {
  describe('validateFile', () => {
    it('should accept valid file within size limit', () => {
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const result = validateFile(file);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject empty file (0 bytes)', () => {
      const file = new File([], 'empty.txt', { type: 'text/plain' });
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject file exceeding 1GB limit', () => {
      // Create a mock file with size > 1GB
      const largeFile = {
        name: 'large.bin',
        size: MAX_FILE_SIZE + 1,
        type: 'application/octet-stream'
      } as File;

      const result = validateFile(largeFile);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('1GB');
    });

    it('should accept file at exactly 1GB', () => {
      const file = {
        name: 'max.bin',
        size: MAX_FILE_SIZE,
        type: 'application/octet-stream'
      } as File;

      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateFileCount', () => {
    it('should allow adding when under limit', () => {
      const result = validateFileCount(10);
      expect(result.valid).toBe(true);
    });

    it('should reject when at limit', () => {
      const result = validateFileCount(MAX_FILES_PER_MESSAGE);
      expect(result.valid).toBe(false);
      expect(result.error).toContain(`${MAX_FILES_PER_MESSAGE}`);
    });

    it('should reject when adding more files than remaining slots', () => {
      const result = validateFileCount(48, 5); // 48 current, want to add 5, only 2 slots
      expect(result.valid).toBe(false);
      expect(result.error).toContain('2'); // Only 2 more can be added
    });

    it('should accept adding files that fit exactly', () => {
      const result = validateFileCount(48, 2);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateFiles', () => {
    it('should return valid files and filter out invalid ones', () => {
      const validFile = new File(['content'], 'valid.txt');
      const emptyFile = new File([], 'empty.txt');

      const { validFiles, errors, skippedCount } = validateFiles([validFile, emptyFile], 0);

      expect(validFiles).toHaveLength(1);
      expect(validFiles[0].name).toBe('valid.txt');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('empty');
      expect(skippedCount).toBe(0);
    });

    it('should skip files when at limit', () => {
      const files = [
        new File(['a'], 'file1.txt'),
        new File(['b'], 'file2.txt'),
        new File(['c'], 'file3.txt')
      ];

      const { validFiles, errors, skippedCount } = validateFiles(files, 49);

      expect(validFiles).toHaveLength(1); // Only 1 slot available
      expect(skippedCount).toBe(2);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('skipped');
    });

    it('should return empty when already at limit', () => {
      const files = [new File(['content'], 'file.txt')];

      const { validFiles, errors, skippedCount } = validateFiles(files, MAX_FILES_PER_MESSAGE);

      expect(validFiles).toHaveLength(0);
      expect(skippedCount).toBe(1);
      expect(errors).toHaveLength(1);
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('should format KB correctly', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(5000)).toBe('4.9 KB');
    });

    it('should format MB correctly', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatFileSize(52428800)).toBe('50.0 MB');
    });

    it('should format GB correctly', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    });

    it('should handle negative numbers', () => {
      expect(formatFileSize(-100)).toBe('0 B');
    });
  });

  describe('generateFileId', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateFileId());
      }
      expect(ids.size).toBe(100); // All should be unique
    });

    it('should start with file- prefix', () => {
      const id = generateFileId();
      expect(id.startsWith('file-')).toBe(true);
    });
  });

  describe('resolveFilename', () => {
    it('should return original name when no conflict', () => {
      const result = resolveFilename('newfile.txt', ['existing.txt']);
      expect(result).toBe('newfile.txt');
    });

    it('should append timestamp when there is conflict', () => {
      const result = resolveFilename('duplicate.txt', ['duplicate.txt']);
      expect(result).not.toBe('duplicate.txt');
      expect(result).toContain('duplicate-');
      expect(result).toContain('.txt');
    });

    it('should handle files without extension', () => {
      const result = resolveFilename('README', ['README']);
      expect(result).not.toBe('README');
      expect(result).toContain('README-');
    });
  });

  describe('isLargeFile', () => {
    it('should return true for files over 100MB', () => {
      const largeFile = { size: LARGE_FILE_THRESHOLD + 1 } as File;
      expect(isLargeFile(largeFile)).toBe(true);
    });

    it('should return false for files under 100MB', () => {
      const smallFile = { size: LARGE_FILE_THRESHOLD - 1 } as File;
      expect(isLargeFile(smallFile)).toBe(false);
    });
  });

  describe('hasLargeFiles', () => {
    it('should return true if any file is large', () => {
      const files = [
        { size: 1000 } as File,
        { size: LARGE_FILE_THRESHOLD + 1 } as File
      ];
      expect(hasLargeFiles(files)).toBe(true);
    });

    it('should return false if all files are small', () => {
      const files = [
        { size: 1000 } as File,
        { size: 2000 } as File
      ];
      expect(hasLargeFiles(files)).toBe(false);
    });
  });

  describe('getRemainingSlots', () => {
    it('should calculate remaining slots correctly', () => {
      expect(getRemainingSlots(0)).toBe(MAX_FILES_PER_MESSAGE);
      expect(getRemainingSlots(25)).toBe(25);
      expect(getRemainingSlots(50)).toBe(0);
      expect(getRemainingSlots(100)).toBe(0); // Can't be negative
    });
  });

  describe('canAddMoreFiles', () => {
    it('should return true when under limit', () => {
      expect(canAddMoreFiles(0)).toBe(true);
      expect(canAddMoreFiles(49)).toBe(true);
    });

    it('should return false when at or over limit', () => {
      expect(canAddMoreFiles(50)).toBe(false);
      expect(canAddMoreFiles(100)).toBe(false);
    });
  });

  describe('extractBase64Data', () => {
    it('should extract base64 data from data URL', () => {
      const dataUrl = 'data:text/plain;base64,SGVsbG8gV29ybGQh';
      const result = extractBase64Data(dataUrl);
      expect(result).toBe('SGVsbG8gV29ybGQh');
    });

    it('should handle data URL without comma', () => {
      const raw = 'SGVsbG8gV29ybGQh';
      const result = extractBase64Data(raw);
      expect(result).toBe('SGVsbG8gV29ybGQh');
    });

    it('should handle empty string', () => {
      const result = extractBase64Data('');
      expect(result).toBe('');
    });
  });

  describe('getFileCategory', () => {
    it('should categorize image files', () => {
      expect(getFileCategory('image/png')).toBe('image');
      expect(getFileCategory('image/jpeg')).toBe('image');
    });

    it('should categorize video files', () => {
      expect(getFileCategory('video/mp4')).toBe('video');
    });

    it('should categorize audio files', () => {
      expect(getFileCategory('audio/mpeg')).toBe('audio');
    });

    it('should categorize document files', () => {
      expect(getFileCategory('application/pdf')).toBe('document');
      expect(getFileCategory('text/plain')).toBe('document');
      expect(getFileCategory('text/rtf')).toBe('document');
    });

    it('should categorize code files', () => {
      expect(getFileCategory('application/json')).toBe('code');
      expect(getFileCategory('application/javascript')).toBe('code');
      expect(getFileCategory('text/html')).toBe('code');
    });

    it('should categorize archive files', () => {
      expect(getFileCategory('application/zip')).toBe('archive');
      expect(getFileCategory('application/x-tar')).toBe('archive');
    });

    it('should return other for unknown types', () => {
      expect(getFileCategory('application/unknown')).toBe('other');
    });
  });

  describe('getFileExtension', () => {
    it('should extract extension correctly', () => {
      expect(getFileExtension('file.txt')).toBe('.txt');
      expect(getFileExtension('document.pdf')).toBe('.pdf');
      expect(getFileExtension('script.test.ts')).toBe('.ts');
    });

    it('should handle files without extension', () => {
      expect(getFileExtension('README')).toBe('');
      expect(getFileExtension('Dockerfile')).toBe('');
    });

    it('should handle files ending with dot', () => {
      expect(getFileExtension('file.')).toBe('');
    });

    it('should return lowercase extension', () => {
      expect(getFileExtension('File.TXT')).toBe('.txt');
      expect(getFileExtension('Doc.PDF')).toBe('.pdf');
    });
  });
});

describe('Constants', () => {
  it('should have correct MAX_FILE_SIZE (1GB)', () => {
    expect(MAX_FILE_SIZE).toBe(1024 * 1024 * 1024);
  });

  it('should have correct MAX_FILES_PER_MESSAGE (50)', () => {
    expect(MAX_FILES_PER_MESSAGE).toBe(50);
  });

  it('should have correct MIN_FILE_SIZE (1 byte)', () => {
    expect(MIN_FILE_SIZE).toBe(1);
  });

  it('should have correct LARGE_FILE_THRESHOLD (100MB)', () => {
    expect(LARGE_FILE_THRESHOLD).toBe(100 * 1024 * 1024);
  });
});
