/**
 * File icon mapping utility for Insights chat file attachments
 *
 * Provides icon selection based on file type (MIME type or extension)
 * for displaying file attachments in chat messages.
 */

import {
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Archive,
  Play,
  type LucideIcon
} from 'lucide-react';
import { getFileCategory, getFileExtension } from './fileValidation';

// ============================================
// Types
// ============================================

export type FileCategory = 'image' | 'document' | 'code' | 'archive' | 'video' | 'audio' | 'other';

export interface FileIconInfo {
  icon: LucideIcon;
  colorClass: string;
  label: string;
}

// ============================================
// Icon Color Classes
// ============================================

/** Color classes for different file categories */
export const FILE_CATEGORY_COLORS: Record<FileCategory, string> = {
  image: 'text-purple-400',
  document: 'text-blue-400',
  code: 'text-info',
  archive: 'text-amber-400',
  video: 'text-pink-400',
  audio: 'text-green-400',
  other: 'text-muted-foreground'
};

/** Labels for file categories */
export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  image: 'Image',
  document: 'Document',
  code: 'Code',
  archive: 'Archive',
  video: 'Video',
  audio: 'Audio',
  other: 'File'
};

// ============================================
// Extension to Icon Mapping
// ============================================

/**
 * Get file icon based on file extension
 * Returns specific icon for known extensions, falls back to category-based icon
 *
 * @param extension - File extension including dot (e.g., ".ts")
 * @returns LucideIcon component for the file type
 */
function getIconForExtension(extension: string): LucideIcon | null {
  const ext = extension.toLowerCase().replace('.', '');

  // Code files
  const codeExtensions = [
    'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java',
    'c', 'cpp', 'h', 'cs', 'php', 'swift', 'kt', 'scala',
    'vue', 'svelte', 'sh', 'bash', 'zsh', 'ps1', 'sql'
  ];
  if (codeExtensions.includes(ext)) {
    return FileCode;
  }

  // JSON/Config files
  const jsonExtensions = ['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env'];
  if (jsonExtensions.includes(ext)) {
    return FileJson;
  }

  // Text/Markdown files
  const textExtensions = ['md', 'txt', 'rst', 'rtf', 'log'];
  if (textExtensions.includes(ext)) {
    return FileText;
  }

  // Image files
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff'];
  if (imageExtensions.includes(ext)) {
    return FileImage;
  }

  // CSS/Style files
  const styleExtensions = ['css', 'scss', 'sass', 'less', 'styl'];
  if (styleExtensions.includes(ext)) {
    return FileCode;
  }

  // HTML files
  const htmlExtensions = ['html', 'htm', 'xhtml'];
  if (htmlExtensions.includes(ext)) {
    return FileCode;
  }

  // Spreadsheet files - use FileText as generic document icon
  const spreadsheetExtensions = ['xlsx', 'xls', 'csv', 'ods'];
  if (spreadsheetExtensions.includes(ext)) {
    return FileText;
  }

  // Presentation files - use FileText as generic document icon
  const presentationExtensions = ['pptx', 'ppt', 'odp', 'key'];
  if (presentationExtensions.includes(ext)) {
    return FileText;
  }

  // Archive files
  const archiveExtensions = ['zip', 'rar', 'tar', 'gz', '7z', 'bz2', 'xz', 'tgz'];
  if (archiveExtensions.includes(ext)) {
    return Archive;
  }

  // Video files
  const videoExtensions = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v'];
  if (videoExtensions.includes(ext)) {
    return Play;
  }

  // Audio files - use Play icon (similar to video)
  const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'];
  if (audioExtensions.includes(ext)) {
    return Play;
  }

  // PDF files - use FileText as document icon
  if (ext === 'pdf') {
    return FileText;
  }

  // Word documents
  const wordExtensions = ['doc', 'docx', 'odt'];
  if (wordExtensions.includes(ext)) {
    return FileText;
  }

  return null;
}

/**
 * Get color class based on file extension
 *
 * @param extension - File extension including dot (e.g., ".ts")
 * @returns Tailwind color class
 */
function getColorForExtension(extension: string): string {
  const ext = extension.toLowerCase().replace('.', '');

  // CSS/Style files - pink
  const styleExtensions = ['css', 'scss', 'sass', 'less', 'styl'];
  if (styleExtensions.includes(ext)) {
    return 'text-pink-400';
  }

  // HTML files - orange
  const htmlExtensions = ['html', 'htm', 'xhtml'];
  if (htmlExtensions.includes(ext)) {
    return 'text-orange-400';
  }

  // JSON/Config files - warning (yellow)
  const jsonExtensions = ['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env'];
  if (jsonExtensions.includes(ext)) {
    return 'text-warning';
  }

  // Spreadsheet files - green
  const spreadsheetExtensions = ['xlsx', 'xls', 'csv', 'ods'];
  if (spreadsheetExtensions.includes(ext)) {
    return 'text-green-400';
  }

  // Presentation files - orange
  const presentationExtensions = ['pptx', 'ppt', 'odp', 'key'];
  if (presentationExtensions.includes(ext)) {
    return 'text-orange-400';
  }

  // PDF files - red
  if (ext === 'pdf') {
    return 'text-red-400';
  }

  return '';
}

// ============================================
// Main Functions
// ============================================

/**
 * Get icon information for a file based on MIME type
 *
 * @param mimeType - MIME type string (e.g., "image/png")
 * @returns FileIconInfo with icon component, color class, and label
 */
export function getIconForMimeType(mimeType: string): FileIconInfo {
  const category = getFileCategory(mimeType);
  return getIconForCategory(category);
}

/**
 * Get icon information for a file category
 *
 * @param category - File category
 * @returns FileIconInfo with icon component, color class, and label
 */
export function getIconForCategory(category: FileCategory): FileIconInfo {
  const colorClass = FILE_CATEGORY_COLORS[category];
  const label = FILE_CATEGORY_LABELS[category];

  let icon: LucideIcon;

  switch (category) {
    case 'image':
      icon = FileImage;
      break;
    case 'document':
      icon = FileText;
      break;
    case 'code':
      icon = FileCode;
      break;
    case 'archive':
      icon = Archive;
      break;
    case 'video':
      icon = Play;
      break;
    case 'audio':
      icon = Play;
      break;
    case 'other':
    default:
      icon = File;
      break;
  }

  return { icon, colorClass, label };
}

/**
 * Get icon information for a file based on filename
 * Uses extension for more specific icons, falls back to MIME type category
 *
 * @param filename - Name of the file (e.g., "script.ts")
 * @param mimeType - Optional MIME type for fallback
 * @returns FileIconInfo with icon component, color class, and label
 */
export function getFileIcon(filename: string, mimeType?: string): FileIconInfo {
  const extension = getFileExtension(filename);

  // Try to get icon based on extension first
  const extensionIcon = getIconForExtension(extension);
  const extensionColor = getColorForExtension(extension);

  if (extensionIcon) {
    // Get category for label
    const category = mimeType
      ? getFileCategory(mimeType)
      : getCategoryFromExtension(extension);

    return {
      icon: extensionIcon,
      colorClass: extensionColor || FILE_CATEGORY_COLORS[category],
      label: FILE_CATEGORY_LABELS[category]
    };
  }

  // Fall back to MIME type based icon
  if (mimeType) {
    return getIconForMimeType(mimeType);
  }

  // Default fallback
  return {
    icon: File,
    colorClass: FILE_CATEGORY_COLORS.other,
    label: FILE_CATEGORY_LABELS.other
  };
}

/**
 * Get file category from extension
 *
 * @param extension - File extension including dot
 * @returns FileCategory
 */
function getCategoryFromExtension(extension: string): FileCategory {
  const ext = extension.toLowerCase().replace('.', '');

  // Code extensions
  const codeExtensions = [
    'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java',
    'c', 'cpp', 'h', 'cs', 'php', 'swift', 'kt', 'scala',
    'vue', 'svelte', 'sh', 'bash', 'zsh', 'ps1', 'sql',
    'css', 'scss', 'sass', 'less', 'styl', 'html', 'htm', 'xhtml',
    'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env'
  ];
  if (codeExtensions.includes(ext)) {
    return 'code';
  }

  // Text/Document extensions
  const documentExtensions = [
    'md', 'txt', 'rst', 'rtf', 'log', 'pdf',
    'doc', 'docx', 'odt', 'xlsx', 'xls', 'csv', 'ods',
    'pptx', 'ppt', 'odp', 'key'
  ];
  if (documentExtensions.includes(ext)) {
    return 'document';
  }

  // Image extensions
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff'];
  if (imageExtensions.includes(ext)) {
    return 'image';
  }

  // Archive extensions
  const archiveExtensions = ['zip', 'rar', 'tar', 'gz', '7z', 'bz2', 'xz', 'tgz'];
  if (archiveExtensions.includes(ext)) {
    return 'archive';
  }

  // Video extensions
  const videoExtensions = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v'];
  if (videoExtensions.includes(ext)) {
    return 'video';
  }

  // Audio extensions
  const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'];
  if (audioExtensions.includes(ext)) {
    return 'audio';
  }

  return 'other';
}

/**
 * Get appropriate icon size class based on context
 *
 * @param size - Size variant: 'sm' | 'md' | 'lg'
 * @returns Tailwind size classes
 */
export function getIconSizeClass(size: 'sm' | 'md' | 'lg' = 'md'): string {
  switch (size) {
    case 'sm':
      return 'h-3 w-3';
    case 'md':
      return 'h-4 w-4';
    case 'lg':
      return 'h-5 w-5';
    default:
      return 'h-4 w-4';
  }
}
