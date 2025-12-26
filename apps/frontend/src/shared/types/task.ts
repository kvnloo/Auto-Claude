/**
 * Task-related types
 */

import type { ThinkingLevel, PhaseModelConfig, PhaseThinkingConfig } from './settings';

export type TaskStatus = 'backlog' | 'in_progress' | 'ai_review' | 'human_review' | 'done';

// Reason why a task is in human_review status
// - 'completed': All subtasks done and QA passed, ready for final approval/merge
// - 'errors': Subtasks failed during execution
// - 'qa_rejected': QA found issues that need fixing
// - 'plan_review': Spec/plan created and awaiting approval before coding starts
export type ReviewReason = 'completed' | 'errors' | 'qa_rejected' | 'plan_review';

export type SubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// Execution phases for visual progress tracking
export type ExecutionPhase = 'idle' | 'planning' | 'coding' | 'qa_review' | 'qa_fixing' | 'complete' | 'failed';

export interface ExecutionProgress {
  phase: ExecutionPhase;
  phaseProgress: number;  // 0-100 within current phase
  overallProgress: number;  // 0-100 overall
  currentSubtask?: string;  // Current subtask being processed
  message?: string;  // Current status message
  startedAt?: Date;
}

export interface Subtask {
  id: string;
  title: string;
  description: string;
  status: SubtaskStatus;
  files: string[];
  verification?: {
    type: 'command' | 'browser';
    run?: string;
    scenario?: string;
  };
}

export interface QAReport {
  status: 'passed' | 'failed' | 'pending';
  issues: QAIssue[];
  timestamp: Date;
}

export interface QAIssue {
  id: string;
  severity: 'critical' | 'major' | 'minor';
  description: string;
  file?: string;
  line?: number;
}

// Task Log Types - for persistent, phase-based logging
export type TaskLogPhase = 'planning' | 'coding' | 'validation';
export type TaskLogPhaseStatus = 'pending' | 'active' | 'completed' | 'failed';
export type TaskLogEntryType = 'text' | 'tool_start' | 'tool_end' | 'phase_start' | 'phase_end' | 'error' | 'success' | 'info';

export interface TaskLogEntry {
  timestamp: string;
  type: TaskLogEntryType;
  content: string;
  phase: TaskLogPhase;
  tool_name?: string;
  tool_input?: string;
  subtask_id?: string;
  session?: number;
  // Fields for expandable detail view
  detail?: string;  // Full content that can be expanded (e.g., file contents, command output)
  subphase?: string;  // Subphase grouping (e.g., "PROJECT DISCOVERY", "CONTEXT GATHERING")
  collapsed?: boolean;  // Whether to show collapsed by default in UI
}

export interface TaskPhaseLog {
  phase: TaskLogPhase;
  status: TaskLogPhaseStatus;
  started_at: string | null;
  completed_at: string | null;
  entries: TaskLogEntry[];
}

export interface TaskLogs {
  spec_id: string;
  created_at: string;
  updated_at: string;
  phases: {
    planning: TaskPhaseLog;
    coding: TaskPhaseLog;
    validation: TaskPhaseLog;
  };
}

// Streaming markers from Python (similar to InsightsStreamChunk)
export interface TaskLogStreamChunk {
  type: 'text' | 'tool_start' | 'tool_end' | 'phase_start' | 'phase_end' | 'error';
  content?: string;
  phase?: TaskLogPhase;
  timestamp?: string;
  tool?: {
    name: string;
    input?: string;
    success?: boolean;
  };
  subtask_id?: string;
}

// Image attachment types for task creation
export interface ImageAttachment {
  id: string;           // Unique identifier (UUID)
  filename: string;     // Original filename
  mimeType: string;     // e.g., 'image/png'
  size: number;         // Size in bytes
  data?: string;        // Base64 data (for transport)
  path?: string;        // Relative path after storage
  thumbnail?: string;   // Base64 thumbnail for preview
}

// Referenced file types for task creation (files/folders from project)
export interface ReferencedFile {
  id: string;           // Unique identifier (UUID)
  path: string;         // Relative path from project root
  name: string;         // File or folder name
  isDirectory: boolean; // True if this is a directory
  addedAt: Date;        // When the file was added as reference
}

// Draft state for task creation (auto-saved when dialog closes)
export interface TaskDraft {
  projectId: string;
  title: string;
  description: string;
  category: TaskCategory | '';
  priority: TaskPriority | '';
  complexity: TaskComplexity | '';
  impact: TaskImpact | '';
  profileId?: string;  // Agent profile ID ('auto', 'complex', 'balanced', 'quick', 'custom')
  model: ModelType | '';
  thinkingLevel: ThinkingLevel | '';
  // Auto profile - per-phase configuration
  phaseModels?: PhaseModelConfig;
  phaseThinking?: PhaseThinkingConfig;
  images: ImageAttachment[];
  referencedFiles: ReferencedFile[];
  requireReviewBeforeCoding?: boolean;
  savedAt: Date;
}

// Task metadata from ideation or manual entry
export type TaskComplexity = 'trivial' | 'small' | 'medium' | 'large' | 'complex';
export type TaskImpact = 'low' | 'medium' | 'high' | 'critical';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
// Re-export ThinkingLevel (defined in settings.ts) for convenience
export type { ThinkingLevel };
export type ModelType = 'haiku' | 'sonnet' | 'opus';
export type TaskCategory =
  | 'feature'
  | 'bug_fix'
  | 'refactoring'
  | 'documentation'
  | 'security'
  | 'performance'
  | 'ui_ux'
  | 'infrastructure'
  | 'testing';

export interface TaskMetadata {
  // Origin tracking
  sourceType?: 'ideation' | 'manual' | 'imported' | 'insights' | 'roadmap' | 'linear' | 'github';
  ideationType?: string;  // e.g., 'code_improvements', 'security_hardening'
  ideaId?: string;  // Reference to original idea if converted
  featureId?: string;  // Reference to roadmap feature if from roadmap
  linearIssueId?: string;  // Reference to Linear issue if from Linear
  linearIdentifier?: string;  // Linear issue identifier (e.g., 'ABC-123')
  linearUrl?: string;  // Linear issue URL
  githubIssueNumber?: number;  // Reference to GitHub issue number if from GitHub (single issue)
  githubIssueNumbers?: number[];  // Reference to multiple GitHub issues if from a batch
  githubUrl?: string;  // GitHub issue URL
  githubBatchTheme?: string;  // Theme/title of the GitHub issue batch

  // Classification
  category?: TaskCategory;
  complexity?: TaskComplexity;
  impact?: TaskImpact;
  priority?: TaskPriority;

  // Context
  rationale?: string;  // Why this task matters
  problemSolved?: string;  // What problem this addresses
  targetAudience?: string;  // Who benefits

  // Technical details
  affectedFiles?: string[];  // Files likely to be modified
  dependencies?: string[];  // Other features/tasks this depends on
  acceptanceCriteria?: string[];  // What defines "done"

  // Effort estimation
  estimatedEffort?: TaskComplexity;

  // Type-specific metadata (from different idea types)
  securitySeverity?: 'low' | 'medium' | 'high' | 'critical';
  performanceCategory?: string;
  uiuxCategory?: string;
  codeQualitySeverity?: 'suggestion' | 'minor' | 'major' | 'critical';

  // Image attachments (screenshots, mockups, diagrams)
  attachedImages?: ImageAttachment[];

  // Referenced files (files/folders from project for context)
  referencedFiles?: ReferencedFile[];

  // Review settings
  requireReviewBeforeCoding?: boolean;  // Require human review of spec/plan before coding starts

  // Agent configuration (from agent profile or manual selection)
  model?: ModelType;  // Claude model to use (haiku, sonnet, opus) - used when not auto profile
  thinkingLevel?: ThinkingLevel;  // Thinking budget level (none, low, medium, high, ultrathink)
  // Auto profile - per-phase model configuration
  isAutoProfile?: boolean;  // True when using Auto (Optimized) profile
  phaseModels?: PhaseModelConfig;  // Per-phase model configuration
  phaseThinking?: PhaseThinkingConfig;  // Per-phase thinking configuration

  // Git/Worktree configuration
  baseBranch?: string;  // Override base branch for this task's worktree

  // Archive status
  archivedAt?: string;  // ISO date when task was archived
  archivedInVersion?: string;  // Version in which task was archived (from changelog)
}

export interface Task {
  id: string;
  specId: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  reviewReason?: ReviewReason;  // Why task needs human review (only set when status is 'human_review')
  subtasks: Subtask[];
  qaReport?: QAReport;
  logs: string[];
  metadata?: TaskMetadata;  // Rich metadata from ideation or manual entry
  executionProgress?: ExecutionProgress;  // Real-time execution progress
  releasedInVersion?: string;  // Version in which this task was released
  stagedInMainProject?: boolean;  // True if changes were staged to main project (worktree merged with --no-commit)
  stagedAt?: string;  // ISO timestamp when changes were staged
  location?: 'main' | 'worktree';  // Where task was loaded from (main project or worktree)
  specsPath?: string;  // Full path to specs directory for this task
  createdAt: Date;
  updatedAt: Date;
}

// Implementation Plan (from auto-claude)
export interface ImplementationPlan {
  feature?: string;  // Some plans use 'feature', some use 'title'
  title?: string;    // Alternative to 'feature' for task name
  workflow_type: string;
  services_involved?: string[];
  phases: Phase[];
  final_acceptance: string[];
  created_at: string;
  updated_at: string;
  spec_file: string;
  // Added for UI status persistence
  status?: TaskStatus;
  planStatus?: string;
  recoveryNote?: string;
  description?: string;
}

export interface Phase {
  phase: number;
  name: string;
  type: string;
  subtasks: PlanSubtask[];
  depends_on?: number[];
}

export interface PlanSubtask {
  id: string;
  description: string;
  status: SubtaskStatus;
  verification?: {
    type: string;
    run?: string;
    scenario?: string;
  };
}

// Workspace management types (for human review)
export interface WorktreeStatus {
  exists: boolean;
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  commitCount?: number;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
}

export interface WorktreeDiff {
  files: WorktreeDiffFile[];
  summary: string;
}

export interface WorktreeDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

// Conflict severity levels from merge system
export type ConflictSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

// Type of conflict
export type ConflictType = 'semantic' | 'git';

// Information about a detected conflict
export interface MergeConflict {
  file: string;
  location: string;
  tasks: string[];
  severity: ConflictSeverity;
  canAutoMerge: boolean;
  strategy?: string;
  reason: string;
  type?: ConflictType; // 'semantic' = parallel task conflict, 'git' = branch divergence
}

// Path-mapped file that needs AI merge due to rename
export interface PathMappedAIMerge {
  oldPath: string;
  newPath: string;
  reason: string;
}

// Git-level conflict information (branch divergence)
export interface GitConflictInfo {
  hasConflicts: boolean;
  conflictingFiles: string[];
  needsRebase: boolean;
  commitsBehind: number;
  baseBranch: string;
  specBranch: string;
  // Files that need AI merge due to path mappings (file renames)
  pathMappedAIMerges?: PathMappedAIMerge[];
  // Total number of file renames detected
  totalRenames?: number;
}

// Summary statistics from merge preview/execution
export interface MergeStats {
  totalFiles: number;
  conflictFiles: number;
  totalConflicts: number;
  autoMergeable: number;
  aiResolved?: number;
  humanRequired?: number;
  hasGitConflicts?: boolean; // True if there are git-level conflicts requiring rebase
  // Count of files needing AI merge due to path mappings (file renames)
  pathMappedAIMergeCount?: number;
}

export interface WorktreeMergeResult {
  success: boolean;
  message: string;
  merged?: boolean;
  conflictFiles?: string[];
  staged?: boolean;
  alreadyStaged?: boolean;
  projectPath?: string;
  // AI-generated commit message suggestion (for stage-only mode)
  suggestedCommitMessage?: string;
  // New conflict info from smart merge
  conflicts?: MergeConflict[];
  stats?: MergeStats;
  gitConflicts?: GitConflictInfo; // Git-level conflict info
  // Preview mode results
  preview?: {
    files: string[];
    conflicts: MergeConflict[];
    summary: MergeStats;
    gitConflicts?: GitConflictInfo;
    // Uncommitted changes in the main project that could block merge
    uncommittedChanges?: {
      hasChanges: boolean;
      files: string[];
      count: number;
    } | null;
  };
}

export interface WorktreeDiscardResult {
  success: boolean;
  message: string;
}

/**
 * Information about a single spec worktree
 * Per-spec architecture: Each spec has its own worktree at .worktrees/{spec-name}/
 */
export interface WorktreeListItem {
  specName: string;
  path: string;
  branch: string;
  baseBranch: string;
  commitCount: number;
  filesChanged: number;
  additions: number;
  deletions: number;
}

/**
 * Result of listing all spec worktrees
 */
export interface WorktreeListResult {
  worktrees: WorktreeListItem[];
}

// Stuck task recovery types
export interface StuckTaskInfo {
  taskId: string;
  specId: string;
  title: string;
  status: TaskStatus;
  isActuallyRunning: boolean;
  lastUpdated: Date;
}

export interface TaskRecoveryResult {
  taskId: string;
  recovered: boolean;
  newStatus: TaskStatus;
  message: string;
  autoRestarted?: boolean;
}

export interface TaskRecoveryOptions {
  targetStatus?: TaskStatus;
  autoRestart?: boolean;
}

export interface TaskProgressUpdate {
  taskId: string;
  plan: ImplementationPlan;
  currentSubtask?: string;
}

export interface TaskStartOptions {
  parallel?: boolean;
  workers?: number;
  model?: string;
  baseBranch?: string; // Override base branch for worktree creation
}

// =============================================================================
// Merge Tracking Types
// =============================================================================
// Types for real-time merge progress tracking and history persistence.
// These complement the existing MergeConflict/MergeStats types used for
// smart merge conflict analysis.

/**
 * Current status of a merge operation.
 * These states represent the lifecycle of a merge:
 * - idle: No merge in progress
 * - merging: Merge operation is running
 * - resolving: Conflicts are being resolved
 * - complete: Merge finished successfully
 * - failed: Merge failed (unresolved conflicts or error)
 * - timeout: Merge exceeded time limit
 */
export type MergeStatus = 'idle' | 'merging' | 'resolving' | 'complete' | 'failed' | 'timeout';

/**
 * Health indicator for merge outcomes.
 * Three-state system providing nuanced merge status:
 * - pass: Clean merge with no conflicts (green)
 * - warning: Conflicts occurred but were resolved (yellow)
 * - fail: Unresolved conflicts remain (red)
 */
export type MergeHealth = 'pass' | 'warning' | 'fail';

/**
 * Simple conflict tracking for merge progress.
 * This is separate from the detailed MergeConflict used in smart merge
 * analysis - this type is optimized for progress tracking and history.
 */
export interface MergeProgressConflict {
  filePath: string;          // Path to the file with the conflict
  resolved: boolean;         // Whether the conflict has been resolved
  resolutionMethod?: string; // How resolved: 'auto', 'ai', 'manual'
  details?: string;          // Additional information about the conflict
}

/**
 * Real-time merge progress tracking for UI updates.
 * Used by the Zustand store to track active merge operations.
 */
export interface MergeProgress {
  taskId: string;            // The task whose changes are being merged
  status: MergeStatus;       // Current status of the merge
  health: MergeHealth;       // Health indicator based on conflicts
  progress: number;          // Progress percentage (0-100)
  currentStep?: string;      // Description of current merge step
  conflicts: MergeProgressConflict[];  // Conflicts encountered
  conflictsResolved: number; // Count of resolved conflicts
  startedAt?: string;        // ISO timestamp when merge began
  elapsedTime?: number;      // Elapsed time in milliseconds
}

/**
 * Complete record of a single merge attempt.
 * Used for merge history persistence and retrieval.
 */
export interface MergeAttempt {
  id: string;                 // Unique identifier for this merge attempt
  taskId: string;             // The task whose changes were merged
  worktreePath: string;       // Path to the worktree being merged
  startedAt: string;          // ISO timestamp when merge began
  completedAt?: string;       // ISO timestamp when merge finished
  status: MergeStatus;        // Final status of the merge
  health: MergeHealth;        // Health indicator based on conflict resolution
  conflicts: MergeProgressConflict[];  // Conflicts encountered during merge
  progressPercent: number;    // Final progress (should be 100 if complete)
  currentStep?: string;       // Last step description
  errorMessage?: string;      // Error details if merge failed
  isFastForward: boolean;     // Whether this was a fast-forward merge
  commitHash?: string;        // The resulting merge commit hash (if successful)
  durationSeconds: number;    // Total time taken for the merge
}

/**
 * Helper function to calculate merge health from conflict statistics.
 */
export function calculateMergeHealth(
  conflictsDetected: number,
  conflictsResolved: number
): MergeHealth {
  if (conflictsDetected === 0) {
    return 'pass'; // Clean merge
  } else if (conflictsResolved >= conflictsDetected) {
    return 'warning'; // Conflicts but all resolved
  } else {
    return 'fail'; // Unresolved conflicts remain
  }
}

/**
 * Result of listing tasks with merge history.
 */
export interface MergeHistoryListResult {
  taskIds: string[];
}

/**
 * Summary statistics for merge history.
 * Aggregated stats across all merge attempts.
 */
export interface MergeHistoryStats {
  totalTasks: number;
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  timeoutAttempts: number;
  successRate: number;
  totalConflicts: number;
  resolvedConflicts: number;
  conflictResolutionRate: number;
}
