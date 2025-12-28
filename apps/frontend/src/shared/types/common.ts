/**
 * Common utility types shared across the application
 */

// IPC Types
export interface IPCResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Optional statistics about the operation (e.g., parser performance) */
  stats?: {
    oxcFiles?: number;
    treeSitterFiles?: number;
    totalParseTime?: number;
    filesPerSecond?: number;
  };
  /** Detailed error information with user-friendly messages and suggestions */
  errorDetails?: {
    type: string;
    title: string;
    description: string;
    suggestions: string[];
    technicalDetails?: string;
  };
}
