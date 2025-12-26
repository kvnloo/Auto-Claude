/**
 * FileChip component for displaying individual file attachments
 *
 * Used to show attached files in the Insights chat with file icon,
 * name, size, and optional remove button.
 */

import { X, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { getFileIcon, getIconSizeClass } from '../utils/fileIcons';
import { formatFileSize } from '../utils/fileValidation';
import type { AttachedFile } from '../../shared/types';

// ============================================
// Types
// ============================================

export interface FileChipProps {
  /** The file attachment to display */
  file: AttachedFile;
  /** Callback when remove button is clicked */
  onRemove?: (file: AttachedFile) => void;
  /** Whether the chip is read-only (no remove button) */
  readOnly?: boolean;
  /** Whether the chip is disabled */
  disabled?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS classes */
  className?: string;
}

// ============================================
// Component
// ============================================

export function FileChip({
  file,
  onRemove,
  readOnly = false,
  disabled = false,
  size = 'md',
  className
}: FileChipProps) {
  const { icon: Icon, colorClass } = getFileIcon(file.filename, file.mimeType);
  const iconSizeClass = getIconSizeClass(size);

  const isLoading = file.status === 'pending';
  const hasError = file.status === 'error';

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && onRemove) {
      onRemove(file);
    }
  };

  // Truncate long filenames for display
  const displayName = truncateFilename(file.filename, size === 'sm' ? 20 : 30);

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border transition-colors',
        // Size variants
        size === 'sm' && 'px-1.5 py-0.5 text-xs',
        size === 'md' && 'px-2 py-1 text-sm',
        size === 'lg' && 'px-2.5 py-1.5 text-sm',
        // State variants
        hasError
          ? 'border-destructive/50 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/50 text-foreground',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      title={hasError ? file.error : `${file.filename} (${formatFileSize(file.size)})`}
    >
      {/* File Icon or Loading Spinner */}
      {isLoading ? (
        <Loader2 className={cn(iconSizeClass, 'animate-spin text-muted-foreground')} />
      ) : (
        <Icon className={cn(iconSizeClass, hasError ? 'text-destructive' : colorClass)} />
      )}

      {/* Filename */}
      <span className="truncate max-w-[150px]">{displayName}</span>

      {/* File Size */}
      <span className={cn(
        'text-muted-foreground shrink-0',
        size === 'sm' ? 'text-[10px]' : 'text-xs'
      )}>
        {formatFileSize(file.size)}
      </span>

      {/* Remove Button */}
      {!readOnly && onRemove && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={disabled}
          className={cn(
            'shrink-0 rounded-sm opacity-70 transition-opacity',
            'hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring',
            disabled && 'cursor-not-allowed'
          )}
          aria-label={`Remove ${file.filename}`}
        >
          <X className={cn(
            size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'
          )} />
        </button>
      )}
    </div>
  );
}

// ============================================
// Utility Functions
// ============================================

/**
 * Truncate a filename while preserving the extension
 *
 * @param filename - The filename to truncate
 * @param maxLength - Maximum length of the result
 * @returns Truncated filename with extension preserved
 */
function truncateFilename(filename: string, maxLength: number): string {
  if (filename.length <= maxLength) {
    return filename;
  }

  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) {
    // No extension, just truncate
    return filename.substring(0, maxLength - 3) + '...';
  }

  const name = filename.substring(0, lastDot);
  const ext = filename.substring(lastDot);

  // If extension is too long, just truncate everything
  if (ext.length >= maxLength - 3) {
    return filename.substring(0, maxLength - 3) + '...';
  }

  // Truncate the name portion
  const availableForName = maxLength - ext.length - 3;
  if (availableForName <= 0) {
    return '...' + ext;
  }

  return name.substring(0, availableForName) + '...' + ext;
}

export default FileChip;
