/**
 * Task Prioritizer Service
 * =========================
 *
 * Implements priority scoring algorithm and dependency resolution for autonomous mode.
 * Provides functions to calculate task priority scores, resolve dependencies using
 * topological sort, and detect dependency cycles.
 *
 * Priority Score Formula:
 *   score = complexity_weight * complexity + impact_weight * impact +
 *           priority_weight * priority + recency_weight * recency_score
 *
 * Where:
 *   - complexity is inverted (10 - complexity) so simpler tasks get higher priority
 *   - recency_score increases with age to prevent task starvation
 */

import type {
  AutonomousTask,
  TaskPriority,
  TaskPriorityLevel,
  TaskStatus
} from '../../shared/types/autonomous';

// ============================================
// Priority Weights Configuration
// ============================================

/**
 * Configurable weights for priority score calculation.
 * All weights should sum to 1.0 for normalized scoring.
 */
export interface PriorityWeights {
  /** Weight for complexity factor (default: 0.15) */
  complexityWeight: number;
  /** Weight for impact factor (default: 0.35) */
  impactWeight: number;
  /** Weight for priority factor (default: 0.35) */
  priorityWeight: number;
  /** Weight for recency factor (default: 0.15) */
  recencyWeight: number;
}

/**
 * Default priority weights that sum to 1.0.
 * Impact and priority are weighted higher as they represent business value.
 */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  complexityWeight: 0.15,
  impactWeight: 0.35,
  priorityWeight: 0.35,
  recencyWeight: 0.15
};

// ============================================
// Priority Score Calculation
// ============================================

/**
 * Clamp a value to a valid range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate recency score based on task age.
 * Older tasks get higher scores to prevent starvation.
 *
 * @param createdAt - When the task was created
 * @param maxAgeDays - Maximum age for full recency boost (default: 90 days)
 * @returns Recency score from 1 to 10
 */
export function calculateRecencyScore(
  createdAt: Date,
  maxAgeDays: number = 90
): number {
  const now = new Date();
  const ageMs = now.getTime() - createdAt.getTime();
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));

  // Calculate ratio of age to max age (capped at 1.0)
  const ageRatio = Math.min(1.0, ageDays / maxAgeDays);

  // Scale to 1-10 range (older = higher score)
  return 1 + ageRatio * 9;
}

/**
 * Calculate the priority score for a task using weighted formula.
 *
 * Score = (complexityWeight * invertedComplexity)
 *       + (impactWeight * impact)
 *       + (priorityWeight * priority)
 *       + (recencyWeight * recencyScore)
 *
 * @param complexity - Task complexity score (1-10, lower = simpler)
 * @param impact - Expected impact score (1-10, higher = more impactful)
 * @param priority - Base priority level (1-10)
 * @param createdAt - When the task was created
 * @param weights - Optional custom weights (defaults to DEFAULT_PRIORITY_WEIGHTS)
 * @param maxAgeDays - Maximum age for recency scoring (default: 90)
 * @returns Priority score (0-10, higher = higher priority)
 */
export function calculatePriorityScore(
  complexity: number,
  impact: number,
  priority: number,
  createdAt: Date,
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
  maxAgeDays: number = 90
): number {
  // Clamp inputs to valid range (1-10)
  const clampedComplexity = clamp(complexity, 1, 10);
  const clampedImpact = clamp(impact, 1, 10);
  const clampedPriority = clamp(priority, 1, 10);

  // Invert complexity (simpler = higher score for quick wins)
  // Range: 1-10 (complexity 10 -> 1, complexity 1 -> 10)
  const invertedComplexity = 10 - clampedComplexity + 1;

  // Calculate recency score
  const recencyScore = calculateRecencyScore(createdAt, maxAgeDays);

  // Calculate weighted score
  const score =
    weights.complexityWeight * invertedComplexity +
    weights.impactWeight * clampedImpact +
    weights.priorityWeight * clampedPriority +
    weights.recencyWeight * recencyScore;

  // Round to 2 decimal places
  return Math.round(score * 100) / 100;
}

/**
 * Get the priority level category from a numeric score.
 *
 * @param score - Priority score (0-10)
 * @returns Priority level category
 */
export function getPriorityLevel(score: number): TaskPriorityLevel {
  if (score >= 8.5) return 'critical';
  if (score >= 6.5) return 'high';
  if (score >= 4.5) return 'medium';
  return 'low';
}

/**
 * Create a TaskPriority object from scoring inputs.
 *
 * @param complexity - Task complexity (1-10)
 * @param impact - Task impact (1-10)
 * @param priority - Task priority (1-10)
 * @param createdAt - Task creation date
 * @param weights - Optional custom weights
 * @returns Complete TaskPriority object
 */
export function createTaskPriority(
  complexity: number,
  impact: number,
  priority: number,
  createdAt: Date,
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS
): TaskPriority {
  const recency = calculateRecencyScore(createdAt);
  const score = calculatePriorityScore(complexity, impact, priority, createdAt, weights);
  const level = getPriorityLevel(score);

  return {
    complexity: clamp(complexity, 1, 10),
    impact: clamp(impact, 1, 10),
    priority: clamp(priority, 1, 10),
    recency: Math.round(recency * 100) / 100,
    score,
    level
  };
}

// ============================================
// Dependency Resolution
// ============================================

/**
 * Result of dependency cycle detection.
 */
export interface DependencyCycleInfo {
  /** Whether any cycles were detected */
  hasCycles: boolean;
  /** List of detected cycles (each cycle is an array of task IDs forming the cycle) */
  cycles: string[][];
  /** Task IDs that are part of any cycle */
  affectedTaskIds: Set<string>;
}

/**
 * Node color states for cycle detection DFS.
 */
type NodeColor = 'white' | 'gray' | 'black';

/**
 * Detect dependency cycles in the task graph using DFS with coloring.
 *
 * Uses the standard 3-color DFS algorithm:
 * - WHITE: Node not yet visited
 * - GRAY: Node currently being processed (in current DFS path)
 * - BLACK: Node and all descendants fully processed
 *
 * A cycle exists when we encounter a GRAY node during DFS.
 *
 * @param tasks - List of tasks to check for cycles
 * @returns Cycle detection result with affected task IDs
 */
export function detectDependencyCycles(tasks: AutonomousTask[]): DependencyCycleInfo {
  // Build task ID set for validation
  const taskIds = new Set(tasks.map((t) => t.id));

  // Build adjacency list (task -> tasks it depends on)
  const adjacencyList = new Map<string, string[]>();
  for (const task of tasks) {
    // Only include dependencies that exist in our task list
    const validDeps = task.dependencies.filter((dep) => taskIds.has(dep));
    adjacencyList.set(task.id, validDeps);
  }

  // Track node colors for DFS
  const colors = new Map<string, NodeColor>();
  for (const taskId of Array.from(taskIds)) {
    colors.set(taskId, 'white');
  }

  // Track detected cycles and affected tasks
  const cycles: string[][] = [];
  const affectedTaskIds = new Set<string>();

  // DFS helper to detect cycles
  function dfs(nodeId: string, path: string[]): boolean {
    colors.set(nodeId, 'gray');
    path.push(nodeId);

    const neighbors = adjacencyList.get(nodeId) || [];
    for (const neighbor of neighbors) {
      const neighborColor = colors.get(neighbor);

      if (neighborColor === 'gray') {
        // Found a cycle! Extract the cycle from the path
        const cycleStartIndex = path.indexOf(neighbor);
        const cycle = path.slice(cycleStartIndex);
        cycle.push(neighbor); // Complete the cycle
        cycles.push(cycle);

        // Mark all tasks in cycle as affected
        for (const taskId of cycle) {
          affectedTaskIds.add(taskId);
        }
        return true;
      }

      if (neighborColor === 'white') {
        // Continue DFS
        if (dfs(neighbor, path)) {
          // Cycle was found in subtree
          return true;
        }
      }
      // If BLACK, skip (already fully processed)
    }

    colors.set(nodeId, 'black');
    path.pop();
    return false;
  }

  // Run DFS from each unvisited node
  for (const taskId of Array.from(taskIds)) {
    if (colors.get(taskId) === 'white') {
      dfs(taskId, []);
    }
  }

  return {
    hasCycles: cycles.length > 0,
    cycles,
    affectedTaskIds
  };
}

/**
 * Result of topological sort.
 */
export interface TopologicalSortResult {
  /** Sorted task IDs in execution order (dependencies first) */
  sortedIds: string[];
  /** Whether the sort was successful (no cycles) */
  success: boolean;
  /** Cycle info if sort failed due to cycles */
  cycleInfo?: DependencyCycleInfo;
}

/**
 * Perform topological sort on tasks based on dependencies.
 * Uses Kahn's algorithm for efficient O(V + E) sorting.
 *
 * Returns tasks in execution order where all dependencies come before
 * dependent tasks.
 *
 * @param tasks - List of tasks to sort
 * @returns Topological sort result with ordered task IDs
 */
export function resolveDependencies(tasks: AutonomousTask[]): TopologicalSortResult {
  // First check for cycles
  const cycleInfo = detectDependencyCycles(tasks);
  if (cycleInfo.hasCycles) {
    return {
      sortedIds: [],
      success: false,
      cycleInfo
    };
  }

  // Build task ID set for validation
  const taskIds = new Set(tasks.map((t) => t.id));

  // Build adjacency list and in-degree count
  // adjacencyList: task -> tasks that depend on it (reverse direction for Kahn's)
  const adjacencyList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  for (const task of tasks) {
    adjacencyList.set(task.id, []);
    inDegree.set(task.id, 0);
  }

  // Build graph
  for (const task of tasks) {
    // Only count dependencies that exist in our task list
    const validDeps = task.dependencies.filter((dep) => taskIds.has(dep));
    inDegree.set(task.id, validDeps.length);

    // Add reverse edges (dependency -> dependent)
    for (const dep of validDeps) {
      const dependents = adjacencyList.get(dep) || [];
      dependents.push(task.id);
      adjacencyList.set(dep, dependents);
    }
  }

  // Kahn's algorithm
  const sortedIds: string[] = [];
  const queue: string[] = [];

  // Find all nodes with no incoming edges (no dependencies)
  for (const [taskId, degree] of Array.from(inDegree.entries())) {
    if (degree === 0) {
      queue.push(taskId);
    }
  }

  // Process queue
  while (queue.length > 0) {
    const current = queue.shift()!;
    sortedIds.push(current);

    // Reduce in-degree for dependents
    const dependents = adjacencyList.get(current) || [];
    for (const dependent of dependents) {
      const newDegree = (inDegree.get(dependent) || 0) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  return {
    sortedIds,
    success: sortedIds.length === tasks.length
  };
}

// ============================================
// Task Prioritization
// ============================================

/**
 * Options for task prioritization.
 */
export interface PrioritizeTasksOptions {
  /** Custom priority weights */
  weights?: PriorityWeights;
  /** Set of completed task IDs for dependency checking */
  completedTaskIds?: Set<string>;
  /** Whether to consider dependencies in sorting */
  considerDependencies?: boolean;
}

/**
 * Result of task prioritization.
 */
export interface PrioritizeTasksResult {
  /** Tasks sorted by priority (highest first), respecting dependencies */
  tasks: AutonomousTask[];
  /** Tasks that are ready to execute (no unmet dependencies) */
  readyTasks: AutonomousTask[];
  /** Tasks blocked by unmet dependencies */
  blockedTasks: AutonomousTask[];
  /** Cycle information if any cycles were detected */
  cycleInfo?: DependencyCycleInfo;
}

/**
 * Check if a task has unmet dependencies.
 *
 * @param task - Task to check
 * @param completedTaskIds - Set of completed task IDs
 * @param allTaskIds - Set of all task IDs in the queue
 * @returns True if task has dependencies that aren't completed
 */
export function hasUnmetDependencies(
  task: AutonomousTask,
  completedTaskIds: Set<string>,
  allTaskIds: Set<string>
): boolean {
  if (task.dependencies.length === 0) {
    return false;
  }

  // Only check dependencies that exist in our task list
  for (const dep of task.dependencies) {
    if (allTaskIds.has(dep) && !completedTaskIds.has(dep)) {
      return true;
    }
  }
  return false;
}

/**
 * Prioritize tasks based on priority score and dependencies.
 *
 * This function:
 * 1. Detects any dependency cycles
 * 2. Separates tasks into ready (no unmet dependencies) and blocked
 * 3. Sorts each group by priority score (highest first)
 * 4. Returns ready tasks before blocked tasks
 *
 * @param tasks - List of tasks to prioritize
 * @param options - Prioritization options
 * @returns Prioritization result with sorted tasks
 */
export function prioritizeTasks(
  tasks: AutonomousTask[],
  options: PrioritizeTasksOptions = {}
): PrioritizeTasksResult {
  const {
    completedTaskIds = new Set<string>(),
    considerDependencies = true
  } = options;

  // Build set of all task IDs
  const allTaskIds = new Set(tasks.map((t) => t.id));

  // Detect cycles
  const cycleInfo = detectDependencyCycles(tasks);

  // Filter out tasks that are in cycles (they can't be executed)
  const executableTasks = cycleInfo.hasCycles
    ? tasks.filter((t) => !cycleInfo.affectedTaskIds.has(t.id))
    : tasks;

  // Filter to only pending tasks
  const pendingTasks = executableTasks.filter((t) => t.status === 'pending');

  // Separate into ready and blocked tasks
  const readyTasks: AutonomousTask[] = [];
  const blockedTasks: AutonomousTask[] = [];

  for (const task of pendingTasks) {
    if (considerDependencies && hasUnmetDependencies(task, completedTaskIds, allTaskIds)) {
      blockedTasks.push(task);
    } else {
      readyTasks.push(task);
    }
  }

  // Sort each group by priority score (highest first)
  const sortByPriority = (a: AutonomousTask, b: AutonomousTask): number => {
    return b.priority.score - a.priority.score;
  };

  readyTasks.sort(sortByPriority);
  blockedTasks.sort(sortByPriority);

  // Combine: ready tasks first, then blocked tasks
  const sortedTasks = [...readyTasks, ...blockedTasks];

  return {
    tasks: sortedTasks,
    readyTasks,
    blockedTasks,
    cycleInfo: cycleInfo.hasCycles ? cycleInfo : undefined
  };
}

/**
 * Get the next task to execute from a prioritized list.
 * Returns the highest priority task that is ready to execute.
 *
 * @param tasks - List of all tasks
 * @param completedTaskIds - Set of completed task IDs
 * @returns The next task to execute, or undefined if none are ready
 */
export function getNextTask(
  tasks: AutonomousTask[],
  completedTaskIds: Set<string> = new Set()
): AutonomousTask | undefined {
  const result = prioritizeTasks(tasks, { completedTaskIds });
  return result.readyTasks[0];
}

/**
 * Update task priority scores for all tasks.
 * Useful when weights change or time has passed (affecting recency).
 *
 * @param tasks - List of tasks to update
 * @param weights - Priority weights to use
 * @returns Updated tasks with new priority scores
 */
export function updateTaskPriorities(
  tasks: AutonomousTask[],
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS
): AutonomousTask[] {
  return tasks.map((task) => ({
    ...task,
    priority: createTaskPriority(
      task.priority.complexity,
      task.priority.impact,
      task.priority.priority,
      task.createdAt,
      weights
    )
  }));
}

// ============================================
// Utility Functions
// ============================================

/**
 * Validate that priority weights sum to approximately 1.0.
 *
 * @param weights - Weights to validate
 * @returns True if weights are valid
 */
export function validatePriorityWeights(weights: PriorityWeights): boolean {
  const total =
    weights.complexityWeight +
    weights.impactWeight +
    weights.priorityWeight +
    weights.recencyWeight;

  // Allow small floating point tolerance
  return Math.abs(total - 1.0) <= 0.01;
}

/**
 * Convert complexity string to numeric score.
 */
export function complexityToScore(complexity: 'low' | 'medium' | 'high'): number {
  const mapping: Record<string, number> = {
    low: 3,
    medium: 5,
    high: 8
  };
  return mapping[complexity] ?? 5;
}

/**
 * Convert impact string to numeric score.
 */
export function impactToScore(impact: 'low' | 'medium' | 'high'): number {
  const mapping: Record<string, number> = {
    low: 3,
    medium: 5,
    high: 8
  };
  return mapping[impact] ?? 5;
}

/**
 * Convert MoSCoW priority to numeric score.
 */
export function moscowToScore(priority: 'must' | 'should' | 'could' | 'wont'): number {
  const mapping: Record<string, number> = {
    must: 10,
    should: 7,
    could: 4,
    wont: 1
  };
  return mapping[priority] ?? 5;
}

/**
 * Extract priority score from GitHub issue labels.
 */
export function priorityFromLabels(labels: string[]): number {
  const lowercaseLabels = labels.map((l) => l.toLowerCase());

  for (const label of lowercaseLabels) {
    if (label.includes('critical') || label.includes('p0') || label.includes('urgent')) {
      return 10;
    }
    if (
      label.includes('priority:high') ||
      label.includes('p1') ||
      label.includes('high-priority')
    ) {
      return 8;
    }
    if (label.includes('priority:medium') || label.includes('p2')) {
      return 5;
    }
    if (
      label.includes('priority:low') ||
      label.includes('p3') ||
      label.includes('low-priority')
    ) {
      return 3;
    }
  }

  // Default to medium priority
  return 5;
}
