/**
 * Performance Test Utilities for Plan Parsing Operations
 *
 * Measures timing for:
 * - JSON.parse operations
 * - Plan validation (validatePlanData)
 * - flatMap operations (subtask flattening)
 *
 * These tests establish baseline metrics before caching optimizations
 */
import { describe, it, expect } from 'vitest';
import type { ImplementationPlan, Phase, PlanSubtask } from '../../../shared/types';

// ============================================
// Mock Data Generators
// ============================================

/**
 * Create a mock subtask for testing
 */
function createMockSubtask(index: number): PlanSubtask {
  return {
    id: `subtask-${index}`,
    description: `Test subtask ${index} with description`,
    status: index % 4 === 0 ? 'completed' : index % 4 === 1 ? 'in_progress' : index % 4 === 2 ? 'failed' : 'pending',
    verification: {
      type: 'command',
      run: `npm test -- test-${index}`
    }
  };
}

/**
 * Create a mock phase with specified number of subtasks
 */
function createMockPhase(phaseNumber: number, subtaskCount: number): Phase {
  return {
    phase: phaseNumber,
    name: `Phase ${phaseNumber}`,
    type: phaseNumber % 3 === 0 ? 'implementation' : phaseNumber % 3 === 1 ? 'testing' : 'documentation',
    subtasks: Array.from({ length: subtaskCount }, (_, i) => createMockSubtask(phaseNumber * 100 + i)),
    depends_on: phaseNumber > 1 ? [phaseNumber - 1] : []
  };
}

/**
 * Create a mock implementation plan with specified number of phases and subtasks per phase
 */
function createMockPlan(phaseCount: number, subtasksPerPhase: number): ImplementationPlan {
  return {
    feature: `Test Feature with ${phaseCount} phases`,
    workflow_type: 'feature',
    services_involved: ['Frontend', 'Backend', 'Database'],
    phases: Array.from({ length: phaseCount }, (_, i) => createMockPhase(i + 1, subtasksPerPhase)),
    final_acceptance: [
      'All tests pass',
      'Code coverage above 80%',
      'No console errors'
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    spec_file: 'spec.md'
  };
}

// ============================================
// Performance Test Utilities
// ============================================

/**
 * Measure execution time of a function
 * Returns duration in milliseconds
 */
function measureTime(fn: () => void): number {
  const start = performance.now();
  fn();
  const end = performance.now();
  return end - start;
}

/**
 * Measure average execution time over multiple iterations
 */
function measureAverageTime(fn: () => void, iterations: number = 100): {
  average: number;
  min: number;
  max: number;
  median: number;
} {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    times.push(measureTime(fn));
  }

  const sorted = [...times].sort((a, b) => a - b);
  const average = times.reduce((sum, t) => sum + t, 0) / times.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];

  return { average, min, max, median };
}

/**
 * Test JSON.parse performance with different plan sizes
 */
function measureJsonParse(plan: ImplementationPlan, iterations: number = 100): {
  average: number;
  min: number;
  max: number;
  median: number;
  sizeBytes: number;
} {
  const jsonString = JSON.stringify(plan);
  const sizeBytes = new Blob([jsonString]).size;

  const timing = measureAverageTime(() => {
    JSON.parse(jsonString);
  }, iterations);

  return { ...timing, sizeBytes };
}

/**
 * Simplified validation logic for testing
 * Matches the validation in task-store.ts
 */
function validatePlanData(plan: ImplementationPlan): boolean {
  if (!plan.phases || !Array.isArray(plan.phases)) {
    return false;
  }

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i];
    if (!phase || !phase.subtasks || !Array.isArray(phase.subtasks)) {
      return false;
    }

    for (let j = 0; j < phase.subtasks.length; j++) {
      const subtask = phase.subtasks[j];
      if (!subtask || typeof subtask !== 'object') {
        return false;
      }

      if (!subtask.description || typeof subtask.description !== 'string' || subtask.description.trim() === '') {
        return false;
      }
    }
  }

  return true;
}

/**
 * Test plan validation performance
 */
function measureValidation(plan: ImplementationPlan, iterations: number = 100): {
  average: number;
  min: number;
  max: number;
  median: number;
} {
  return measureAverageTime(() => {
    validatePlanData(plan);
  }, iterations);
}

/**
 * Test flatMap performance (subtask extraction)
 * Matches the logic in updateTaskFromPlan
 */
function measureFlatMap(plan: ImplementationPlan, iterations: number = 100): {
  average: number;
  min: number;
  max: number;
  median: number;
  subtaskCount: number;
} {
  let subtaskCount = 0;

  const timing = measureAverageTime(() => {
    const subtasks = plan.phases.flatMap((phase) =>
      phase.subtasks.map((subtask) => {
        const id = subtask.id || `subtask-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const description = subtask.description || 'No description available';
        const title = description;
        const status = subtask.status || 'pending';

        return {
          id,
          title,
          description,
          status,
          files: [],
          verification: subtask.verification
        };
      })
    );
    subtaskCount = subtasks.length;
  }, iterations);

  return { ...timing, subtaskCount };
}

/**
 * Test combined operations (full updateTaskFromPlan flow)
 */
function measureCombinedOperations(plan: ImplementationPlan, iterations: number = 100): {
  average: number;
  min: number;
  max: number;
  median: number;
} {
  return measureAverageTime(() => {
    // 1. Validate
    if (!validatePlanData(plan)) {
      return;
    }

    // 2. Extract subtasks
    const subtasks = plan.phases.flatMap((phase) =>
      phase.subtasks.map((subtask) => {
        const id = subtask.id || `subtask-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const description = subtask.description || 'No description available';
        const title = description;
        const status = subtask.status || 'pending';

        return {
          id,
          title,
          description,
          status,
          files: [],
          verification: subtask.verification
        };
      })
    );

    // 3. Calculate status flags
    const allCompleted = subtasks.every((s) => s.status === 'completed');
    const anyFailed = subtasks.some((s) => s.status === 'failed');
    const anyInProgress = subtasks.some((s) => s.status === 'in_progress');
    const anyCompleted = subtasks.some((s) => s.status === 'completed');

    // Use the flags to prevent optimization
    return { allCompleted, anyFailed, anyInProgress, anyCompleted };
  }, iterations);
}

// ============================================
// Performance Tests
// ============================================

describe('Plan Parsing Performance Utilities', () => {
  describe('Mock Data Generators', () => {
    it('should create mock subtask with correct structure', () => {
      const subtask = createMockSubtask(1);

      expect(subtask).toHaveProperty('id');
      expect(subtask).toHaveProperty('description');
      expect(subtask).toHaveProperty('status');
      expect(subtask).toHaveProperty('verification');
      expect(subtask.id).toBe('subtask-1');
    });

    it('should create mock phase with specified subtask count', () => {
      const phase = createMockPhase(1, 5);

      expect(phase.phase).toBe(1);
      expect(phase.subtasks).toHaveLength(5);
      expect(phase.name).toBe('Phase 1');
    });

    it('should create mock plan with specified dimensions', () => {
      const plan = createMockPlan(3, 4);

      expect(plan.phases).toHaveLength(3);
      expect(plan.phases[0].subtasks).toHaveLength(4);
      expect(plan.phases[1].subtasks).toHaveLength(4);
      expect(plan.phases[2].subtasks).toHaveLength(4);
    });
  });

  describe('Performance Measurement Utilities', () => {
    it('should measure execution time', () => {
      const duration = measureTime(() => {
        // Simulate some work
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += i;
        }
      });

      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThan(100); // Should be fast
    });

    it('should measure average time with statistics', () => {
      const stats = measureAverageTime(() => {
        let sum = 0;
        for (let i = 0; i < 100; i++) {
          sum += i;
        }
      }, 50);

      expect(stats.average).toBeGreaterThan(0);
      expect(stats.min).toBeLessThanOrEqual(stats.average);
      expect(stats.max).toBeGreaterThanOrEqual(stats.average);
      expect(stats.median).toBeGreaterThan(0);
    });
  });

  describe('JSON.parse Performance', () => {
    it('should measure JSON.parse for small plan (2 phases, 5 subtasks each)', () => {
      const plan = createMockPlan(2, 5);
      const result = measureJsonParse(plan, 50);

      expect(result.average).toBeGreaterThan(0);
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.min).toBeLessThanOrEqual(result.average);
      expect(result.max).toBeGreaterThanOrEqual(result.average);

      // Log for baseline reference
      console.log('Small plan JSON.parse:', {
        phases: 2,
        subtasksPerPhase: 5,
        totalSubtasks: 10,
        sizeBytes: result.sizeBytes,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });

    it('should measure JSON.parse for medium plan (5 phases, 10 subtasks each)', () => {
      const plan = createMockPlan(5, 10);
      const result = measureJsonParse(plan, 50);

      expect(result.average).toBeGreaterThan(0);
      expect(result.sizeBytes).toBeGreaterThan(0);

      console.log('Medium plan JSON.parse:', {
        phases: 5,
        subtasksPerPhase: 10,
        totalSubtasks: 50,
        sizeBytes: result.sizeBytes,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });

    it('should measure JSON.parse for large plan (10 phases, 10 subtasks each)', () => {
      const plan = createMockPlan(10, 10);
      const result = measureJsonParse(plan, 50);

      expect(result.average).toBeGreaterThan(0);
      expect(result.sizeBytes).toBeGreaterThan(0);

      console.log('Large plan JSON.parse:', {
        phases: 10,
        subtasksPerPhase: 10,
        totalSubtasks: 100,
        sizeBytes: result.sizeBytes,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });
  });

  describe('Plan Validation Performance', () => {
    it('should measure validation for small plan', () => {
      const plan = createMockPlan(2, 5);
      const result = measureValidation(plan, 50);

      expect(result.average).toBeGreaterThan(0);

      console.log('Small plan validation:', {
        phases: 2,
        subtasksPerPhase: 5,
        totalSubtasks: 10,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });

    it('should measure validation for medium plan', () => {
      const plan = createMockPlan(5, 10);
      const result = measureValidation(plan, 50);

      expect(result.average).toBeGreaterThan(0);

      console.log('Medium plan validation:', {
        phases: 5,
        subtasksPerPhase: 10,
        totalSubtasks: 50,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });

    it('should measure validation for large plan', () => {
      const plan = createMockPlan(10, 10);
      const result = measureValidation(plan, 50);

      expect(result.average).toBeGreaterThan(0);

      console.log('Large plan validation:', {
        phases: 10,
        subtasksPerPhase: 10,
        totalSubtasks: 100,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });
  });

  describe('flatMap Operations Performance', () => {
    it('should measure flatMap for small plan', () => {
      const plan = createMockPlan(2, 5);
      const result = measureFlatMap(plan, 50);

      expect(result.average).toBeGreaterThan(0);
      expect(result.subtaskCount).toBe(10);

      console.log('Small plan flatMap:', {
        phases: 2,
        subtasksPerPhase: 5,
        totalSubtasks: 10,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });

    it('should measure flatMap for medium plan', () => {
      const plan = createMockPlan(5, 10);
      const result = measureFlatMap(plan, 50);

      expect(result.average).toBeGreaterThan(0);
      expect(result.subtaskCount).toBe(50);

      console.log('Medium plan flatMap:', {
        phases: 5,
        subtasksPerPhase: 10,
        totalSubtasks: 50,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });

    it('should measure flatMap for large plan', () => {
      const plan = createMockPlan(10, 10);
      const result = measureFlatMap(plan, 50);

      expect(result.average).toBeGreaterThan(0);
      expect(result.subtaskCount).toBe(100);

      console.log('Large plan flatMap:', {
        phases: 10,
        subtasksPerPhase: 10,
        totalSubtasks: 100,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });
  });

  describe('Combined Operations Performance', () => {
    it('should measure full updateTaskFromPlan flow for small plan', () => {
      const plan = createMockPlan(2, 5);
      const result = measureCombinedOperations(plan, 50);

      expect(result.average).toBeGreaterThan(0);

      console.log('Small plan combined ops:', {
        phases: 2,
        subtasksPerPhase: 5,
        totalSubtasks: 10,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });

    it('should measure full updateTaskFromPlan flow for medium plan', () => {
      const plan = createMockPlan(5, 10);
      const result = measureCombinedOperations(plan, 50);

      expect(result.average).toBeGreaterThan(0);

      console.log('Medium plan combined ops:', {
        phases: 5,
        subtasksPerPhase: 10,
        totalSubtasks: 50,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });

    it('should measure full updateTaskFromPlan flow for large plan', () => {
      const plan = createMockPlan(10, 10);
      const result = measureCombinedOperations(plan, 50);

      expect(result.average).toBeGreaterThan(0);

      console.log('Large plan combined ops:', {
        phases: 10,
        subtasksPerPhase: 10,
        totalSubtasks: 100,
        averageMs: result.average.toFixed(3),
        medianMs: result.median.toFixed(3)
      });
    });
  });

  describe('Performance Test Utilities Validation', () => {
    it('should validate correct plan structure', () => {
      const plan = createMockPlan(3, 5);
      expect(validatePlanData(plan)).toBe(true);
    });

    it('should reject plan with missing phases', () => {
      const invalidPlan = { feature: 'Test' } as any;
      expect(validatePlanData(invalidPlan)).toBe(false);
    });

    it('should reject plan with null phases', () => {
      const invalidPlan = { feature: 'Test', phases: null } as any;
      expect(validatePlanData(invalidPlan)).toBe(false);
    });

    it('should reject plan with phase missing subtasks', () => {
      const invalidPlan = {
        feature: 'Test',
        phases: [{ phase: 1, name: 'Phase 1', type: 'implementation' }]
      } as any;
      expect(validatePlanData(invalidPlan)).toBe(false);
    });

    it('should reject plan with subtask missing description', () => {
      const invalidPlan = {
        feature: 'Test',
        phases: [{
          phase: 1,
          name: 'Phase 1',
          type: 'implementation',
          subtasks: [{ id: 'subtask-1', status: 'pending' }]
        }]
      } as any;
      expect(validatePlanData(invalidPlan)).toBe(false);
    });
  });
});
