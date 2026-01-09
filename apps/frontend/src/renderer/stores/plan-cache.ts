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

// Export singleton instance for use across the application
export const planCache = new PlanCache();
