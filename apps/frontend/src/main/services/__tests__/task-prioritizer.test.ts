/**
 * Unit tests for Task Prioritizer Service
 * Tests priority scoring, dependency resolution, and task prioritization
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculatePriorityScore,
  calculateRecencyScore,
  createTaskPriority,
  getPriorityLevel,
  detectDependencyCycles,
  resolveDependencies,
  prioritizeTasks,
  hasUnmetDependencies,
  getNextTask,
  updateTaskPriorities,
  validatePriorityWeights,
  complexityToScore,
  impactToScore,
  moscowToScore,
  priorityFromLabels,
  DEFAULT_PRIORITY_WEIGHTS,
  type PriorityWeights
} from '../task-prioritizer';
import type { AutonomousTask, TaskPriority, TaskStatus } from '../../../shared/types/autonomous';

// ============================================
// Test Helper Functions
// ============================================

/**
 * Create a mock task for testing
 */
function createMockTask(
  id: string,
  options: {
    status?: TaskStatus;
    priority?: Partial<TaskPriority>;
    dependencies?: string[];
    createdAt?: Date;
  } = {}
): AutonomousTask {
  const defaultPriority: TaskPriority = {
    complexity: 5,
    impact: 5,
    priority: 5,
    recency: 5,
    score: 5,
    level: 'medium'
  };

  return {
    id,
    title: `Task ${id}`,
    description: `Description for task ${id}`,
    source: {
      provider: 'github_issue',
      issueNumber: parseInt(id.replace(/\D/g, '') || '1'),
      repository: 'test/repo',
      issueUrl: `https://github.com/test/repo/issues/${id}`,
      labels: []
    },
    status: options.status ?? 'pending',
    priority: { ...defaultPriority, ...options.priority },
    dependencies: options.dependencies ?? [],
    blockedBy: [],
    createdAt: options.createdAt ?? new Date(),
    retryCount: 0,
    maxRetries: 2
  };
}

// ============================================
// Priority Score Calculation Tests
// ============================================

describe('Priority Score Calculation', () => {
  describe('calculateRecencyScore', () => {
    it('should return 1 for very recent tasks', () => {
      const now = new Date();
      const score = calculateRecencyScore(now);
      expect(score).toBeCloseTo(1, 1);
    });

    it('should return higher scores for older tasks', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const score = calculateRecencyScore(thirtyDaysAgo);
      expect(score).toBeGreaterThan(3);
      expect(score).toBeLessThan(5);
    });

    it('should return maximum score (10) for tasks at max age', () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const score = calculateRecencyScore(ninetyDaysAgo);
      expect(score).toBe(10);
    });

    it('should cap at max score for tasks older than max age', () => {
      const twoHundredDaysAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
      const score = calculateRecencyScore(twoHundredDaysAgo);
      expect(score).toBe(10);
    });

    it('should use custom max age when provided', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const score = calculateRecencyScore(thirtyDaysAgo, 30);
      expect(score).toBe(10);
    });

    it('should handle future dates gracefully', () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const score = calculateRecencyScore(futureDate);
      expect(score).toBe(1);
    });
  });

  describe('calculatePriorityScore', () => {
    it('should calculate correct score with default weights', () => {
      const now = new Date();
      const score = calculatePriorityScore(5, 5, 5, now);
      // With complexity=5, inverted = 6
      // Impact=5, Priority=5
      // Recency ~1 for recent task
      // Score = 0.15*6 + 0.35*5 + 0.35*5 + 0.15*1 = 0.9 + 1.75 + 1.75 + 0.15 = 4.55
      expect(score).toBeGreaterThan(4);
      expect(score).toBeLessThan(5);
    });

    it('should give higher scores to simpler tasks (inverted complexity)', () => {
      const now = new Date();
      const simpleTaskScore = calculatePriorityScore(1, 5, 5, now);
      const complexTaskScore = calculatePriorityScore(10, 5, 5, now);

      expect(simpleTaskScore).toBeGreaterThan(complexTaskScore);
    });

    it('should give higher scores to high-impact tasks', () => {
      const now = new Date();
      const highImpactScore = calculatePriorityScore(5, 10, 5, now);
      const lowImpactScore = calculatePriorityScore(5, 1, 5, now);

      expect(highImpactScore).toBeGreaterThan(lowImpactScore);
    });

    it('should give higher scores to high-priority tasks', () => {
      const now = new Date();
      const highPriorityScore = calculatePriorityScore(5, 5, 10, now);
      const lowPriorityScore = calculatePriorityScore(5, 5, 1, now);

      expect(highPriorityScore).toBeGreaterThan(lowPriorityScore);
    });

    it('should clamp input values to valid range (1-10)', () => {
      const now = new Date();
      const scoreWithOutOfRange = calculatePriorityScore(-5, 15, 100, now);
      const scoreWithClamped = calculatePriorityScore(1, 10, 10, now);

      expect(scoreWithOutOfRange).toBe(scoreWithClamped);
    });

    it('should use custom weights when provided', () => {
      const now = new Date();
      const customWeights: PriorityWeights = {
        complexityWeight: 0,
        impactWeight: 0.5,
        priorityWeight: 0.5,
        recencyWeight: 0
      };

      const score = calculatePriorityScore(5, 8, 8, now, customWeights);
      // Should only consider impact and priority: 0.5*8 + 0.5*8 = 8
      expect(score).toBe(8);
    });

    it('should round to 2 decimal places', () => {
      const now = new Date();
      const score = calculatePriorityScore(3, 7, 6, now);
      const decimalParts = score.toString().split('.')[1];
      expect(decimalParts?.length || 0).toBeLessThanOrEqual(2);
    });
  });

  describe('getPriorityLevel', () => {
    it('should return critical for scores >= 8.5', () => {
      expect(getPriorityLevel(8.5)).toBe('critical');
      expect(getPriorityLevel(9)).toBe('critical');
      expect(getPriorityLevel(10)).toBe('critical');
    });

    it('should return high for scores >= 6.5 and < 8.5', () => {
      expect(getPriorityLevel(6.5)).toBe('high');
      expect(getPriorityLevel(7.5)).toBe('high');
      expect(getPriorityLevel(8.49)).toBe('high');
    });

    it('should return medium for scores >= 4.5 and < 6.5', () => {
      expect(getPriorityLevel(4.5)).toBe('medium');
      expect(getPriorityLevel(5.5)).toBe('medium');
      expect(getPriorityLevel(6.49)).toBe('medium');
    });

    it('should return low for scores < 4.5', () => {
      expect(getPriorityLevel(0)).toBe('low');
      expect(getPriorityLevel(2)).toBe('low');
      expect(getPriorityLevel(4.49)).toBe('low');
    });
  });

  describe('createTaskPriority', () => {
    it('should create a complete TaskPriority object', () => {
      const now = new Date();
      const priority = createTaskPriority(3, 8, 7, now);

      expect(priority).toHaveProperty('complexity', 3);
      expect(priority).toHaveProperty('impact', 8);
      expect(priority).toHaveProperty('priority', 7);
      expect(priority).toHaveProperty('recency');
      expect(priority).toHaveProperty('score');
      expect(priority).toHaveProperty('level');
      expect(typeof priority.score).toBe('number');
    });

    it('should clamp complexity to valid range', () => {
      const now = new Date();
      const priority = createTaskPriority(-1, 5, 5, now);
      expect(priority.complexity).toBe(1);
    });

    it('should calculate appropriate level based on score', () => {
      const now = new Date();
      const highPriority = createTaskPriority(1, 10, 10, now);
      expect(highPriority.level).toMatch(/critical|high/);

      const lowPriority = createTaskPriority(10, 1, 1, now);
      expect(lowPriority.level).toMatch(/low|medium/);
    });
  });
});

// ============================================
// Dependency Resolution Tests
// ============================================

describe('Dependency Resolution', () => {
  describe('detectDependencyCycles', () => {
    it('should return no cycles for tasks without dependencies', () => {
      const tasks = [
        createMockTask('task-1'),
        createMockTask('task-2'),
        createMockTask('task-3')
      ];

      const result = detectDependencyCycles(tasks);

      expect(result.hasCycles).toBe(false);
      expect(result.cycles).toHaveLength(0);
      expect(result.affectedTaskIds.size).toBe(0);
    });

    it('should return no cycles for valid dependency chains', () => {
      const tasks = [
        createMockTask('task-1', { dependencies: [] }),
        createMockTask('task-2', { dependencies: ['task-1'] }),
        createMockTask('task-3', { dependencies: ['task-2'] })
      ];

      const result = detectDependencyCycles(tasks);

      expect(result.hasCycles).toBe(false);
    });

    it('should detect simple two-node cycle', () => {
      const tasks = [
        createMockTask('task-1', { dependencies: ['task-2'] }),
        createMockTask('task-2', { dependencies: ['task-1'] })
      ];

      const result = detectDependencyCycles(tasks);

      expect(result.hasCycles).toBe(true);
      expect(result.affectedTaskIds.has('task-1')).toBe(true);
      expect(result.affectedTaskIds.has('task-2')).toBe(true);
    });

    it('should detect self-referential cycle', () => {
      const tasks = [
        createMockTask('task-1', { dependencies: ['task-1'] })
      ];

      const result = detectDependencyCycles(tasks);

      expect(result.hasCycles).toBe(true);
      expect(result.affectedTaskIds.has('task-1')).toBe(true);
    });

    it('should detect multi-node cycle', () => {
      const tasks = [
        createMockTask('task-1', { dependencies: ['task-3'] }),
        createMockTask('task-2', { dependencies: ['task-1'] }),
        createMockTask('task-3', { dependencies: ['task-2'] })
      ];

      const result = detectDependencyCycles(tasks);

      expect(result.hasCycles).toBe(true);
      expect(result.affectedTaskIds.size).toBeGreaterThan(0);
    });

    it('should ignore dependencies on non-existent tasks', () => {
      const tasks = [
        createMockTask('task-1', { dependencies: ['non-existent'] }),
        createMockTask('task-2', { dependencies: ['task-1'] })
      ];

      const result = detectDependencyCycles(tasks);

      expect(result.hasCycles).toBe(false);
    });

    it('should handle empty task list', () => {
      const result = detectDependencyCycles([]);

      expect(result.hasCycles).toBe(false);
      expect(result.cycles).toHaveLength(0);
    });

    it('should detect multiple separate cycles', () => {
      const tasks = [
        // Cycle 1
        createMockTask('task-1', { dependencies: ['task-2'] }),
        createMockTask('task-2', { dependencies: ['task-1'] }),
        // Cycle 2 (separate)
        createMockTask('task-3', { dependencies: ['task-4'] }),
        createMockTask('task-4', { dependencies: ['task-3'] })
      ];

      const result = detectDependencyCycles(tasks);

      expect(result.hasCycles).toBe(true);
      // At least one cycle is detected
      expect(result.cycles.length).toBeGreaterThan(0);
    });
  });

  describe('resolveDependencies', () => {
    it('should return tasks in correct execution order (topological sort)', () => {
      const tasks = [
        createMockTask('task-3', { dependencies: ['task-2'] }),
        createMockTask('task-1', { dependencies: [] }),
        createMockTask('task-2', { dependencies: ['task-1'] })
      ];

      const result = resolveDependencies(tasks);

      expect(result.success).toBe(true);
      expect(result.sortedIds).toHaveLength(3);

      // Verify order: task-1 before task-2, task-2 before task-3
      const idx1 = result.sortedIds.indexOf('task-1');
      const idx2 = result.sortedIds.indexOf('task-2');
      const idx3 = result.sortedIds.indexOf('task-3');

      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);
    });

    it('should fail with cycle info when cycles exist', () => {
      const tasks = [
        createMockTask('task-1', { dependencies: ['task-2'] }),
        createMockTask('task-2', { dependencies: ['task-1'] })
      ];

      const result = resolveDependencies(tasks);

      expect(result.success).toBe(false);
      expect(result.cycleInfo).toBeDefined();
      expect(result.cycleInfo?.hasCycles).toBe(true);
    });

    it('should handle tasks with multiple dependencies', () => {
      const tasks = [
        createMockTask('task-1'),
        createMockTask('task-2'),
        createMockTask('task-3', { dependencies: ['task-1', 'task-2'] })
      ];

      const result = resolveDependencies(tasks);

      expect(result.success).toBe(true);

      const idx1 = result.sortedIds.indexOf('task-1');
      const idx2 = result.sortedIds.indexOf('task-2');
      const idx3 = result.sortedIds.indexOf('task-3');

      expect(idx3).toBeGreaterThan(idx1);
      expect(idx3).toBeGreaterThan(idx2);
    });

    it('should handle independent tasks', () => {
      const tasks = [
        createMockTask('task-1'),
        createMockTask('task-2'),
        createMockTask('task-3')
      ];

      const result = resolveDependencies(tasks);

      expect(result.success).toBe(true);
      expect(result.sortedIds).toHaveLength(3);
    });
  });

  describe('hasUnmetDependencies', () => {
    it('should return false for tasks without dependencies', () => {
      const task = createMockTask('task-1');
      const completedIds = new Set<string>();
      const allIds = new Set(['task-1']);

      expect(hasUnmetDependencies(task, completedIds, allIds)).toBe(false);
    });

    it('should return true for tasks with unmet dependencies', () => {
      const task = createMockTask('task-2', { dependencies: ['task-1'] });
      const completedIds = new Set<string>();
      const allIds = new Set(['task-1', 'task-2']);

      expect(hasUnmetDependencies(task, completedIds, allIds)).toBe(true);
    });

    it('should return false when dependencies are completed', () => {
      const task = createMockTask('task-2', { dependencies: ['task-1'] });
      const completedIds = new Set(['task-1']);
      const allIds = new Set(['task-1', 'task-2']);

      expect(hasUnmetDependencies(task, completedIds, allIds)).toBe(false);
    });

    it('should ignore dependencies not in task list', () => {
      const task = createMockTask('task-1', { dependencies: ['external-task'] });
      const completedIds = new Set<string>();
      const allIds = new Set(['task-1']);

      expect(hasUnmetDependencies(task, completedIds, allIds)).toBe(false);
    });
  });
});

// ============================================
// Task Prioritization Tests
// ============================================

describe('Task Prioritization', () => {
  describe('prioritizeTasks', () => {
    it('should sort tasks by priority score (highest first)', () => {
      const tasks = [
        createMockTask('task-1', { priority: { score: 3 } as TaskPriority }),
        createMockTask('task-2', { priority: { score: 8 } as TaskPriority }),
        createMockTask('task-3', { priority: { score: 5 } as TaskPriority })
      ];

      const result = prioritizeTasks(tasks);

      expect(result.tasks[0].id).toBe('task-2');
      expect(result.tasks[1].id).toBe('task-3');
      expect(result.tasks[2].id).toBe('task-1');
    });

    it('should separate ready and blocked tasks', () => {
      const tasks = [
        createMockTask('task-1'),
        createMockTask('task-2', { dependencies: ['task-1'] }),
        createMockTask('task-3')
      ];

      const result = prioritizeTasks(tasks);

      expect(result.readyTasks.map(t => t.id)).toContain('task-1');
      expect(result.readyTasks.map(t => t.id)).toContain('task-3');
      expect(result.blockedTasks.map(t => t.id)).toContain('task-2');
    });

    it('should move tasks to ready when dependencies are completed', () => {
      const tasks = [
        createMockTask('task-1'),
        createMockTask('task-2', { dependencies: ['task-1'] })
      ];

      const result = prioritizeTasks(tasks, {
        completedTaskIds: new Set(['task-1'])
      });

      expect(result.readyTasks.map(t => t.id)).toContain('task-2');
    });

    it('should filter out non-pending tasks', () => {
      const tasks = [
        createMockTask('task-1', { status: 'pending' }),
        createMockTask('task-2', { status: 'completed' }),
        createMockTask('task-3', { status: 'in_progress' }),
        createMockTask('task-4', { status: 'failed' })
      ];

      const result = prioritizeTasks(tasks);

      expect(result.readyTasks).toHaveLength(1);
      expect(result.readyTasks[0].id).toBe('task-1');
    });

    it('should exclude tasks in dependency cycles', () => {
      const tasks = [
        createMockTask('task-1', { dependencies: ['task-2'] }),
        createMockTask('task-2', { dependencies: ['task-1'] }),
        createMockTask('task-3')
      ];

      const result = prioritizeTasks(tasks);

      expect(result.cycleInfo).toBeDefined();
      expect(result.cycleInfo?.hasCycles).toBe(true);
      // task-3 should be in ready tasks
      expect(result.readyTasks.some(t => t.id === 'task-3')).toBe(true);
    });

    it('should handle empty task list', () => {
      const result = prioritizeTasks([]);

      expect(result.tasks).toHaveLength(0);
      expect(result.readyTasks).toHaveLength(0);
      expect(result.blockedTasks).toHaveLength(0);
    });

    it('should ignore dependencies when considerDependencies is false', () => {
      const tasks = [
        createMockTask('task-1'),
        createMockTask('task-2', { dependencies: ['task-1'] })
      ];

      const result = prioritizeTasks(tasks, { considerDependencies: false });

      expect(result.readyTasks).toHaveLength(2);
      expect(result.blockedTasks).toHaveLength(0);
    });
  });

  describe('getNextTask', () => {
    it('should return highest priority ready task', () => {
      const tasks = [
        createMockTask('task-1', { priority: { score: 3 } as TaskPriority }),
        createMockTask('task-2', { priority: { score: 8 } as TaskPriority }),
        createMockTask('task-3', { priority: { score: 5 } as TaskPriority })
      ];

      const nextTask = getNextTask(tasks);

      expect(nextTask?.id).toBe('task-2');
    });

    it('should return undefined when all tasks are blocked', () => {
      const tasks = [
        createMockTask('task-1', { dependencies: ['task-2'] }),
        createMockTask('task-2', { dependencies: ['task-1'] })
      ];

      const nextTask = getNextTask(tasks);

      expect(nextTask).toBeUndefined();
    });

    it('should skip blocked tasks and return ready task', () => {
      const tasks = [
        createMockTask('task-1', {
          priority: { score: 10 } as TaskPriority,
          dependencies: ['task-blocked']
        }),
        createMockTask('task-blocked'),
        createMockTask('task-2', { priority: { score: 5 } as TaskPriority })
      ];

      const nextTask = getNextTask(tasks);

      // task-blocked has highest score among ready tasks
      expect(nextTask?.id).not.toBe('task-1');
    });
  });

  describe('updateTaskPriorities', () => {
    it('should recalculate priorities for all tasks', () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      const tasks = [
        createMockTask('task-1', { createdAt: oldDate, priority: { score: 5 } as TaskPriority })
      ];

      const updatedTasks = updateTaskPriorities(tasks);

      // With 60 days age, recency should be higher
      expect(updatedTasks[0].priority.recency).toBeGreaterThan(5);
    });

    it('should use custom weights when provided', () => {
      const tasks = [
        createMockTask('task-1', {
          priority: { complexity: 5, impact: 8, priority: 6, score: 0 } as TaskPriority
        })
      ];

      const customWeights: PriorityWeights = {
        complexityWeight: 0,
        impactWeight: 1,
        priorityWeight: 0,
        recencyWeight: 0
      };

      const updatedTasks = updateTaskPriorities(tasks, customWeights);

      expect(updatedTasks[0].priority.score).toBe(8);
    });
  });
});

// ============================================
// Utility Functions Tests
// ============================================

describe('Utility Functions', () => {
  describe('validatePriorityWeights', () => {
    it('should return true for weights that sum to 1.0', () => {
      expect(validatePriorityWeights(DEFAULT_PRIORITY_WEIGHTS)).toBe(true);
    });

    it('should return true for weights within tolerance (0.01)', () => {
      const weights: PriorityWeights = {
        complexityWeight: 0.26,
        impactWeight: 0.25,
        priorityWeight: 0.25,
        recencyWeight: 0.24
      };
      expect(validatePriorityWeights(weights)).toBe(true);
    });

    it('should return false for weights that do not sum to 1.0', () => {
      const invalidWeights: PriorityWeights = {
        complexityWeight: 0.5,
        impactWeight: 0.5,
        priorityWeight: 0.5,
        recencyWeight: 0.5
      };
      expect(validatePriorityWeights(invalidWeights)).toBe(false);
    });
  });

  describe('complexityToScore', () => {
    it('should convert complexity strings to correct scores', () => {
      expect(complexityToScore('low')).toBe(3);
      expect(complexityToScore('medium')).toBe(5);
      expect(complexityToScore('high')).toBe(8);
    });

    it('should return default for unknown values', () => {
      expect(complexityToScore('unknown' as 'low')).toBe(5);
    });
  });

  describe('impactToScore', () => {
    it('should convert impact strings to correct scores', () => {
      expect(impactToScore('low')).toBe(3);
      expect(impactToScore('medium')).toBe(5);
      expect(impactToScore('high')).toBe(8);
    });
  });

  describe('moscowToScore', () => {
    it('should convert MoSCoW priorities to correct scores', () => {
      expect(moscowToScore('must')).toBe(10);
      expect(moscowToScore('should')).toBe(7);
      expect(moscowToScore('could')).toBe(4);
      expect(moscowToScore('wont')).toBe(1);
    });
  });

  describe('priorityFromLabels', () => {
    it('should detect critical priority from labels', () => {
      expect(priorityFromLabels(['critical'])).toBe(10);
      expect(priorityFromLabels(['P0'])).toBe(10);
      expect(priorityFromLabels(['urgent'])).toBe(10);
    });

    it('should detect high priority from labels', () => {
      expect(priorityFromLabels(['priority:high'])).toBe(8);
      expect(priorityFromLabels(['P1'])).toBe(8);
      expect(priorityFromLabels(['high-priority'])).toBe(8);
    });

    it('should detect medium priority from labels', () => {
      expect(priorityFromLabels(['priority:medium'])).toBe(5);
      expect(priorityFromLabels(['P2'])).toBe(5);
    });

    it('should detect low priority from labels', () => {
      expect(priorityFromLabels(['priority:low'])).toBe(3);
      expect(priorityFromLabels(['P3'])).toBe(3);
      expect(priorityFromLabels(['low-priority'])).toBe(3);
    });

    it('should return default for no matching labels', () => {
      expect(priorityFromLabels(['bug', 'enhancement'])).toBe(5);
      expect(priorityFromLabels([])).toBe(5);
    });

    it('should match labels in array order (first match wins)', () => {
      // Function processes labels in array order and returns on first match
      // 'priority:low' is matched first, so it returns 3
      expect(priorityFromLabels(['priority:low', 'critical'])).toBe(3);
      // 'critical' is first, so it returns 10
      expect(priorityFromLabels(['critical', 'priority:low'])).toBe(10);
    });

    it('should be case-insensitive', () => {
      expect(priorityFromLabels(['CRITICAL'])).toBe(10);
      expect(priorityFromLabels(['Priority:High'])).toBe(8);
    });
  });
});

// ============================================
// Edge Cases and Error Handling
// ============================================

describe('Edge Cases', () => {
  it('should handle tasks with empty priority object', () => {
    const tasks = [
      {
        id: 'task-1',
        title: 'Test',
        description: 'Test',
        source: {
          provider: 'github_issue' as const,
          issueNumber: 1,
          repository: 'test/repo',
          issueUrl: 'http://example.com',
          labels: []
        },
        status: 'pending' as const,
        priority: {
          complexity: 0,
          impact: 0,
          priority: 0,
          recency: 0,
          score: 0,
          level: 'low' as const
        },
        dependencies: [],
        blockedBy: [],
        createdAt: new Date(),
        retryCount: 0,
        maxRetries: 2
      }
    ];

    const result = prioritizeTasks(tasks);
    expect(result.readyTasks).toHaveLength(1);
  });

  it('should handle very large number of tasks', () => {
    const tasks = Array.from({ length: 1000 }, (_, i) =>
      createMockTask(`task-${i}`, { priority: { score: Math.random() * 10 } as TaskPriority })
    );

    const result = prioritizeTasks(tasks);

    expect(result.tasks.length).toBe(1000);
    // Verify sorted order
    for (let i = 1; i < result.tasks.length; i++) {
      expect(result.tasks[i - 1].priority.score).toBeGreaterThanOrEqual(result.tasks[i].priority.score);
    }
  });

  it('should handle complex dependency graph', () => {
    // Create a diamond dependency pattern: A -> B, A -> C, B -> D, C -> D
    const tasks = [
      createMockTask('A'),
      createMockTask('B', { dependencies: ['A'] }),
      createMockTask('C', { dependencies: ['A'] }),
      createMockTask('D', { dependencies: ['B', 'C'] })
    ];

    const result = resolveDependencies(tasks);

    expect(result.success).toBe(true);
    const idxA = result.sortedIds.indexOf('A');
    const idxB = result.sortedIds.indexOf('B');
    const idxC = result.sortedIds.indexOf('C');
    const idxD = result.sortedIds.indexOf('D');

    expect(idxA).toBeLessThan(idxB);
    expect(idxA).toBeLessThan(idxC);
    expect(idxB).toBeLessThan(idxD);
    expect(idxC).toBeLessThan(idxD);
  });
});
