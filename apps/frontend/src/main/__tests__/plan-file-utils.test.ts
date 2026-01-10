/**
 * Unit tests for plan-file-utils.ts
 * Tests plan file cache functionality including TTL expiration, cache updates, and invalidation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import path from 'path';

// Test directories
const TEST_DIR = '/tmp/plan-file-utils-test';
const TEST_PROJECT_PATH = path.join(TEST_DIR, 'test-project');
const TEST_SPEC_DIR = path.join(TEST_PROJECT_PATH, '.auto-claude', 'specs', 'test-spec');
const TEST_PLAN_PATH = path.join(TEST_SPEC_DIR, 'implementation_plan.json');

// Mock electron before importing
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => TEST_DIR)
  }
}));

// Setup test directories
function setupTestDirs(): void {
  mkdirSync(TEST_SPEC_DIR, { recursive: true });
}

// Cleanup test directories
function cleanupTestDirs(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// Helper to create a test plan file
function createTestPlanFile(planPath: string, overrides: Record<string, unknown> = {}): void {
  const plan = {
    feature: 'Test Feature',
    description: 'Test description',
    status: 'pending',
    planStatus: 'pending',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    phases: [],
    ...overrides
  };
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
}

describe('Plan File Cache', () => {
  beforeEach(async () => {
    cleanupTestDirs();
    setupTestDirs();
    vi.resetModules();
    vi.clearAllTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('getPlanWithCache', () => {
    it('should read plan from disk on first access (cache miss)', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'First Access' });

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');
      const plan = getPlanWithCache(TEST_PLAN_PATH);

      expect(plan).toBeDefined();
      expect(plan?.feature).toBe('First Access');
    });

    it('should return cached plan on second access (cache hit)', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Cached Plan' });

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // First read - cache miss
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan1?.feature).toBe('Cached Plan');

      // Modify the file on disk (without invalidating cache)
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Modified Plan' });

      // Second read - should return cached version
      const plan2 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan2?.feature).toBe('Cached Plan'); // Still cached
    });

    it('should return null for non-existent file', async () => {
      const nonExistentPath = path.join(TEST_SPEC_DIR, 'missing.json');

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');
      const plan = getPlanWithCache(nonExistentPath);

      expect(plan).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      writeFileSync(TEST_PLAN_PATH, 'invalid json{{{');

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');
      const plan = getPlanWithCache(TEST_PLAN_PATH);

      expect(plan).toBeNull();
    });
  });

  describe('Cache TTL Expiration', () => {
    it('should expire cache after 60 seconds', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Will Expire' });

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // First read - cache miss
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan1?.feature).toBe('Will Expire');

      // Modify the file on disk
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'After Expiration' });

      // Second read before expiration - should return cached version
      vi.advanceTimersByTime(30 * 1000); // 30 seconds
      const plan2 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan2?.feature).toBe('Will Expire'); // Still cached

      // Third read after expiration - should read from disk
      vi.advanceTimersByTime(31 * 1000); // 31 more seconds (total 61)
      const plan3 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan3?.feature).toBe('After Expiration'); // Cache expired, read new value
    });

    it('should remove stale cache entry on access after expiration', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Stale Entry' });

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // First read - cache miss
      getPlanWithCache(TEST_PLAN_PATH);

      // Advance time past TTL
      vi.advanceTimersByTime(61 * 1000);

      // Modify the file
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Fresh Entry' });

      // Read again - should detect expired cache, remove it, and read from disk
      const plan = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan?.feature).toBe('Fresh Entry');
    });

    it('should handle cache expiration at exactly 60 seconds', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Exact TTL' });

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Cache the plan
      getPlanWithCache(TEST_PLAN_PATH);

      // Modify file
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'At 60s' });

      // At exactly 60 seconds, cache should expire
      vi.advanceTimersByTime(60 * 1000);
      const plan = getPlanWithCache(TEST_PLAN_PATH);

      // Cache expired (age === TTL means expired)
      expect(plan?.feature).toBe('At 60s');
    });
  });

  describe('Cache Updates on Write', () => {
    it('should update cache after persistPlanStatus write', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { status: 'pending' });

      const { persistPlanStatus, getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Update status
      await persistPlanStatus(TEST_PLAN_PATH, 'in_progress');

      // Read from cache - should have updated status
      const plan = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan?.status).toBe('in_progress');
    });

    it('should update cache after persistPlanStatusSync write', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { status: 'pending' });

      const { persistPlanStatusSync, getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Update status synchronously
      persistPlanStatusSync(TEST_PLAN_PATH, 'done');

      // Read from cache - should have updated status
      const plan = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan?.status).toBe('done');
    });

    it('should not require re-read after persistPlanStatus', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { status: 'pending' });

      const { persistPlanStatus, getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Populate cache with initial read
      getPlanWithCache(TEST_PLAN_PATH);

      // Update status (which updates cache)
      await persistPlanStatus(TEST_PLAN_PATH, 'ai_review');

      // Delete the file to prove we're reading from cache
      rmSync(TEST_PLAN_PATH);

      // Read should succeed from cache
      const plan = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan?.status).toBe('ai_review');
    });

    it('should refresh cache timestamp on write', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { status: 'pending' });

      const { persistPlanStatus, getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Initial read
      getPlanWithCache(TEST_PLAN_PATH);

      // Advance time close to expiration
      vi.advanceTimersByTime(58 * 1000);

      // Update status (refreshes cache timestamp)
      await persistPlanStatus(TEST_PLAN_PATH, 'in_progress');

      // Advance another 30 seconds (would have expired if not refreshed)
      vi.advanceTimersByTime(30 * 1000);

      // Modify file on disk
      createTestPlanFile(TEST_PLAN_PATH, { status: 'done' });

      // Should still be cached (timestamp was refreshed)
      const plan = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan?.status).toBe('in_progress'); // From cache, not disk
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache after updatePlanFile', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Original' });

      const { updatePlanFile, getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Populate cache
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan1?.feature).toBe('Original');

      // Update plan file (invalidates cache)
      await updatePlanFile(TEST_PLAN_PATH, (plan: Record<string, unknown>) => {
        return { ...plan, feature: 'Updated' };
      });

      // Read should reflect new value (cache was invalidated)
      const plan2 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan2?.feature).toBe('Updated');
    });

    it('should invalidate cache after createPlanIfNotExists', async () => {
      const { createPlanIfNotExists, getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      const task = {
        id: 'test-task',
        title: 'Test Task',
        description: 'Test description',
        specId: 'test-spec',
        status: 'pending' as const,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Create plan
      await createPlanIfNotExists(TEST_PLAN_PATH, task, 'pending');

      // Read to populate cache
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan1?.feature).toBe('Test Task');

      // Delete and recreate with different data
      rmSync(TEST_PLAN_PATH);
      const modifiedTask = { ...task, title: 'Modified Task' };
      await createPlanIfNotExists(TEST_PLAN_PATH, modifiedTask, 'pending');

      // Cache should be invalidated, read new value
      const plan2 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan2?.feature).toBe('Modified Task');
    });

    it('should force re-read after cache invalidation', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Before Update' });

      const { updatePlanFile, getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Populate cache
      getPlanWithCache(TEST_PLAN_PATH);

      // Update file (invalidates cache)
      await updatePlanFile(TEST_PLAN_PATH, (plan: Record<string, unknown>) => {
        return { ...plan, feature: 'After Update' };
      });

      // Multiple reads should all return new value
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);
      const plan2 = getPlanWithCache(TEST_PLAN_PATH);

      expect(plan1?.feature).toBe('After Update');
      expect(plan2?.feature).toBe('After Update');
    });

    it('should not affect other cached plans when invalidating one', async () => {
      const otherPlanPath = path.join(TEST_SPEC_DIR, 'other_plan.json');
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Plan 1' });
      createTestPlanFile(otherPlanPath, { feature: 'Plan 2' });

      const { updatePlanFile, getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Cache both plans
      getPlanWithCache(TEST_PLAN_PATH);
      getPlanWithCache(otherPlanPath);

      // Update only first plan
      await updatePlanFile(TEST_PLAN_PATH, (plan: Record<string, unknown>) => {
        return { ...plan, feature: 'Plan 1 Updated' };
      });

      // First plan should be invalidated
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan1?.feature).toBe('Plan 1 Updated');

      // Second plan should still be cached
      rmSync(otherPlanPath); // Delete to prove we're reading from cache
      const plan2 = getPlanWithCache(otherPlanPath);
      expect(plan2?.feature).toBe('Plan 2');
    });
  });

  describe('Cache Consistency', () => {
    it('should maintain cache consistency across read-write-read cycle', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { counter: 0 });

      const { getPlanWithCache, updatePlanFile } = await import('../ipc-handlers/task/plan-file-utils');

      // Read initial value
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan1?.counter).toBe(0);

      // Update
      await updatePlanFile(TEST_PLAN_PATH, (plan: Record<string, unknown>) => {
        return { ...plan, counter: 1 };
      });

      // Read updated value
      const plan2 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan2?.counter).toBe(1);

      // Update again
      await updatePlanFile(TEST_PLAN_PATH, (plan: Record<string, unknown>) => {
        return { ...plan, counter: 2 };
      });

      // Read again
      const plan3 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan3?.counter).toBe(2);
    });

    it('should handle rapid sequential reads from cache', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { value: 'stable' });

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Populate cache
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);

      // Multiple rapid reads should all return the same cached instance
      const plan2 = getPlanWithCache(TEST_PLAN_PATH);
      const plan3 = getPlanWithCache(TEST_PLAN_PATH);
      const plan4 = getPlanWithCache(TEST_PLAN_PATH);

      expect(plan1).toEqual(plan2);
      expect(plan2).toEqual(plan3);
      expect(plan3).toEqual(plan4);
      expect(plan1?.value).toBe('stable');
    });

    it('should update cache with correct timestamp on write', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { status: 'pending' });

      const { persistPlanStatus, getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Set a known time
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

      // Write to cache
      await persistPlanStatus(TEST_PLAN_PATH, 'in_progress');

      // Advance time but not past TTL
      vi.advanceTimersByTime(30 * 1000);

      // Modify file on disk
      createTestPlanFile(TEST_PLAN_PATH, { status: 'done' });

      // Should still be cached (timestamp was set correctly)
      const plan = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan?.status).toBe('in_progress');
    });
  });

  describe('Edge Cases', () => {
    it('should handle cache with same path but different content over time', async () => {
      const { getPlanWithCache, updatePlanFile } = await import('../ipc-handlers/task/plan-file-utils');

      // Create and cache first version
      createTestPlanFile(TEST_PLAN_PATH, { version: 1 });
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan1?.version).toBe(1);

      // Update and invalidate
      await updatePlanFile(TEST_PLAN_PATH, (plan: Record<string, unknown>) => {
        return { ...plan, version: 2 };
      });

      // Read new version
      const plan2 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan2?.version).toBe(2);

      // Update again
      await updatePlanFile(TEST_PLAN_PATH, (plan: Record<string, unknown>) => {
        return { ...plan, version: 3 };
      });

      // Read newest version
      const plan3 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan3?.version).toBe(3);
    });

    it('should handle file deletion while cached', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Deleted Later' });

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Cache the plan
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan1?.feature).toBe('Deleted Later');

      // Delete the file
      rmSync(TEST_PLAN_PATH);

      // Should still return cached value
      const plan2 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan2?.feature).toBe('Deleted Later');

      // After expiration, should return null
      vi.advanceTimersByTime(61 * 1000);
      const plan3 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan3).toBeNull();
    });

    it('should handle empty plan file', async () => {
      writeFileSync(TEST_PLAN_PATH, '{}');

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');
      const plan = getPlanWithCache(TEST_PLAN_PATH);

      expect(plan).toEqual({});
    });

    it('should cache empty plan file', async () => {
      writeFileSync(TEST_PLAN_PATH, '{}');

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // First read
      getPlanWithCache(TEST_PLAN_PATH);

      // Modify on disk
      writeFileSync(TEST_PLAN_PATH, '{"modified": true}');

      // Should return cached empty object
      const plan = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan).toEqual({});
    });
  });

  describe('Performance Characteristics', () => {
    it('should avoid disk I/O for cached reads', async () => {
      createTestPlanFile(TEST_PLAN_PATH, { feature: 'Performance Test' });

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // First read - disk I/O
      const plan1 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan1).toBeDefined();

      // Delete file to ensure no disk reads
      rmSync(TEST_PLAN_PATH);

      // Should succeed from cache (no disk I/O)
      const plan2 = getPlanWithCache(TEST_PLAN_PATH);
      expect(plan2).toEqual(plan1);
    });

    it('should handle multiple paths in cache simultaneously', async () => {
      const paths = [
        path.join(TEST_SPEC_DIR, 'plan1.json'),
        path.join(TEST_SPEC_DIR, 'plan2.json'),
        path.join(TEST_SPEC_DIR, 'plan3.json')
      ];

      paths.forEach((p, i) => createTestPlanFile(p, { id: i }));

      const { getPlanWithCache } = await import('../ipc-handlers/task/plan-file-utils');

      // Cache all plans
      const plans = paths.map(p => getPlanWithCache(p));

      // Verify all cached correctly
      plans.forEach((plan, i) => {
        expect(plan?.id).toBe(i);
      });

      // Delete files
      paths.forEach(p => rmSync(p));

      // All should still be accessible from cache
      const cachedPlans = paths.map(p => getPlanWithCache(p));
      cachedPlans.forEach((plan, i) => {
        expect(plan?.id).toBe(i);
      });
    });
  });
});
