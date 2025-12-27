/**
 * Central export point for all shared types
 */

// Common types
export * from './common';

// Domain-specific types
export * from './project';
export * from './task';
export * from './terminal';
export * from './agent';
export * from './settings';
export * from './changelog';
export * from './insights';
export * from './roadmap';
export * from './integrations';
export * from './app-update';

// Autonomous mode types - explicitly re-export to avoid conflict with task.ts
// task.ts has TaskStatus and TaskPriority for kanban tasks
// autonomous.ts has TaskStatus and TaskPriority for autonomous queue tasks
export {
  type TaskSourceProvider,
  type TaskSourceBase,
  type GitHubIssueSource,
  type RoadmapFeatureSource,
  type TaskSource,
  // Re-export with different names to avoid conflict
  type TaskStatus as AutonomousTaskStatus,
  type TaskPriorityLevel,
  type TaskPriority as AutonomousTaskPriorityScoring,
  type AutonomousTask,
  type QueueState,
  type QueuePauseReason,
  type QueueStatus,
  type SessionStats,
  type TaskProgressPhase,
  type TaskProgress,
  type AutonomousEventType,
  type AutonomousEvent,
  type TaskCompletedEvent,
  type TaskFailedEvent,
  type RateLimitEvent
} from './autonomous';

// IPC types (must be last to use types from other modules)
export * from './ipc';
