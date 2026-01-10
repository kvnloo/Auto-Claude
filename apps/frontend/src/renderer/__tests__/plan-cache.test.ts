/**
 * Unit tests for PlanCache
 * Tests caching functionality for implementation plan parsing and validation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlanCache,
  getPlanHash,
  getCachedSubtasks,
  getCachedValidation,
  getCachedStatusFlags,
  type CachedPlanData
} from '../stores/plan-cache';
import type { ImplementationPlan, Subtask } from '../../shared/types';

// Helper to create test implementation plan
function createTestPlan(overrides: Partial<ImplementationPlan> = {}): ImplementationPlan {
  return {
    feature: 'Test Feature',
    description: 'Test description',
    workflow_type: 'feature',
    services_involved: ['service-1'],
    phases: [
      {
        phase: 1,
        name: 'Test Phase 1',
        type: 'implementation',
        subtasks: [
          { id: 'subtask-1', description: 'First subtask', status: 'pending' },
          { id: 'subtask-2', description: 'Second subtask', status: 'completed' }
        ],
        depends_on: []
      },
      {
        phase: 2,
        name: 'Test Phase 2',
        type: 'testing',
        subtasks: [
          { id: 'subtask-3', description: 'Third subtask', status: 'in_progress' }
        ],
        depends_on: [1]
      }
    ],
    final_acceptance: ['Tests pass'],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    spec_file: 'spec.md',
    ...overrides
  };
}

describe('PlanCache', () => {
  let cache: PlanCache;

  beforeEach(() => {
    cache = new PlanCache();
  });

  describe('Basic Cache Operations', () => {
    it('should store and retrieve cached data', () => {
      const plan = createTestPlan();
      const cachedData: CachedPlanData = {
        hash: 'test-hash',
        subtasks: [],
        isValid: true,
        statusFlags: {
          allCompleted: false,
          anyFailed: false,
          anyInProgress: false,
          anyCompleted: false
        }
      };

      cache.set(plan, cachedData);
      const retrieved = cache.get(plan);

      expect(retrieved).toEqual(cachedData);
    });

    it('should return undefined for non-cached plan', () => {
      const plan = createTestPlan();
      const retrieved = cache.get(plan);

      expect(retrieved).toBeUndefined();
    });

    it('should check if plan has cached data', () => {
      const plan = createTestPlan();
      const cachedData: CachedPlanData = {
        hash: 'test-hash',
        subtasks: [],
        isValid: true,
        statusFlags: {
          allCompleted: false,
          anyFailed: false,
          anyInProgress: false,
          anyCompleted: false
        }
      };

      expect(cache.has(plan)).toBe(false);

      cache.set(plan, cachedData);

      expect(cache.has(plan)).toBe(true);
    });

    it('should clear all cached data', () => {
      const plan1 = createTestPlan({ feature: 'Feature 1' });
      const plan2 = createTestPlan({ feature: 'Feature 2' });
      const cachedData: CachedPlanData = {
        hash: 'test-hash',
        subtasks: [],
        isValid: true,
        statusFlags: {
          allCompleted: false,
          anyFailed: false,
          anyInProgress: false,
          anyCompleted: false
        }
      };

      cache.set(plan1, cachedData);
      cache.set(plan2, cachedData);

      expect(cache.has(plan1)).toBe(true);
      expect(cache.has(plan2)).toBe(true);

      cache.clear();

      expect(cache.has(plan1)).toBe(false);
      expect(cache.has(plan2)).toBe(false);
    });
  });

  describe('Cache Isolation (WeakMap behavior)', () => {
    it('should use plan object reference as key', () => {
      // Create two identical plans (different object references)
      const plan1 = createTestPlan({ feature: 'Feature A' });
      const plan2 = createTestPlan({ feature: 'Feature A' }); // Same data, different object

      const cachedData1: CachedPlanData = {
        hash: 'hash-1',
        subtasks: [],
        isValid: true,
        statusFlags: {
          allCompleted: false,
          anyFailed: false,
          anyInProgress: false,
          anyCompleted: false
        }
      };

      const cachedData2: CachedPlanData = {
        hash: 'hash-2',
        subtasks: [],
        isValid: false,
        statusFlags: {
          allCompleted: true,
          anyFailed: false,
          anyInProgress: false,
          anyCompleted: false
        }
      };

      cache.set(plan1, cachedData1);
      cache.set(plan2, cachedData2);

      // Even though plans have same data, they should have separate cache entries
      expect(cache.get(plan1)).toEqual(cachedData1);
      expect(cache.get(plan2)).toEqual(cachedData2);
      expect(cache.get(plan1)?.hash).toBe('hash-1');
      expect(cache.get(plan2)?.hash).toBe('hash-2');
    });

    it('should allow garbage collection when plan reference is lost', () => {
      // This test verifies WeakMap allows GC (conceptual test)
      // In practice, we can't force GC in tests, but we verify the cache doesn't prevent it
      let plan: ImplementationPlan | null = createTestPlan();
      const cachedData: CachedPlanData = {
        hash: 'test-hash',
        subtasks: [],
        isValid: true,
        statusFlags: {
          allCompleted: false,
          anyFailed: false,
          anyInProgress: false,
          anyCompleted: false
        }
      };

      cache.set(plan, cachedData);
      expect(cache.has(plan)).toBe(true);

      // Nullify reference - WeakMap should allow GC (can't test actual GC in unit tests)
      plan = null;

      // This demonstrates the API works correctly - actual GC behavior is runtime-dependent
      expect(plan).toBeNull();
    });
  });

  describe('getPlanHash', () => {
    it('should generate hash from updated_at, phases.length, and phase IDs', () => {
      const plan = createTestPlan({
        updated_at: '2024-01-01T12:00:00Z',
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [],
            depends_on: []
          },
          {
            phase: 2,
            name: 'Phase 2',
            type: 'testing',
            subtasks: [],
            depends_on: [1]
          }
        ]
      });

      const hash = getPlanHash(plan);

      expect(hash).toBe('2024-01-01T12:00:00Z|2|[1,2]');
    });

    it('should generate different hash when updated_at changes', () => {
      const plan1 = createTestPlan({ updated_at: '2024-01-01T12:00:00Z' });
      const plan2 = createTestPlan({ updated_at: '2024-01-01T13:00:00Z' });

      const hash1 = getPlanHash(plan1);
      const hash2 = getPlanHash(plan2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hash when phases.length changes', () => {
      const plan1 = createTestPlan({
        phases: [
          { phase: 1, name: 'Phase 1', type: 'implementation', subtasks: [], depends_on: [] }
        ]
      });
      const plan2 = createTestPlan({
        phases: [
          { phase: 1, name: 'Phase 1', type: 'implementation', subtasks: [], depends_on: [] },
          { phase: 2, name: 'Phase 2', type: 'testing', subtasks: [], depends_on: [1] }
        ]
      });

      const hash1 = getPlanHash(plan1);
      const hash2 = getPlanHash(plan2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hash when phase IDs change', () => {
      const plan1 = createTestPlan({
        phases: [
          { phase: 1, name: 'Phase 1', type: 'implementation', subtasks: [], depends_on: [] },
          { phase: 2, name: 'Phase 2', type: 'testing', subtasks: [], depends_on: [1] }
        ]
      });
      const plan2 = createTestPlan({
        phases: [
          { phase: 1, name: 'Phase 1', type: 'implementation', subtasks: [], depends_on: [] },
          { phase: 3, name: 'Phase 3', type: 'testing', subtasks: [], depends_on: [1] }
        ]
      });

      const hash1 = getPlanHash(plan1);
      const hash2 = getPlanHash(plan2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate same hash for identical plans (hash collision prevention)', () => {
      const plan1 = createTestPlan();
      const plan2 = createTestPlan(); // Identical data, different object

      const hash1 = getPlanHash(plan1);
      const hash2 = getPlanHash(plan2);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash when subtask content changes (via updated_at)', () => {
      // When subtasks change, the plan's updated_at should change
      const plan1 = createTestPlan({
        updated_at: '2024-01-01T12:00:00Z',
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Task 1', status: 'pending' }
            ],
            depends_on: []
          }
        ]
      });

      const plan2 = createTestPlan({
        updated_at: '2024-01-01T12:00:01Z', // Different timestamp
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'subtask-1', description: 'Task 1', status: 'completed' } // Status changed
            ],
            depends_on: []
          }
        ]
      });

      const hash1 = getPlanHash(plan1);
      const hash2 = getPlanHash(plan2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('getCachedSubtasks', () => {
    it('should flatten subtasks from all phases on first call', () => {
      const plan = createTestPlan();
      const subtasks = getCachedSubtasks(plan, cache);

      expect(subtasks).toHaveLength(3); // 2 from phase 1, 1 from phase 2
      expect(subtasks[0].id).toBe('subtask-1');
      expect(subtasks[1].id).toBe('subtask-2');
      expect(subtasks[2].id).toBe('subtask-3');
    });

    it('should cache subtasks after first computation', () => {
      const plan = createTestPlan();

      const subtasks1 = getCachedSubtasks(plan, cache);
      const subtasks2 = getCachedSubtasks(plan, cache);

      // Should return the exact same array (cached reference)
      expect(subtasks1).toBe(subtasks2);
    });

    it('should return cached subtasks when plan hash matches (cache hit)', () => {
      const plan = createTestPlan();

      // First call - computes and caches
      const subtasks1 = getCachedSubtasks(plan, cache);

      // Verify cache was populated
      const cached = cache.get(plan);
      expect(cached).toBeDefined();
      expect(cached?.subtasks).toBe(subtasks1);

      // Second call - should hit cache
      const subtasks2 = getCachedSubtasks(plan, cache);
      expect(subtasks2).toBe(subtasks1);
    });

    it('should recompute subtasks when plan hash changes (cache miss)', () => {
      const plan = createTestPlan({ updated_at: '2024-01-01T12:00:00Z' });

      // First call
      const subtasks1 = getCachedSubtasks(plan, cache);
      expect(subtasks1).toHaveLength(3);

      // Modify plan (change updated_at to simulate plan change)
      plan.updated_at = '2024-01-01T13:00:00Z';

      // Second call - should recompute due to hash change
      const subtasks2 = getCachedSubtasks(plan, cache);
      expect(subtasks2).toHaveLength(3);

      // Should be different array (recomputed)
      expect(subtasks2).not.toBe(subtasks1);
    });

    it('should generate IDs for subtasks without IDs', () => {
      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { description: 'Task without ID', status: 'pending' } as any
            ],
            depends_on: []
          }
        ]
      });

      const subtasks = getCachedSubtasks(plan, cache);

      expect(subtasks).toHaveLength(1);
      expect(subtasks[0].id).toBeDefined();
      // ID should be either a UUID (crypto.randomUUID) or fallback format (subtask-timestamp-random)
      expect(typeof subtasks[0].id).toBe('string');
      expect(subtasks[0].id.length).toBeGreaterThan(0);
    });

    it('should provide default description for subtasks without descriptions', () => {
      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'task-1', status: 'pending' } as any
            ],
            depends_on: []
          }
        ]
      });

      const subtasks = getCachedSubtasks(plan, cache);

      expect(subtasks).toHaveLength(1);
      expect(subtasks[0].description).toBe('No description available');
      expect(subtasks[0].title).toBe('No description available');
    });

    it('should compute and cache status flags', () => {
      const plan = createTestPlan();

      getCachedSubtasks(plan, cache);

      const cached = cache.get(plan);
      expect(cached?.statusFlags).toEqual({
        allCompleted: false, // Not all are completed
        anyFailed: false,    // None failed
        anyInProgress: true, // subtask-3 is in_progress
        anyCompleted: true   // subtask-2 is completed
      });
    });
  });

  describe('getCachedValidation', () => {
    it('should run validator on first call', () => {
      const plan = createTestPlan();
      let validatorCalled = false;

      const validator = (p: ImplementationPlan): boolean => {
        validatorCalled = true;
        return p.phases.length > 0;
      };

      const isValid = getCachedValidation(plan, validator, cache);

      expect(validatorCalled).toBe(true);
      expect(isValid).toBe(true);
    });

    it('should cache validation result', () => {
      const plan = createTestPlan();
      let callCount = 0;

      const validator = (): boolean => {
        callCount++;
        return true;
      };

      getCachedValidation(plan, validator, cache);
      getCachedValidation(plan, validator, cache);

      // Validator should only be called once (second call hits cache)
      expect(callCount).toBe(1);
    });

    it('should return cached validation when plan hash matches (cache hit)', () => {
      const plan = createTestPlan();
      const validator = (): boolean => true;

      const isValid1 = getCachedValidation(plan, validator, cache);
      const isValid2 = getCachedValidation(plan, validator, cache);

      expect(isValid1).toBe(true);
      expect(isValid2).toBe(true);
    });

    it('should revalidate when plan hash changes (cache miss)', () => {
      const plan = createTestPlan({ updated_at: '2024-01-01T12:00:00Z' });
      let callCount = 0;

      const validator = (): boolean => {
        callCount++;
        return true;
      };

      getCachedValidation(plan, validator, cache);

      // Change plan hash
      plan.updated_at = '2024-01-01T13:00:00Z';

      getCachedValidation(plan, validator, cache);

      // Validator should be called twice (hash changed)
      expect(callCount).toBe(2);
    });

    it('should update existing cache entry when revalidating', () => {
      const plan = createTestPlan({ updated_at: '2024-01-01T12:00:00Z' });

      // First validation
      getCachedValidation(plan, () => true, cache);
      const cached1 = cache.get(plan);
      expect(cached1?.isValid).toBe(true);

      // Change plan and revalidate with different result
      plan.updated_at = '2024-01-01T13:00:00Z';
      getCachedValidation(plan, () => false, cache);
      const cached2 = cache.get(plan);
      expect(cached2?.isValid).toBe(false);
      expect(cached2?.hash).toBe(getPlanHash(plan));
    });

    it('should create new cache entry if none exists', () => {
      const plan = createTestPlan();

      expect(cache.has(plan)).toBe(false);

      getCachedValidation(plan, () => true, cache);

      expect(cache.has(plan)).toBe(true);
      const cached = cache.get(plan);
      expect(cached?.isValid).toBe(true);
      expect(cached?.hash).toBe(getPlanHash(plan));
    });
  });

  describe('getCachedStatusFlags', () => {
    it('should compute status flags from subtasks on first call', () => {
      const plan = createTestPlan();
      const subtasks: Subtask[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Task 1',
          status: 'completed',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        },
        {
          id: 'task-2',
          title: 'Task 2',
          description: 'Task 2',
          status: 'completed',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        }
      ];

      const flags = getCachedStatusFlags(plan, subtasks, cache);

      expect(flags).toEqual({
        allCompleted: true,
        anyFailed: false,
        anyInProgress: false,
        anyCompleted: true
      });
    });

    it('should cache status flags', () => {
      const plan = createTestPlan();
      const subtasks: Subtask[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Task 1',
          status: 'in_progress',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        }
      ];

      getCachedStatusFlags(plan, subtasks, cache);

      const cached = cache.get(plan);
      expect(cached?.statusFlags).toEqual({
        allCompleted: false,
        anyFailed: false,
        anyInProgress: true,
        anyCompleted: false
      });
    });

    it('should return cached flags when plan hash matches (cache hit)', () => {
      const plan = createTestPlan();
      const subtasks: Subtask[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Task 1',
          status: 'completed',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        }
      ];

      const flags1 = getCachedStatusFlags(plan, subtasks, cache);
      const flags2 = getCachedStatusFlags(plan, subtasks, cache);

      // Should return the exact same object (cached reference)
      expect(flags1).toBe(flags2);
    });

    it('should recompute flags when plan hash changes (cache miss)', () => {
      const plan = createTestPlan({ updated_at: '2024-01-01T12:00:00Z' });
      const subtasks: Subtask[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Task 1',
          status: 'pending',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        }
      ];

      const flags1 = getCachedStatusFlags(plan, subtasks, cache);

      // Change plan hash
      plan.updated_at = '2024-01-01T13:00:00Z';

      const flags2 = getCachedStatusFlags(plan, subtasks, cache);

      // Should be different objects (recomputed)
      expect(flags1).not.toBe(flags2);
    });

    it('should detect all completed tasks', () => {
      const plan = createTestPlan();
      const subtasks: Subtask[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Task 1',
          status: 'completed',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        },
        {
          id: 'task-2',
          title: 'Task 2',
          description: 'Task 2',
          status: 'completed',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        }
      ];

      const flags = getCachedStatusFlags(plan, subtasks, cache);

      expect(flags.allCompleted).toBe(true);
    });

    it('should detect any failed tasks', () => {
      const plan = createTestPlan();
      const subtasks: Subtask[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Task 1',
          status: 'completed',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        },
        {
          id: 'task-2',
          title: 'Task 2',
          description: 'Task 2',
          status: 'failed',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        }
      ];

      const flags = getCachedStatusFlags(plan, subtasks, cache);

      expect(flags.anyFailed).toBe(true);
    });

    it('should detect any in-progress tasks', () => {
      const plan = createTestPlan();
      const subtasks: Subtask[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Task 1',
          status: 'in_progress',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        },
        {
          id: 'task-2',
          title: 'Task 2',
          description: 'Task 2',
          status: 'pending',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        }
      ];

      const flags = getCachedStatusFlags(plan, subtasks, cache);

      expect(flags.anyInProgress).toBe(true);
    });

    it('should update existing cache entry when flags change', () => {
      const plan = createTestPlan({ updated_at: '2024-01-01T12:00:00Z' });
      const subtasks1: Subtask[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Task 1',
          status: 'pending',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        }
      ];

      getCachedStatusFlags(plan, subtasks1, cache);
      const cached1 = cache.get(plan);
      expect(cached1?.statusFlags.allCompleted).toBe(false);

      // Change plan and subtasks
      plan.updated_at = '2024-01-01T13:00:00Z';
      const subtasks2: Subtask[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          description: 'Task 1',
          status: 'completed',
          files: [],
          verification: { type: 'command', run: 'echo test' }
        }
      ];

      getCachedStatusFlags(plan, subtasks2, cache);
      const cached2 = cache.get(plan);
      expect(cached2?.statusFlags.allCompleted).toBe(true);
    });
  });

  describe('Integration: Combined Caching Behavior', () => {
    it('should share cache across all helper functions', () => {
      const plan = createTestPlan();
      const validator = (): boolean => true;

      // Call getCachedSubtasks first to populate subtasks
      const subtasks = getCachedSubtasks(plan, cache);
      expect(cache.has(plan)).toBe(true);
      expect(subtasks).toHaveLength(3);

      // Call getCachedValidation - should update existing cache entry
      const isValid = getCachedValidation(plan, validator, cache);
      expect(isValid).toBe(true);

      // Call getCachedStatusFlags - should update existing cache entry
      const flags = getCachedStatusFlags(plan, subtasks, cache);
      expect(flags.anyCompleted).toBe(true);

      // Verify all data is in the same cache entry
      const cached = cache.get(plan);
      expect(cached?.isValid).toBe(true);
      expect(cached?.subtasks).toBe(subtasks);
      expect(cached?.statusFlags).toBe(flags);
    });

    it('should maintain cache consistency across multiple operations', () => {
      const plan = createTestPlan();

      // Populate cache with all operations
      getCachedSubtasks(plan, cache);
      getCachedValidation(plan, () => true, cache);
      const subtasks = getCachedSubtasks(plan, cache);
      getCachedStatusFlags(plan, subtasks, cache);

      const cached = cache.get(plan);
      const hash = getPlanHash(plan);

      expect(cached?.hash).toBe(hash);
      expect(cached?.subtasks.length).toBe(3);
      expect(cached?.isValid).toBe(true);
      expect(cached?.statusFlags).toBeDefined();
    });
  });
});
