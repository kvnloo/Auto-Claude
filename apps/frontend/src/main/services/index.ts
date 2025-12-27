/**
 * Main process services for autonomous mode
 */

// Task prioritization
export {
  // Types
  type PriorityWeights,
  type DependencyCycleInfo,
  type TopologicalSortResult,
  type PrioritizeTasksOptions,
  type PrioritizeTasksResult,
  // Constants
  DEFAULT_PRIORITY_WEIGHTS,
  // Priority calculation
  calculatePriorityScore,
  calculateRecencyScore,
  getPriorityLevel,
  createTaskPriority,
  // Dependency resolution
  detectDependencyCycles,
  resolveDependencies,
  hasUnmetDependencies,
  // Task prioritization
  prioritizeTasks,
  getNextTask,
  updateTaskPriorities,
  // Validation utilities
  validatePriorityWeights,
  // Score conversion utilities
  complexityToScore,
  impactToScore,
  moscowToScore,
  priorityFromLabels
} from './task-prioritizer';

// Autonomous queue manager
export {
  // Types
  type AutonomousQueueEvents,
  // Class
  AutonomousQueueManager,
  // Singleton accessors
  getAutonomousQueueManager,
  resetAutonomousQueueManager
} from './autonomous-queue-manager';
