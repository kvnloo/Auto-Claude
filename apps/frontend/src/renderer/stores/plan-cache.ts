import type { ImplementationPlan, Subtask } from '../../shared/types';

/**
 * Cached plan data stored in the WeakMap
 */
export interface CachedPlanData {
  /** Hash of the plan to detect changes */
  hash: string;
  /** Flattened subtasks array (parsed and validated) */
  subtasks: Subtask[];
  /** Validation result */
  isValid: boolean;
  /** Status flags computed from subtasks */
  statusFlags: {
    allCompleted: boolean;
    anyFailed: boolean;
    anyInProgress: boolean;
    anyCompleted: boolean;
  };
}

/**
 * Generate a hash for a plan to detect when content actually changes
 *
 * The hash is based on:
 * - updated_at timestamp (when plan was last modified)
 * - phases.length (number of phases)
 * - Phase IDs (array of phase numbers)
 *
 * This allows early-exit optimization when the same plan is processed
 * multiple times without changes.
 *
 * @param plan - The implementation plan to hash
 * @returns A hash string representing the plan's current state
 */
export function getPlanHash(plan: ImplementationPlan): string {
  const phaseIds = plan.phases.map(phase => phase.phase);
  return `${plan.updated_at}|${plan.phases.length}|${JSON.stringify(phaseIds)}`;
}

/**
 * PlanCache - Caches validated and processed implementation plans
 *
 * Uses WeakMap to cache plan data keyed by plan object reference.
 * This allows automatic garbage collection when plan objects are no longer referenced.
 *
 * The cache stores:
 * - Plan hash for change detection
 * - Flattened and validated subtasks
 * - Validation results
 * - Computed status flags
 *
 * This eliminates redundant JSON parsing, validation, and array operations
 * when the same plan is processed multiple times during task execution.
 */
export class PlanCache {
  private cache: WeakMap<ImplementationPlan, CachedPlanData>;

  constructor() {
    this.cache = new WeakMap<ImplementationPlan, CachedPlanData>();
  }

  /**
   * Get cached data for a plan
   * @param plan - The implementation plan object
   * @returns Cached plan data if exists, undefined otherwise
   */
  get(plan: ImplementationPlan): CachedPlanData | undefined {
    return this.cache.get(plan);
  }

  /**
   * Store cached data for a plan
   * @param plan - The implementation plan object (used as key)
   * @param data - The cached plan data to store
   */
  set(plan: ImplementationPlan, data: CachedPlanData): void {
    this.cache.set(plan, data);
  }

  /**
   * Check if a plan has cached data
   * @param plan - The implementation plan object
   * @returns True if cached data exists, false otherwise
   */
  has(plan: ImplementationPlan): boolean {
    return this.cache.has(plan);
  }

  /**
   * Clear all cached data
   * Note: Since WeakMap doesn't support iteration, this creates a new WeakMap instance
   */
  clear(): void {
    // WeakMap doesn't have a clear method, so we create a new instance
    this.cache = new WeakMap<ImplementationPlan, CachedPlanData>();
  }
}

/**
 * Get cached subtasks for a plan, or compute and cache them if not cached or plan changed
 *
 * This function implements the core caching optimization for plan parsing:
 * - Computes plan hash to detect content changes
 * - Returns cached subtasks if plan hasn't changed
 * - Flattens phases->subtasks and caches result if plan changed
 * - Avoids redundant flatMap, object creation, and validation on every call
 *
 * @param plan - The implementation plan to process
 * @param cache - The PlanCache instance to use (defaults to singleton)
 * @returns Flattened array of subtasks from all phases
 */
export function getCachedSubtasks(
  plan: ImplementationPlan,
  cache: PlanCache = planCache
): Subtask[] {
  // Compute current plan hash
  const currentHash = getPlanHash(plan);

  // Check if we have cached data for this plan
  const cached = cache.get(plan);

  // If cached and hash matches, return cached subtasks (fast path)
  if (cached && cached.hash === currentHash) {
    return cached.subtasks;
  }

  // Cache miss or plan changed - flatten subtasks from phases (slow path)
  const subtasks: Subtask[] = plan.phases.flatMap((phase) =>
    phase.subtasks.map((subtask) => {
      // Ensure all required fields have valid values to prevent UI issues
      // Use crypto.randomUUID() for stronger randomness when available
      const id = subtask.id || (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `subtask-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
      const description = subtask.description || 'No description available';
      const title = description; // Title and description are the same for subtasks
      const status = subtask.status || 'pending';

      return {
        id,
        title,
        description,
        status,
        files: [],
        verification: subtask.verification as Subtask['verification']
      };
    })
  );

  // Compute status flags for caching (will be used in future subtasks)
  const statusFlags = {
    allCompleted: subtasks.every((s) => s.status === 'completed'),
    anyFailed: subtasks.some((s) => s.status === 'failed'),
    anyInProgress: subtasks.some((s) => s.status === 'in_progress'),
    anyCompleted: subtasks.some((s) => s.status === 'completed')
  };

  // Cache the result with current hash
  cache.set(plan, {
    hash: currentHash,
    subtasks,
    isValid: true, // We successfully processed the plan
    statusFlags
  });

  return subtasks;
}

// Export singleton instance for use across the application
export const planCache = new PlanCache();
