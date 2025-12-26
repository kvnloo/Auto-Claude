/**
 * FileAttachmentList component for displaying a list of file attachments
 *
 * Used to show attached files in the Insights chat input area and in
 * historical messages. Supports both editable (with remove) and read-only modes.
 */

import { X, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { FileChip } from './FileChip';
import { Button } from './ui/button';
import { MAX_FILES_PER_MESSAGE, getRemainingSlots, canAddMoreFiles } from '../utils/fileValidation';
import type { AttachedFile } from '../../shared/types';

// ============================================
// Types
// ============================================

export interface FileAttachmentListProps {
  /** Array of file attachments to display */
  files: AttachedFile[];
  /** Callback when a file should be removed */
  onRemove?: (file: AttachedFile) => void;
  /** Callback to clear all files */
  onClearAll?: () => void;
  /** Whether the list is read-only (no remove buttons) */
  readOnly?: boolean;
  /** Whether interactions are disabled */
  disabled?: boolean;
  /** Size variant for file chips */
  size?: 'sm' | 'md' | 'lg';
  /** Error message to display */
  error?: string | null;
  /** Clear error callback */
  onClearError?: () => void;
  /** Whether to show the file count and limits */
  showCount?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ============================================
// Component
// ============================================

export function FileAttachmentList({
  files,
  onRemove,
  onClearAll,
  readOnly = false,
  disabled = false,
  size = 'md',
  error,
  onClearError,
  showCount = false,
  className
}: FileAttachmentListProps) {
  // Don't render anything if there are no files and no error
  if (files.length === 0 && !error) {
    return null;
  }

  const remainingSlots = getRemainingSlots(files.length);
  const canAddMore = canAddMoreFiles(files.length);
  const hasMultipleFiles = files.length > 1;

  const handleRemove = (file: AttachedFile) => {
    if (!disabled && onRemove) {
      onRemove(file);
      // Clear error when a file is removed (user might be fixing the issue)
      if (onClearError) {
        onClearError();
      }
    }
  };

  const handleClearAll = () => {
    if (!disabled && onClearAll) {
      onClearAll();
      if (onClearError) {
        onClearError();
      }
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          {onClearError && (
            <button
              type="button"
              onClick={onClearError}
              className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {/* Header with count and clear all */}
          {(showCount || (!readOnly && hasMultipleFiles && onClearAll)) && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {showCount && (
                <span>
                  {files.length} file{files.length !== 1 ? 's' : ''} attached
                  {!readOnly && (
                    <span className="ml-1">
                      ({remainingSlots} remaining)
                    </span>
                  )}
                </span>
              )}
              {!readOnly && hasMultipleFiles && onClearAll && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto py-0.5 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                  onClick={handleClearAll}
                  disabled={disabled}
                >
                  Clear all
                </Button>
              )}
            </div>
          )}

          {/* File chips */}
          <div className="flex flex-wrap gap-1.5">
            {files.map((file) => (
              <FileChip
                key={file.id}
                file={file}
                onRemove={!readOnly ? handleRemove : undefined}
                readOnly={readOnly}
                disabled={disabled}
                size={size}
              />
            ))}
          </div>

          {/* Limit warning */}
          {!readOnly && !canAddMore && (
            <p className="text-xs text-warning flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Maximum of {MAX_FILES_PER_MESSAGE} files per message
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default FileAttachmentList;
