/**
 * Autonomous mode types for task queue management
 */

// ============================================
// Task Source Types
// ============================================

/**
 * Task source provider type - identifies where a task originated from.
 */
export type TaskSourceProvider = 'github_issue' | 'roadmap_feature';

/**
 * Base interface for task source with common fields.
 */
export interface TaskSourceBase {
  provider: TaskSourceProvider;
}

/**
 * GitHub Issue source with issue-specific fields.
 */
export interface GitHubIssueSource extends TaskSourceBase {
  provider: 'github_issue';
  /** GitHub issue number */
  issueNumber: number;
  /** Repository in owner/repo format */
  repository: string;
  /** URL to the GitHub issue */
  issueUrl: string;
  /** Labels on the issue */
  labels: string[];
}

/**
 * Roadmap feature source with feature-specific fields.
 */
export interface RoadmapFeatureSource extends TaskSourceBase {
  provider: 'roadmap_feature';
  /** Roadmap feature ID */
  featureId: string;
  /** Phase ID the feature belongs to */
  phaseId: string;
  /** Roadmap ID */
  roadmapId: string;
}

/**
 * Discriminated union for task sources.
 * Allows type-safe handling of different source types.
 */
export type TaskSource = GitHubIssueSource | RoadmapFeatureSource;

// ============================================
// Task Status Types
// ============================================

/**
 * Status of an autonomous task in the queue.
 * - pending: Task is waiting to be executed
 * - in_progress: Task is currently being executed
 * - completed: Task completed successfully (PR created)
 * - failed: Task execution failed
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// ============================================
// Task Priority Types
// ============================================

/**
 * Priority level categories for quick classification.
 */
export type TaskPriorityLevel = 'critical' | 'high' | 'medium' | 'low';

/**
 * Priority scoring inputs for task prioritization algorithm.
 * Score = complexity_weight * complexity + impact_weight * impact + priority_weight * priority + recency_score
 */
export interface TaskPriority {
  /**
   * Complexity score (1-10, lower = simpler, higher priority for quick wins)
   * Inverse relationship with priority - simpler tasks may be prioritized
   */
  complexity: number;

  /**
   * Impact score (1-10, higher = more impactful, higher priority)
   */
  impact: number;

  /**
   * Base priority level from source (1-10)
   * Derived from GitHub labels or roadmap priority
   */
  priority: number;

  /**
   * Recency score based on creation date (1-10)
   * Older items may get boosted to prevent starvation
   */
  recency: number;

  /**
   * Final calculated priority score
   * Higher score = higher priority in queue
   */
  score: number;

  /**
   * Human-readable priority level for UI display
   */
  level: TaskPriorityLevel;
}

// ============================================
// Autonomous Task Interface
// ============================================

/**
 * Represents a task in the autonomous execution queue.
 * Combines information from GitHub Issues or Roadmap features
 * into a unified format for queue processing.
 */
export interface AutonomousTask {
  /** Unique task identifier */
  id: string;

  /** Task title/summary */
  title: string;

  /** Detailed task description */
  description: string;

  /** Source information (GitHub Issue or Roadmap Feature) */
  source: TaskSource;

  /** Current execution status */
  status: TaskStatus;

  /** Priority scoring information */
  priority: TaskPriority;

  /**
   * IDs of tasks that must complete before this task can start.
   * Used for dependency resolution in task ordering.
   */
  dependencies: string[];

  /**
   * IDs of tasks that are blocked by this task.
   * Used for propagating completion notifications.
   */
  blockedBy: string[];

  /** When the task was created/added to the queue */
  createdAt: Date;

  /** When task execution started (undefined if pending) */
  startedAt?: Date;

  /** When task execution completed (undefined if not completed) */
  completedAt?: Date;

  /** Error message if task failed */
  error?: string;

  /** Generated spec ID if spec was created */
  specId?: string;

  /** Created PR URL if task completed successfully */
  pullRequestUrl?: string;

  /** Branch name created for this task */
  branchName?: string;

  /**
   * Number of retry attempts for this task.
   * Incremented on each failure and retry.
   */
  retryCount: number;

  /**
   * Maximum retry attempts before permanent failure.
   * Default: 2 (total 3 attempts)
   */
  maxRetries: number;
}

// ============================================
// Queue Status Types
// ============================================

/**
 * Current state of the autonomous queue.
 */
export type QueueState = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

/**
 * Reason for queue pause or stop.
 */
export type QueuePauseReason =
  | 'user_requested'
  | 'max_failures_reached'
  | 'session_time_limit'
  | 'token_budget_exhausted'
  | 'rate_limit_hit'
  | 'auth_expired'
  | 'critical_error';

/**
 * Overall status of the autonomous task queue.
 */
export interface QueueStatus {
  /** Current state of the queue */
  state: QueueState;

  /** Reason for pause/stop if applicable */
  pauseReason?: QueuePauseReason;

  /** Currently executing task (undefined if none) */
  currentTask?: AutonomousTask;

  /** Number of tasks waiting to be executed */
  pendingCount: number;

  /** Number of tasks currently in progress */
  inProgressCount: number;

  /** Number of tasks completed successfully */
  completedCount: number;

  /** Number of tasks that failed */
  failedCount: number;

  /** Total number of tasks in the queue (all statuses) */
  totalCount: number;

  /** Consecutive failure count (resets on success) */
  consecutiveFailures: number;

  /** When the queue was last updated */
  lastUpdated: Date;

  /** Next scheduled poll time (for new tasks) */
  nextPollAt?: Date;

  /** Error message if queue is in error state */
  error?: string;
}

// ============================================
// Session Statistics Types
// ============================================

/**
 * Statistics for the current autonomous session.
 * Tracks performance metrics and resource usage.
 */
export interface SessionStats {
  /** When the autonomous session started */
  sessionStartedAt: Date;

  /** Total elapsed time in milliseconds */
  elapsedTimeMs: number;

  /** Session time limit in milliseconds (from settings) */
  timeLimitMs: number;

  /** Remaining time in milliseconds before limit */
  remainingTimeMs: number;

  /** Number of tasks completed in this session */
  tasksCompleted: number;

  /** Number of tasks that failed in this session */
  tasksFailed: number;

  /** Number of tasks currently in progress */
  tasksInProgress: number;

  /** Number of tasks skipped (e.g., due to dependency issues) */
  tasksSkipped: number;

  /** Total tasks processed (completed + failed + skipped) */
  totalTasksProcessed: number;

  /** Number of PRs created in this session */
  pullRequestsCreated: number;

  /** Total tokens used in this session (estimated) */
  tokensUsed: number;

  /** Token budget limit (from settings, undefined = no limit) */
  tokenBudget?: number;

  /** Remaining token budget (undefined if no limit) */
  tokensRemaining?: number;

  /** Average task completion time in milliseconds */
  avgTaskDurationMs: number;

  /** Success rate (completed / (completed + failed)) as percentage */
  successRate: number;

  /** Number of API rate limit hits in this session */
  rateLimitHits: number;

  /** Last rate limit reset time if applicable */
  lastRateLimitResetAt?: Date;
}

// ============================================
// Progress Event Types
// ============================================

/**
 * Progress phases during task execution.
 */
export type TaskProgressPhase =
  | 'fetching'
  | 'prioritizing'
  | 'generating_spec'
  | 'planning'
  | 'implementing'
  | 'testing'
  | 'qa_review'
  | 'creating_pr'
  | 'updating_status'
  | 'completed'
  | 'failed';

/**
 * Progress update for a task during execution.
 */
export interface TaskProgress {
  /** Task ID */
  taskId: string;

  /** Current execution phase */
  phase: TaskProgressPhase;

  /** Progress within the current phase (0-100) */
  progress: number;

  /** Human-readable status message */
  message: string;

  /** Timestamp of this progress update */
  timestamp: Date;

  /** Additional details for the current phase */
  details?: string;
}

// ============================================
// Autonomous Mode Event Types
// ============================================

/**
 * Event types emitted by the autonomous mode system.
 */
export type AutonomousEventType =
  | 'queue_started'
  | 'queue_stopped'
  | 'queue_paused'
  | 'queue_resumed'
  | 'task_added'
  | 'task_removed'
  | 'task_started'
  | 'task_progress'
  | 'task_completed'
  | 'task_failed'
  | 'pr_created'
  | 'status_updated'
  | 'rate_limit_hit'
  | 'error';

/**
 * Base interface for autonomous mode events.
 */
export interface AutonomousEvent {
  /** Event type */
  type: AutonomousEventType;

  /** When the event occurred */
  timestamp: Date;

  /** Related task ID if applicable */
  taskId?: string;

  /** Event-specific payload */
  payload?: unknown;
}

/**
 * Event emitted when a task completes successfully.
 */
export interface TaskCompletedEvent extends AutonomousEvent {
  type: 'task_completed';
  taskId: string;
  payload: {
    task: AutonomousTask;
    pullRequestUrl?: string;
    duration: number;
  };
}

/**
 * Event emitted when a task fails.
 */
export interface TaskFailedEvent extends AutonomousEvent {
  type: 'task_failed';
  taskId: string;
  payload: {
    task: AutonomousTask;
    error: string;
    willRetry: boolean;
  };
}

/**
 * Event emitted when rate limit is hit.
 */
export interface RateLimitEvent extends AutonomousEvent {
  type: 'rate_limit_hit';
  payload: {
    resetAt: Date;
    remainingRequests: number;
  };
}
