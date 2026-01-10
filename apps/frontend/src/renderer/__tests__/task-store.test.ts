/**
 * Unit tests for Task Store
 * Tests Zustand store for task state management
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTaskStore } from '../stores/task-store';
import { planCache } from '../stores/plan-cache';
import type { Task, TaskStatus, ImplementationPlan } from '../../shared/types';

// Helper to create test tasks
function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    specId: 'test-spec-001',
    projectId: 'project-1',
    title: 'Test Task',
    description: 'Test description',
    status: 'backlog' as TaskStatus,
    subtasks: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// Helper to create test implementation plan
function createTestPlan(overrides: Partial<ImplementationPlan> = {}): ImplementationPlan {
  return {
    feature: 'Test Feature',
    workflow_type: 'feature',
    services_involved: [],
    phases: [
      {
        phase: 1,
        name: 'Test Phase',
        type: 'implementation',
        subtasks: [
          { id: 'subtask-1', description: 'First subtask', status: 'pending' },
          { id: 'subtask-2', description: 'Second subtask', status: 'pending' }
        ]
      }
    ],
    final_acceptance: ['Tests pass'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    spec_file: 'spec.md',
    ...overrides
  };
}

describe('Task Store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useTaskStore.setState({
      tasks: [],
      selectedTaskId: null,
      isLoading: false,
      error: null
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Clear plan cache after each test to prevent test interference
    // The cache uses WeakMap keyed by plan objects, but tests reuse plans
    // with the same timestamps, leading to cache hits across tests
    planCache.clear();
  });

  describe('setTasks', () => {
    it('should set tasks array', () => {
      const tasks = [createTestTask({ id: 'task-1' }), createTestTask({ id: 'task-2' })];

      useTaskStore.getState().setTasks(tasks);

      expect(useTaskStore.getState().tasks).toHaveLength(2);
      expect(useTaskStore.getState().tasks[0].id).toBe('task-1');
    });

    it('should replace existing tasks', () => {
      const initialTasks = [createTestTask({ id: 'old-task' })];
      const newTasks = [createTestTask({ id: 'new-task' })];

      useTaskStore.getState().setTasks(initialTasks);
      useTaskStore.getState().setTasks(newTasks);

      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0].id).toBe('new-task');
    });

    it('should handle empty array', () => {
      useTaskStore.getState().setTasks([createTestTask()]);
      useTaskStore.getState().setTasks([]);

      expect(useTaskStore.getState().tasks).toHaveLength(0);
    });
  });

  describe('addTask', () => {
    it('should add task to empty array', () => {
      const task = createTestTask({ id: 'new-task' });

      useTaskStore.getState().addTask(task);

      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0].id).toBe('new-task');
    });

    it('should append task to existing array', () => {
      useTaskStore.setState({ tasks: [createTestTask({ id: 'existing' })] });

      useTaskStore.getState().addTask(createTestTask({ id: 'new-task' }));

      expect(useTaskStore.getState().tasks).toHaveLength(2);
      expect(useTaskStore.getState().tasks[1].id).toBe('new-task');
    });
  });

  describe('updateTask', () => {
    it('should update task by id', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', title: 'Original Title' })]
      });

      useTaskStore.getState().updateTask('task-1', { title: 'Updated Title' });

      expect(useTaskStore.getState().tasks[0].title).toBe('Updated Title');
    });

    it('should update task by specId', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', specId: 'spec-001', title: 'Original' })]
      });

      useTaskStore.getState().updateTask('spec-001', { title: 'Updated via specId' });

      expect(useTaskStore.getState().tasks[0].title).toBe('Updated via specId');
    });

    it('should not modify other tasks', () => {
      useTaskStore.setState({
        tasks: [
          createTestTask({ id: 'task-1', title: 'Task 1' }),
          createTestTask({ id: 'task-2', title: 'Task 2' })
        ]
      });

      useTaskStore.getState().updateTask('task-1', { title: 'Updated Task 1' });

      expect(useTaskStore.getState().tasks[0].title).toBe('Updated Task 1');
      expect(useTaskStore.getState().tasks[1].title).toBe('Task 2');
    });

    it('should merge updates with existing task', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', title: 'Original', description: 'Original Desc' })]
      });

      useTaskStore.getState().updateTask('task-1', { title: 'Updated' });

      expect(useTaskStore.getState().tasks[0].title).toBe('Updated');
      expect(useTaskStore.getState().tasks[0].description).toBe('Original Desc');
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status by id', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'backlog' })]
      });

      useTaskStore.getState().updateTaskStatus('task-1', 'in_progress');

      expect(useTaskStore.getState().tasks[0].status).toBe('in_progress');
    });

    it('should update task status by specId', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', specId: 'spec-001', status: 'backlog' })]
      });

      useTaskStore.getState().updateTaskStatus('spec-001', 'done');

      expect(useTaskStore.getState().tasks[0].status).toBe('done');
    });

    it('should update updatedAt timestamp', () => {
      const originalDate = new Date('2024-01-01');
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', updatedAt: originalDate })]
      });

      useTaskStore.getState().updateTaskStatus('task-1', 'in_progress');

      expect(useTaskStore.getState().tasks[0].updatedAt.getTime()).toBeGreaterThan(
        originalDate.getTime()
      );
    });
  });

  describe('updateTaskFromPlan', () => {
    it('should extract subtasks from plan', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'c1', description: 'Subtask 1', status: 'completed' },
              { id: 'c2', description: 'Subtask 2', status: 'pending' }
            ]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(2);
      expect(useTaskStore.getState().tasks[0].subtasks[0].id).toBe('c1');
      expect(useTaskStore.getState().tasks[0].subtasks[0].status).toBe('completed');
    });

    it('should extract subtasks from multiple phases', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1' })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [{ id: 'c1', description: 'Subtask 1', status: 'completed' }]
          },
          {
            phase: 2,
            name: 'Phase 2',
            type: 'cleanup',
            subtasks: [{ id: 'c2', description: 'Subtask 2', status: 'pending' }]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(2);
    });

    it('should update status to ai_review when all subtasks completed', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'in_progress' })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'c1', description: 'Subtask 1', status: 'completed' },
              { id: 'c2', description: 'Subtask 2', status: 'completed' }
            ]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].status).toBe('ai_review');
    });

    it('should update status to human_review when any subtask failed', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'in_progress' })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'c1', description: 'Subtask 1', status: 'completed' },
              { id: 'c2', description: 'Subtask 2', status: 'failed' }
            ]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].status).toBe('human_review');
    });

    it('should update status to in_progress when some subtasks in progress', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', status: 'backlog' })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'c1', description: 'Subtask 1', status: 'completed' },
              { id: 'c2', description: 'Subtask 2', status: 'in_progress' }
            ]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].status).toBe('in_progress');
    });

    it('should update title from plan feature', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', title: 'Original Title' })]
      });

      const plan = createTestPlan({ feature: 'New Feature Name' });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].title).toBe('New Feature Name');
    });

    it('should NOT update status when task is in active execution phase (planning)', () => {
      useTaskStore.setState({
        tasks: [createTestTask({
          id: 'task-1',
          status: 'in_progress',
          executionProgress: { phase: 'planning', phaseProgress: 10, overallProgress: 5 }
        })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'c1', description: 'Subtask 1', status: 'completed' },
              { id: 'c2', description: 'Subtask 2', status: 'completed' }
            ]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].status).toBe('in_progress');
      expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(2);
    });

    it('should NOT update status when task is in active execution phase (coding)', () => {
      useTaskStore.setState({
        tasks: [createTestTask({
          id: 'task-1',
          status: 'in_progress',
          executionProgress: { phase: 'coding', phaseProgress: 50, overallProgress: 40 }
        })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'c1', description: 'Subtask 1', status: 'completed' },
              { id: 'c2', description: 'Subtask 2', status: 'completed' }
            ]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].status).toBe('in_progress');
    });

    it('should update status when task is in idle phase', () => {
      useTaskStore.setState({
        tasks: [createTestTask({
          id: 'task-1',
          status: 'in_progress',
          executionProgress: { phase: 'idle', phaseProgress: 0, overallProgress: 0 }
        })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'c1', description: 'Subtask 1', status: 'completed' },
              { id: 'c2', description: 'Subtask 2', status: 'completed' }
            ]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].status).toBe('ai_review');
    });

    it('should update status when task has no execution progress', () => {
      useTaskStore.setState({
        tasks: [createTestTask({
          id: 'task-1',
          status: 'backlog',
          executionProgress: undefined
        })]
      });

      const plan = createTestPlan({
        phases: [
          {
            phase: 1,
            name: 'Phase 1',
            type: 'implementation',
            subtasks: [
              { id: 'c1', description: 'Subtask 1', status: 'completed' },
              { id: 'c2', description: 'Subtask 2', status: 'completed' }
            ]
          }
        ]
      });

      useTaskStore.getState().updateTaskFromPlan('task-1', plan);

      expect(useTaskStore.getState().tasks[0].status).toBe('ai_review');
    });
  });

  describe('appendLog', () => {
    it('should append log to task by id', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', logs: [] })]
      });

      useTaskStore.getState().appendLog('task-1', 'First log');
      useTaskStore.getState().appendLog('task-1', 'Second log');

      expect(useTaskStore.getState().tasks[0].logs).toHaveLength(2);
      expect(useTaskStore.getState().tasks[0].logs[0]).toBe('First log');
      expect(useTaskStore.getState().tasks[0].logs[1]).toBe('Second log');
    });

    it('should append log to task by specId', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', specId: 'spec-001', logs: [] })]
      });

      useTaskStore.getState().appendLog('spec-001', 'Log message');

      expect(useTaskStore.getState().tasks[0].logs).toContain('Log message');
    });

    it('should accumulate logs correctly', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1', logs: ['existing log'] })]
      });

      useTaskStore.getState().appendLog('task-1', 'new log');

      expect(useTaskStore.getState().tasks[0].logs).toHaveLength(2);
      expect(useTaskStore.getState().tasks[0].logs[0]).toBe('existing log');
      expect(useTaskStore.getState().tasks[0].logs[1]).toBe('new log');
    });
  });

  describe('selectTask', () => {
    it('should set selected task id', () => {
      useTaskStore.getState().selectTask('task-1');

      expect(useTaskStore.getState().selectedTaskId).toBe('task-1');
    });

    it('should clear selection with null', () => {
      useTaskStore.setState({ selectedTaskId: 'task-1' });

      useTaskStore.getState().selectTask(null);

      expect(useTaskStore.getState().selectedTaskId).toBeNull();
    });
  });

  describe('setLoading', () => {
    it('should set loading state to true', () => {
      useTaskStore.getState().setLoading(true);

      expect(useTaskStore.getState().isLoading).toBe(true);
    });

    it('should set loading state to false', () => {
      useTaskStore.setState({ isLoading: true });

      useTaskStore.getState().setLoading(false);

      expect(useTaskStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('should set error message', () => {
      useTaskStore.getState().setError('Something went wrong');

      expect(useTaskStore.getState().error).toBe('Something went wrong');
    });

    it('should clear error with null', () => {
      useTaskStore.setState({ error: 'Previous error' });

      useTaskStore.getState().setError(null);

      expect(useTaskStore.getState().error).toBeNull();
    });
  });

  describe('clearTasks', () => {
    it('should clear all tasks and selection', () => {
      useTaskStore.setState({
        tasks: [createTestTask(), createTestTask()],
        selectedTaskId: 'task-1'
      });

      useTaskStore.getState().clearTasks();

      expect(useTaskStore.getState().tasks).toHaveLength(0);
      expect(useTaskStore.getState().selectedTaskId).toBeNull();
    });
  });

  describe('getSelectedTask', () => {
    it('should return undefined when no task selected', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1' })],
        selectedTaskId: null
      });

      const selected = useTaskStore.getState().getSelectedTask();

      expect(selected).toBeUndefined();
    });

    it('should return selected task', () => {
      useTaskStore.setState({
        tasks: [
          createTestTask({ id: 'task-1', title: 'Task 1' }),
          createTestTask({ id: 'task-2', title: 'Task 2' })
        ],
        selectedTaskId: 'task-2'
      });

      const selected = useTaskStore.getState().getSelectedTask();

      expect(selected).toBeDefined();
      expect(selected?.title).toBe('Task 2');
    });

    it('should return undefined for non-existent selected id', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ id: 'task-1' })],
        selectedTaskId: 'nonexistent'
      });

      const selected = useTaskStore.getState().getSelectedTask();

      expect(selected).toBeUndefined();
    });
  });

  describe('getTasksByStatus', () => {
    it('should return empty array when no tasks match status', () => {
      useTaskStore.setState({
        tasks: [createTestTask({ status: 'backlog' })]
      });

      const tasks = useTaskStore.getState().getTasksByStatus('in_progress');

      expect(tasks).toHaveLength(0);
    });

    it('should return all tasks with matching status', () => {
      useTaskStore.setState({
        tasks: [
          createTestTask({ id: 'task-1', status: 'in_progress' }),
          createTestTask({ id: 'task-2', status: 'backlog' }),
          createTestTask({ id: 'task-3', status: 'in_progress' })
        ]
      });

      const tasks = useTaskStore.getState().getTasksByStatus('in_progress');

      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.id)).toContain('task-1');
      expect(tasks.map((t) => t.id)).toContain('task-3');
    });

    it('should filter by each status type', () => {
      const statuses: TaskStatus[] = ['backlog', 'in_progress', 'ai_review', 'human_review', 'done'];

      useTaskStore.setState({
        tasks: statuses.map((status) => createTestTask({ id: `task-${status}`, status }))
      });

      statuses.forEach((status) => {
        const tasks = useTaskStore.getState().getTasksByStatus(status);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].status).toBe(status);
      });
    });
  });

  describe('updateTaskFromPlan - validation and subtask creation edge cases', () => {
    beforeEach(() => {
      // Spy on console methods to test validation logging and prevent crashes
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('plan validation', () => {
      it('should reject plan with missing phases array', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const invalidPlan = { feature: 'Test' } as any;

        useTaskStore.getState().updateTaskFromPlan('task-1', invalidPlan);

        // Task should not be updated when plan is invalid
        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(0);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid plan: missing or invalid phases array')
        );
      });

      it('should reject plan with null phases', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const invalidPlan = {
          feature: 'Test',
          phases: null
        } as any;

        useTaskStore.getState().updateTaskFromPlan('task-1', invalidPlan);

        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(0);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid plan: missing or invalid phases array')
        );
      });

      it('should reject plan with phase missing subtasks array', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const invalidPlan = {
          feature: 'Test',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation'
              // Missing subtasks
            }
          ]
        } as any;

        useTaskStore.getState().updateTaskFromPlan('task-1', invalidPlan);

        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(0);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid phase 0: missing or invalid subtasks array')
        );
      });

      it('should reject plan with phase having subtasks not as array', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const invalidPlan = {
          feature: 'Test',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: 'not-an-array'
            }
          ]
        } as any;

        useTaskStore.getState().updateTaskFromPlan('task-1', invalidPlan);

        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(0);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid phase 0: missing or invalid subtasks array')
        );
      });

      it('should reject plan with subtask not being an object', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const invalidPlan = {
          feature: 'Test',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: ['not-an-object', 'also-not-an-object']
            }
          ]
        } as any;

        useTaskStore.getState().updateTaskFromPlan('task-1', invalidPlan);

        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(0);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid subtask at phase 0, index 0: not an object')
        );
      });

      it('should reject plan with subtask missing description', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const invalidPlan = {
          feature: 'Test',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', status: 'pending' } // Missing description
              ]
            }
          ]
        } as any;

        useTaskStore.getState().updateTaskFromPlan('task-1', invalidPlan);

        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(0);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid subtask at phase 0, index 0: missing or empty description')
        );
      });

      it('should reject plan with subtask having empty description', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const invalidPlan = {
          feature: 'Test',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: '', status: 'pending' }
              ]
            }
          ]
        } as any;

        useTaskStore.getState().updateTaskFromPlan('task-1', invalidPlan);

        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(0);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid subtask at phase 0, index 0: missing or empty description')
        );
      });

      it('should reject plan with subtask having whitespace-only description', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const invalidPlan = {
          feature: 'Test',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: '   ', status: 'pending' }
              ]
            }
          ]
        } as any;

        useTaskStore.getState().updateTaskFromPlan('task-1', invalidPlan);

        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(0);
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalid subtask at phase 0, index 0: missing or empty description')
        );
      });

      it('should accept valid plan with all required fields', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const validPlan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'Valid subtask', status: 'pending' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', validPlan);

        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(1);
        expect(useTaskStore.getState().tasks[0].subtasks[0].description).toBe('Valid subtask');
      });
    });

    describe('subtask creation edge cases', () => {
      it('should generate id for subtask missing id', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { description: 'Subtask without id', status: 'pending' } as any
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        const subtask = useTaskStore.getState().tasks[0].subtasks[0];
        expect(subtask.id).toBeDefined();
        // Accept either UUID format (crypto.randomUUID) or fallback format (subtask-timestamp-random)
        expect(subtask.id).toMatch(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|subtask-\d+-[a-z0-9]+)$/);
      });

      it('should use description as title for subtasks', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'Test Description', status: 'pending' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        const subtask = useTaskStore.getState().tasks[0].subtasks[0];
        expect(subtask.title).toBe('Test Description');
        expect(subtask.description).toBe('Test Description');
      });

      it('should accept all valid subtask statuses', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'Pending subtask', status: 'pending' },
                { id: 'subtask-2', description: 'In progress subtask', status: 'in_progress' },
                { id: 'subtask-3', description: 'Completed subtask', status: 'completed' },
                { id: 'subtask-4', description: 'Failed subtask', status: 'failed' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        const subtasks = useTaskStore.getState().tasks[0].subtasks;
        expect(subtasks[0].status).toBe('pending');
        expect(subtasks[1].status).toBe('in_progress');
        expect(subtasks[2].status).toBe('completed');
        expect(subtasks[3].status).toBe('failed');
      });

      it('should default status to pending when status is missing', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'Test subtask' } as any
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        const subtask = useTaskStore.getState().tasks[0].subtasks[0];
        expect(subtask.status).toBe('pending');
      });

      it('should initialize subtask with empty files array', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'Test subtask', status: 'pending' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        const subtask = useTaskStore.getState().tasks[0].subtasks[0];
        expect(subtask.files).toEqual([]);
      });

      it('should preserve verification field from plan subtask', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                {
                  id: 'subtask-1',
                  description: 'Test subtask',
                  status: 'pending',
                  verification: { type: 'command', run: 'npm test' }
                }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        const subtask = useTaskStore.getState().tasks[0].subtasks[0];
        expect(subtask.verification).toEqual({ type: 'command', run: 'npm test' });
      });

      it('should handle subtask with verification undefined', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                {
                  id: 'subtask-1',
                  description: 'Test subtask',
                  status: 'pending'
                  // verification is undefined
                }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        const subtask = useTaskStore.getState().tasks[0].subtasks[0];
        expect(subtask.verification).toBeUndefined();
      });

      it('should flatten subtasks from all phases in correct order', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'p1-s1', description: 'Phase 1 Subtask 1', status: 'pending' },
                { id: 'p1-s2', description: 'Phase 1 Subtask 2', status: 'pending' }
              ]
            },
            {
              phase: 2,
              name: 'Phase 2',
              type: 'testing',
              subtasks: [
                { id: 'p2-s1', description: 'Phase 2 Subtask 1', status: 'pending' },
                { id: 'p2-s2', description: 'Phase 2 Subtask 2', status: 'pending' }
              ]
            },
            {
              phase: 3,
              name: 'Phase 3',
              type: 'cleanup',
              subtasks: [
                { id: 'p3-s1', description: 'Phase 3 Subtask 1', status: 'pending' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        const subtasks = useTaskStore.getState().tasks[0].subtasks;
        expect(subtasks).toHaveLength(5);
        expect(subtasks[0].id).toBe('p1-s1');
        expect(subtasks[1].id).toBe('p1-s2');
        expect(subtasks[2].id).toBe('p2-s1');
        expect(subtasks[3].id).toBe('p2-s2');
        expect(subtasks[4].id).toBe('p3-s1');
      });

      it('should handle phase with empty subtasks array', () => {
        useTaskStore.setState({
          tasks: [createTestTask({ id: 'task-1', subtasks: [] })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'Valid subtask', status: 'pending' }
              ]
            },
            {
              phase: 2,
              name: 'Phase 2',
              type: 'testing',
              subtasks: [] // Empty array
            },
            {
              phase: 3,
              name: 'Phase 3',
              type: 'cleanup',
              subtasks: [
                { id: 'subtask-2', description: 'Another valid subtask', status: 'pending' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        const subtasks = useTaskStore.getState().tasks[0].subtasks;
        expect(subtasks).toHaveLength(2);
        expect(subtasks[0].id).toBe('subtask-1');
        expect(subtasks[1].id).toBe('subtask-2');
      });
    });

    // FIX (PR Review): Test coverage for terminal phase status preservation
    describe('terminal phase status preservation', () => {
      it('should NOT update status when task is in terminal phase (complete)', () => {
        useTaskStore.setState({
          tasks: [createTestTask({
            id: 'task-1',
            status: 'human_review',
            executionProgress: { phase: 'complete', phaseProgress: 100, overallProgress: 100 }
          })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'c1', description: 'Subtask 1', status: 'completed' },
                { id: 'c2', description: 'Subtask 2', status: 'completed' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Status should remain human_review, not be recalculated to ai_review
        expect(useTaskStore.getState().tasks[0].status).toBe('human_review');
      });

      it('should NOT update status when task is in terminal phase (failed)', () => {
        useTaskStore.setState({
          tasks: [createTestTask({
            id: 'task-1',
            status: 'human_review',
            executionProgress: { phase: 'failed', phaseProgress: 50, overallProgress: 30 }
          })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'c1', description: 'Subtask 1', status: 'completed' },
                { id: 'c2', description: 'Subtask 2', status: 'failed' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Status should remain human_review, not be recalculated
        expect(useTaskStore.getState().tasks[0].status).toBe('human_review');
      });
    });

    // FIX (PR Review): Test coverage for explicit human_review from plan file
    describe('explicit human_review from plan file', () => {
      it('should skip status recalculation when plan explicitly sets human_review', () => {
        useTaskStore.setState({
          tasks: [createTestTask({
            id: 'task-1',
            status: 'backlog',
            executionProgress: undefined
          })]
        });

        // Plan explicitly sets status to human_review
        const plan = {
          ...createTestPlan({
            phases: [
              {
                phase: 1,
                name: 'Phase 1',
                type: 'implementation',
                subtasks: [
                  { id: 'c1', description: 'Subtask 1', status: 'completed' },
                  { id: 'c2', description: 'Subtask 2', status: 'completed' }
                ]
              }
            ]
          }),
          status: 'human_review' as const
        };

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Status should remain unchanged (backlog) because when plan explicitly
        // sets human_review, status recalculation is skipped entirely
        expect(useTaskStore.getState().tasks[0].status).toBe('backlog');
      });

      it('should NOT preserve status when plan does not explicitly set human_review', () => {
        useTaskStore.setState({
          tasks: [createTestTask({
            id: 'task-1',
            status: 'backlog',
            executionProgress: undefined
          })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'c1', description: 'Subtask 1', status: 'completed' },
                { id: 'c2', description: 'Subtask 2', status: 'completed' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Status should be recalculated to ai_review since no explicit human_review
        expect(useTaskStore.getState().tasks[0].status).toBe('ai_review');
      });
    });

    // FIX (PR Review): Test coverage for terminal status downgrade prevention
    describe('terminal status downgrade prevention', () => {
      it('should NOT downgrade from pr_created to ai_review', () => {
        useTaskStore.setState({
          tasks: [createTestTask({
            id: 'task-1',
            status: 'pr_created',
            executionProgress: undefined
          })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'c1', description: 'Subtask 1', status: 'completed' },
                { id: 'c2', description: 'Subtask 2', status: 'completed' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Status should remain pr_created, not downgrade to ai_review
        expect(useTaskStore.getState().tasks[0].status).toBe('pr_created');
      });

      it('should NOT downgrade from done to ai_review', () => {
        useTaskStore.setState({
          tasks: [createTestTask({
            id: 'task-1',
            status: 'done',
            executionProgress: undefined
          })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'c1', description: 'Subtask 1', status: 'completed' },
                { id: 'c2', description: 'Subtask 2', status: 'completed' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Status should remain done, not downgrade to ai_review
        expect(useTaskStore.getState().tasks[0].status).toBe('done');
      });

      it('should NOT downgrade from human_review to ai_review', () => {
        useTaskStore.setState({
          tasks: [createTestTask({
            id: 'task-1',
            status: 'human_review',
            executionProgress: undefined
          })]
        });

        const plan = createTestPlan({
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'c1', description: 'Subtask 1', status: 'completed' },
                { id: 'c2', description: 'Subtask 2', status: 'completed' }
              ]
            }
          ]
        });

        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Status should remain human_review, not downgrade to ai_review
        expect(useTaskStore.getState().tasks[0].status).toBe('human_review');
      });
    });
  });

  // Cache-specific tests for updateTaskFromPlan optimization
  describe('updateTaskFromPlan - caching behavior', () => {
    beforeEach(() => {
      // Spy on console methods to prevent test output clutter
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('early exit on unchanged plans', () => {
      it('should skip update when plan hash is unchanged', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'First subtask', status: 'pending' }
              ]
            }
          ]
        });

        // First call - should process and cache
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        const firstUpdate = useTaskStore.getState().tasks[0];
        expect(firstUpdate.subtasks).toHaveLength(1);

        // Store reference to verify no state change
        const tasksBefore = useTaskStore.getState().tasks;

        // Second call with same plan - should use cache and early exit (no state update)
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        const tasksAfter = useTaskStore.getState().tasks;

        // State should not have changed (early exit)
        expect(tasksBefore).toBe(tasksAfter);
      });

      it('should update when plan hash changes (different updated_at)', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan1 = createTestPlan({
          feature: 'Version 1',
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [{ id: 'subtask-1', description: 'First subtask', status: 'pending' }]
            }
          ]
        });

        const plan2 = {
          ...plan1,
          feature: 'Version 2',
          updated_at: '2024-01-01T00:01:00.000Z' // Different timestamp
        };

        // First call
        useTaskStore.getState().updateTaskFromPlan('task-1', plan1);
        expect(useTaskStore.getState().tasks[0].title).toBe('Version 1');

        // Second call with different updated_at - should process and update
        useTaskStore.getState().updateTaskFromPlan('task-1', plan2);
        expect(useTaskStore.getState().tasks[0].title).toBe('Version 2');
      });

      it('should update when plan hash changes (different phase count)', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan1 = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [{ id: 'subtask-1', description: 'First subtask', status: 'pending' }]
            }
          ]
        });

        const plan2 = {
          ...plan1,
          phases: [
            ...plan1.phases,
            {
              phase: 2,
              name: 'Phase 2',
              type: 'testing',
              subtasks: [{ id: 'subtask-2', description: 'Second subtask', status: 'pending' }]
            }
          ]
        };

        // First call
        useTaskStore.getState().updateTaskFromPlan('task-1', plan1);
        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(1);

        // Second call with additional phase - should process and update
        useTaskStore.getState().updateTaskFromPlan('task-1', plan2);
        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(2);
      });

      it('should update when plan hash changes (different phase IDs)', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan1 = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [{ id: 'subtask-1', description: 'First subtask', status: 'pending' }]
            }
          ]
        });

        const plan2 = {
          ...plan1,
          phases: [
            {
              phase: 2, // Different phase ID
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [{ id: 'subtask-1', description: 'First subtask', status: 'pending' }]
            }
          ]
        };

        // First call
        useTaskStore.getState().updateTaskFromPlan('task-1', plan1);
        const firstUpdate = useTaskStore.getState().tasks[0];

        // Store reference to verify state change
        const tasksBefore = useTaskStore.getState().tasks;

        // Second call with different phase ID - should process and update
        useTaskStore.getState().updateTaskFromPlan('task-1', plan2);
        const tasksAfter = useTaskStore.getState().tasks;

        // State should have changed (no early exit)
        expect(tasksBefore).not.toBe(tasksAfter);
      });
    });

    describe('cache invalidation', () => {
      it('should clear cache when setTasks is called', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [{ id: 'subtask-1', description: 'First subtask', status: 'pending' }]
            }
          ]
        });

        // Populate cache
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Replace tasks (should clear cache)
        const newTask = createTestTask({ id: 'task-2', status: 'backlog' });
        useTaskStore.getState().setTasks([newTask]);

        // Add original task back
        useTaskStore.getState().addTask(task);

        // Now updateTaskFromPlan should not hit cache (because it was cleared)
        // We can't directly test cache state, but we can verify the function still works correctly
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        expect(useTaskStore.getState().tasks[1].subtasks).toHaveLength(1);
      });

      it('should clear cache when clearTasks is called', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [{ id: 'subtask-1', description: 'First subtask', status: 'pending' }]
            }
          ]
        });

        // Populate cache
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Clear all tasks (should clear cache)
        useTaskStore.getState().clearTasks();

        // Add task back
        useTaskStore.getState().addTask(task);

        // Now updateTaskFromPlan should not hit cache (because it was cleared)
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(1);
      });

      it('should invalidate cache after multiple setTasks calls', () => {
        const task1 = createTestTask({ id: 'task-1', status: 'in_progress' });
        const task2 = createTestTask({ id: 'task-2', status: 'backlog' });

        const plan = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [{ id: 'subtask-1', description: 'First subtask', status: 'pending' }]
            }
          ]
        });

        // First setTasks
        useTaskStore.getState().setTasks([task1]);
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Second setTasks (should clear cache)
        useTaskStore.getState().setTasks([task2]);

        // Third setTasks back to task1
        useTaskStore.getState().setTasks([task1]);

        // Cache should be cleared, but function should still work
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(1);
      });
    });

    describe('cached subtasks usage', () => {
      it('should reuse cached subtasks on repeated calls with same plan', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'First subtask', status: 'pending' },
                { id: 'subtask-2', description: 'Second subtask', status: 'completed' }
              ]
            }
          ]
        });

        // First call - computes subtasks
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        const firstSubtasks = useTaskStore.getState().tasks[0].subtasks;
        expect(firstSubtasks).toHaveLength(2);

        // Second call - should use cached subtasks (early exit, no state update)
        const tasksBefore = useTaskStore.getState().tasks;
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        const tasksAfter = useTaskStore.getState().tasks;

        // State unchanged due to early exit
        expect(tasksBefore).toBe(tasksAfter);
      });

      it('should handle multiple tasks with separate cache entries', () => {
        const task1 = createTestTask({ id: 'task-1', status: 'in_progress' });
        const task2 = createTestTask({ id: 'task-2', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task1, task2] });

        const plan1 = createTestPlan({
          feature: 'Feature 1',
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [{ id: 'subtask-1', description: 'Task 1 subtask', status: 'pending' }]
            }
          ]
        });

        const plan2 = createTestPlan({
          feature: 'Feature 2',
          updated_at: '2024-01-02T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-2', description: 'Task 2 subtask 1', status: 'pending' },
                { id: 'subtask-3', description: 'Task 2 subtask 2', status: 'completed' }
              ]
            }
          ]
        });

        // Update both tasks
        useTaskStore.getState().updateTaskFromPlan('task-1', plan1);
        useTaskStore.getState().updateTaskFromPlan('task-2', plan2);

        // Verify both cached correctly
        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(1);
        expect(useTaskStore.getState().tasks[1].subtasks).toHaveLength(2);
        expect(useTaskStore.getState().tasks[0].title).toBe('Feature 1');
        expect(useTaskStore.getState().tasks[1].title).toBe('Feature 2');

        // Update both again with same plans - should use cache
        const tasksBefore = useTaskStore.getState().tasks;
        useTaskStore.getState().updateTaskFromPlan('task-1', plan1);
        const tasksAfter = useTaskStore.getState().tasks;

        // State should not change (early exit)
        expect(tasksBefore).toBe(tasksAfter);
      });
    });

    describe('cached status flags usage', () => {
      it('should reuse cached status flags on repeated calls', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'First subtask', status: 'completed' },
                { id: 'subtask-2', description: 'Second subtask', status: 'completed' }
              ]
            }
          ]
        });

        // First call - computes status flags and updates status to ai_review
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        expect(useTaskStore.getState().tasks[0].status).toBe('ai_review');

        // Change status back to in_progress manually
        useTaskStore.getState().updateTaskStatus('task-1', 'in_progress');

        // Second call with same plan - should use cached status flags and early exit
        const tasksBefore = useTaskStore.getState().tasks;
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        const tasksAfter = useTaskStore.getState().tasks;

        // State unchanged due to early exit
        expect(tasksBefore).toBe(tasksAfter);
      });

      it('should recalculate status flags when plan changes', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan1 = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'First subtask', status: 'in_progress' }
              ]
            }
          ]
        });

        const plan2 = {
          ...plan1,
          updated_at: '2024-01-01T00:01:00.000Z', // Different timestamp
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'First subtask', status: 'completed' }
              ]
            }
          ]
        };

        // First call - status should remain in_progress (subtask in_progress)
        useTaskStore.getState().updateTaskFromPlan('task-1', plan1);
        expect(useTaskStore.getState().tasks[0].status).toBe('in_progress');

        // Second call - status should change to ai_review (all subtasks completed)
        useTaskStore.getState().updateTaskFromPlan('task-1', plan2);
        expect(useTaskStore.getState().tasks[0].status).toBe('ai_review');
      });

      it('should handle failed subtasks status flags correctly', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: [
                { id: 'subtask-1', description: 'First subtask', status: 'completed' },
                { id: 'subtask-2', description: 'Second subtask', status: 'failed' }
              ]
            }
          ]
        });

        // First call - should set status to human_review (anyFailed)
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        expect(useTaskStore.getState().tasks[0].status).toBe('human_review');
        expect(useTaskStore.getState().tasks[0].reviewReason).toBe('errors');

        // Second call - should use cache and early exit
        const tasksBefore = useTaskStore.getState().tasks;
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        const tasksAfter = useTaskStore.getState().tasks;

        expect(tasksBefore).toBe(tasksAfter);
      });
    });

    describe('cache performance characteristics', () => {
      it('should handle rapid repeated updates efficiently with caching', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: [
            {
              phase: 1,
              name: 'Phase 1',
              type: 'implementation',
              subtasks: Array.from({ length: 50 }, (_, i) => ({
                id: `subtask-${i}`,
                description: `Subtask ${i}`,
                status: i < 25 ? 'completed' : 'pending'
              }))
            }
          ]
        });

        // First call - populates cache
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);

        // Rapid repeated calls - all should use cache and early exit
        for (let i = 0; i < 10; i++) {
          const tasksBefore = useTaskStore.getState().tasks;
          useTaskStore.getState().updateTaskFromPlan('task-1', plan);
          const tasksAfter = useTaskStore.getState().tasks;

          // All subsequent calls should early exit (no state change)
          expect(tasksBefore).toBe(tasksAfter);
        }
      });

      it('should handle large plans with multiple phases efficiently', () => {
        const task = createTestTask({ id: 'task-1', status: 'in_progress' });
        useTaskStore.setState({ tasks: [task] });

        const plan = createTestPlan({
          updated_at: '2024-01-01T00:00:00.000Z',
          phases: Array.from({ length: 10 }, (_, phaseIdx) => ({
            phase: phaseIdx + 1,
            name: `Phase ${phaseIdx + 1}`,
            type: 'implementation',
            subtasks: Array.from({ length: 10 }, (_, subtaskIdx) => ({
              id: `phase-${phaseIdx}-subtask-${subtaskIdx}`,
              description: `Phase ${phaseIdx} Subtask ${subtaskIdx}`,
              status: 'pending'
            }))
          }))
        });

        // First call - processes 10 phases * 10 subtasks = 100 subtasks
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        expect(useTaskStore.getState().tasks[0].subtasks).toHaveLength(100);

        // Second call - should use cache and early exit
        const tasksBefore = useTaskStore.getState().tasks;
        useTaskStore.getState().updateTaskFromPlan('task-1', plan);
        const tasksAfter = useTaskStore.getState().tasks;

        expect(tasksBefore).toBe(tasksAfter);
      });
    });
  });
});
