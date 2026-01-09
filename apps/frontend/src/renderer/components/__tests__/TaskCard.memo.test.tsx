/**
 * @vitest-environment jsdom
 */
/**
 * Tests for TaskCard React.memo optimization
 * Verifies that TaskCard only re-renders when its own task data changes,
 * not when other tasks in the board change.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TaskCard } from '../TaskCard';
import type { Task, TaskStatus, ExecutionProgress } from '../../../shared/types';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
}));

// Mock task store functions
vi.mock('../../stores/task-store', () => ({
  startTask: vi.fn(),
  stopTask: vi.fn(),
  checkTaskRunning: vi.fn(() => false),
  recoverStuckTask: vi.fn(),
  isIncompleteHumanReview: vi.fn(() => false),
  archiveTasks: vi.fn(),
}));

/**
 * Creates a complete Task object with required fields
 */
function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    specId: 'spec-001',
    projectId: 'project-001',
    title: 'Test Task',
    description: 'Test task description',
    status: 'backlog' as TaskStatus,
    subtasks: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('TaskCard React.memo Optimization', () => {
  let renderCount: Map<string, number>;
  let originalDebug: boolean | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    renderCount = new Map<string, number>();

    // Enable debug mode for re-render logging
    originalDebug = (window as typeof window & { DEBUG?: boolean }).DEBUG;
    (window as typeof window & { DEBUG?: boolean }).DEBUG = true;

    // Spy on console.log to track re-renders
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore debug mode
    if (originalDebug !== undefined) {
      (window as typeof window & { DEBUG?: boolean }).DEBUG = originalDebug;
    } else {
      delete (window as typeof window & { DEBUG?: boolean }).DEBUG;
    }
    vi.restoreAllMocks();
    cleanup();
  });

  /**
   * Wrapper component to track render counts for each TaskCard
   */
  function TaskCardWithRenderTracking({
    task,
    onClick,
    onStatusChange
  }: {
    task: Task;
    onClick: () => void;
    onStatusChange?: (newStatus: TaskStatus) => void;
  }) {
    const currentCount = renderCount.get(task.id) || 0;
    renderCount.set(task.id, currentCount + 1);
    return <TaskCard task={task} onClick={onClick} onStatusChange={onStatusChange} />;
  }

  describe('Re-render Prevention - Task A changes should not affect Task B', () => {
    it('should not re-render task B when task A status changes', () => {
      const taskA = createTestTask({ id: 'task-a', title: 'Task A', status: 'backlog' });
      const taskB = createTestTask({ id: 'task-b', title: 'Task B', status: 'backlog' });

      // Initial render of both tasks
      const { rerender } = render(
        <div>
          <TaskCardWithRenderTracking task={taskA} onClick={vi.fn()} />
          <TaskCardWithRenderTracking task={taskB} onClick={vi.fn()} />
        </div>
      );

      // Initial render counts
      expect(renderCount.get('task-a')).toBe(1);
      expect(renderCount.get('task-b')).toBe(1);

      // Update task A status
      const updatedTaskA = { ...taskA, status: 'in_progress' as TaskStatus };

      rerender(
        <div>
          <TaskCardWithRenderTracking task={updatedTaskA} onClick={vi.fn()} />
          <TaskCardWithRenderTracking task={taskB} onClick={vi.fn()} />
        </div>
      );

      // Task A should re-render (status changed)
      expect(renderCount.get('task-a')).toBe(2);
      // Task B should NOT re-render (no changes)
      expect(renderCount.get('task-b')).toBe(1);

      // Verify console.log was called with re-render info for task A
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[TaskCard] Re-render: task-a')
      );
    });

    it('should not re-render task B when task A title changes', () => {
      const taskA = createTestTask({ id: 'task-a', title: 'Original Title A' });
      const taskB = createTestTask({ id: 'task-b', title: 'Original Title B' });

      const { rerender } = render(
        <div>
          <TaskCardWithRenderTracking task={taskA} onClick={vi.fn()} />
          <TaskCardWithRenderTracking task={taskB} onClick={vi.fn()} />
        </div>
      );

      expect(renderCount.get('task-a')).toBe(1);
      expect(renderCount.get('task-b')).toBe(1);

      // Update task A title
      const updatedTaskA = { ...taskA, title: 'Updated Title A' };

      rerender(
        <div>
          <TaskCardWithRenderTracking task={updatedTaskA} onClick={vi.fn()} />
          <TaskCardWithRenderTracking task={taskB} onClick={vi.fn()} />
        </div>
      );

      // Task A should re-render
      expect(renderCount.get('task-a')).toBe(2);
      // Task B should NOT re-render
      expect(renderCount.get('task-b')).toBe(1);
    });

    it('should not re-render task B when task A description changes', () => {
      const taskA = createTestTask({ id: 'task-a', description: 'Original description A' });
      const taskB = createTestTask({ id: 'task-b', description: 'Original description B' });

      const { rerender } = render(
        <div>
          <TaskCardWithRenderTracking task={taskA} onClick={vi.fn()} />
          <TaskCardWithRenderTracking task={taskB} onClick={vi.fn()} />
        </div>
      );

      expect(renderCount.get('task-a')).toBe(1);
      expect(renderCount.get('task-b')).toBe(1);

      // Update task A description
      const updatedTaskA = { ...taskA, description: 'Updated description A' };

      rerender(
        <div>
          <TaskCardWithRenderTracking task={updatedTaskA} onClick={vi.fn()} />
          <TaskCardWithRenderTracking task={taskB} onClick={vi.fn()} />
        </div>
      );

      expect(renderCount.get('task-a')).toBe(2);
      expect(renderCount.get('task-b')).toBe(1);
    });

    it('should not re-render other tasks when multiple tasks exist', () => {
      const tasks = [
        createTestTask({ id: 'task-1', title: 'Task 1' }),
        createTestTask({ id: 'task-2', title: 'Task 2' }),
        createTestTask({ id: 'task-3', title: 'Task 3' }),
        createTestTask({ id: 'task-4', title: 'Task 4' }),
      ];

      const { rerender } = render(
        <div>
          {tasks.map((task) => (
            <TaskCardWithRenderTracking key={task.id} task={task} onClick={vi.fn()} />
          ))}
        </div>
      );

      // All tasks should have rendered once
      tasks.forEach((task) => {
        expect(renderCount.get(task.id)).toBe(1);
      });

      // Update only task-2
      const updatedTasks = tasks.map((task) =>
        task.id === 'task-2' ? { ...task, status: 'in_progress' as TaskStatus } : task
      );

      rerender(
        <div>
          {updatedTasks.map((task) => (
            <TaskCardWithRenderTracking key={task.id} task={task} onClick={vi.fn()} />
          ))}
        </div>
      );

      // Only task-2 should re-render
      expect(renderCount.get('task-1')).toBe(1);
      expect(renderCount.get('task-2')).toBe(2);
      expect(renderCount.get('task-3')).toBe(1);
      expect(renderCount.get('task-4')).toBe(1);
    });
  });

  describe('Progress Updates - Selective Re-rendering', () => {
    it('should only re-render card when its own progress changes', () => {
      const taskA = createTestTask({
        id: 'task-a',
        executionProgress: {
          phase: 'planning' as ExecutionProgress['phase'],
          phaseProgress: 10,
          overallProgress: 10
        }
      });
      const taskB = createTestTask({
        id: 'task-b',
        executionProgress: {
          phase: 'planning' as ExecutionProgress['phase'],
          phaseProgress: 20,
          overallProgress: 20
        }
      });

      const { rerender } = render(
        <div>
          <TaskCardWithRenderTracking task={taskA} onClick={vi.fn()} />
          <TaskCardWithRenderTracking task={taskB} onClick={vi.fn()} />
        </div>
      );

      expect(renderCount.get('task-a')).toBe(1);
      expect(renderCount.get('task-b')).toBe(1);

      // Update task A progress only
      const updatedTaskA = {
        ...taskA,
        executionProgress: {
          phase: 'coding' as ExecutionProgress['phase'],
          phaseProgress: 50,
          overallProgress: 50
        }
      };

      rerender(
        <div>
          <TaskCardWithRenderTracking task={updatedTaskA} onClick={vi.fn()} />
          <TaskCardWithRenderTracking task={taskB} onClick={vi.fn()} />
        </div>
      );

      // Task A should re-render (progress changed)
      expect(renderCount.get('task-a')).toBe(2);
      // Task B should NOT re-render
      expect(renderCount.get('task-b')).toBe(1);

      // Verify console log shows phase change
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('phase: planning -> coding')
      );
    });

    it('should re-render when phaseProgress changes', () => {
      const task = createTestTask({
        id: 'task-progress',
        executionProgress: {
          phase: 'coding' as ExecutionProgress['phase'],
          phaseProgress: 25,
          overallProgress: 25
        }
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-progress')).toBe(1);

      // Update phase progress
      const updatedTask = {
        ...task,
        executionProgress: {
          ...task.executionProgress!,
          phaseProgress: 75,
          overallProgress: 75
        }
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-progress')).toBe(2);
    });

    it('should not re-render when non-compared progress fields change', () => {
      const task = createTestTask({
        id: 'task-message',
        executionProgress: {
          phase: 'coding' as ExecutionProgress['phase'],
          phaseProgress: 50,
          overallProgress: 50,
          message: 'Initial message'
        }
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-message')).toBe(1);

      // Update only message (not in comparison)
      const updatedTask = {
        ...task,
        executionProgress: {
          ...task.executionProgress!,
          message: 'Updated message'
        }
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      // Should NOT re-render (message is not compared)
      expect(renderCount.get('task-message')).toBe(1);
    });
  });

  describe('Subtask Changes - Selective Re-rendering', () => {
    it('should re-render when subtask status changes', () => {
      const task = createTestTask({
        id: 'task-subtasks',
        subtasks: [
          { id: 'sub-1', title: 'Subtask 1', description: '', status: 'pending', files: [] },
          { id: 'sub-2', title: 'Subtask 2', description: '', status: 'pending', files: [] }
        ]
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-subtasks')).toBe(1);

      // Update subtask status
      const updatedTask = {
        ...task,
        subtasks: [
          { ...task.subtasks[0], status: 'completed' as const },
          task.subtasks[1]
        ]
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-subtasks')).toBe(2);
    });

    it('should re-render when subtask count changes', () => {
      const task = createTestTask({
        id: 'task-subtask-count',
        subtasks: [
          { id: 'sub-1', title: 'Subtask 1', description: '', status: 'pending', files: [] }
        ]
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-subtask-count')).toBe(1);

      // Add a subtask
      const updatedTask = {
        ...task,
        subtasks: [
          ...task.subtasks,
          { id: 'sub-2', title: 'Subtask 2', description: '', status: 'pending', files: [] }
        ]
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-subtask-count')).toBe(2);

      // Verify console log shows subtask count change
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('subtasks: 1 -> 2')
      );
    });
  });

  describe('Metadata Changes - Priority, Impact, Security', () => {
    it('should re-render when metadata.priority changes', () => {
      const task = createTestTask({
        id: 'task-priority',
        metadata: { priority: 'low' }
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-priority')).toBe(1);

      // Update priority
      const updatedTask = {
        ...task,
        metadata: { ...task.metadata, priority: 'high' as const }
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-priority')).toBe(2);
    });

    it('should re-render when metadata.impact changes', () => {
      const task = createTestTask({
        id: 'task-impact',
        metadata: { impact: 'low' }
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-impact')).toBe(1);

      // Update impact
      const updatedTask = {
        ...task,
        metadata: { ...task.metadata, impact: 'critical' as const }
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-impact')).toBe(2);
    });

    it('should re-render when metadata.securitySeverity changes', () => {
      const task = createTestTask({
        id: 'task-security',
        metadata: { securitySeverity: 'low' }
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-security')).toBe(1);

      // Update security severity
      const updatedTask = {
        ...task,
        metadata: { ...task.metadata, securitySeverity: 'critical' as const }
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-security')).toBe(2);
    });

    it('should re-render when metadata.category changes', () => {
      const task = createTestTask({
        id: 'task-category',
        metadata: { category: 'feature' }
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-category')).toBe(1);

      // Update category
      const updatedTask = {
        ...task,
        metadata: { ...task.metadata, category: 'bug_fix' as const }
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-category')).toBe(2);
    });

    it('should re-render when metadata.complexity changes', () => {
      const task = createTestTask({
        id: 'task-complexity',
        metadata: { complexity: 'small' }
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-complexity')).toBe(1);

      // Update complexity
      const updatedTask = {
        ...task,
        metadata: { ...task.metadata, complexity: 'large' as const }
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-complexity')).toBe(2);
    });
  });

  describe('Handler Stability', () => {
    it('should not re-render when handler references remain stable', () => {
      const task = createTestTask({ id: 'task-stable' });
      const onClick = vi.fn();
      const onStatusChange = vi.fn();

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={onClick} onStatusChange={onStatusChange} />
      );

      expect(renderCount.get('task-stable')).toBe(1);

      // Re-render with same task and same handler references
      rerender(
        <TaskCardWithRenderTracking task={task} onClick={onClick} onStatusChange={onStatusChange} />
      );

      // Should NOT re-render (all props are same references)
      expect(renderCount.get('task-stable')).toBe(1);
    });

    it('should re-render when onClick handler changes', () => {
      const task = createTestTask({ id: 'task-onclick' });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-onclick')).toBe(1);

      // Re-render with new onClick handler
      rerender(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      // Should re-render (onClick changed)
      expect(renderCount.get('task-onclick')).toBe(2);
    });
  });

  describe('Archive and PR URL Changes', () => {
    it('should re-render when task is archived', () => {
      const task = createTestTask({ id: 'task-archive' });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-archive')).toBe(1);

      // Archive the task
      const updatedTask = {
        ...task,
        metadata: { ...task.metadata, archivedAt: new Date().toISOString() }
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-archive')).toBe(2);
    });

    it('should re-render when PR URL is added', () => {
      const task = createTestTask({ id: 'task-pr' });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-pr')).toBe(1);

      // Add PR URL
      const updatedTask = {
        ...task,
        metadata: { ...task.metadata, prUrl: 'https://github.com/user/repo/pull/123' }
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-pr')).toBe(2);
    });
  });

  describe('Review Reason Changes', () => {
    it('should re-render when reviewReason changes', () => {
      const task = createTestTask({
        id: 'task-review',
        status: 'human_review',
        reviewReason: 'plan_review'
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-review')).toBe(1);

      // Change review reason
      const updatedTask = {
        ...task,
        reviewReason: 'qa_rejected' as const
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-review')).toBe(2);
    });
  });

  describe('UpdatedAt Timestamp Changes', () => {
    it('should re-render when updatedAt changes', () => {
      const task = createTestTask({
        id: 'task-updated',
        updatedAt: new Date('2024-01-01')
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-updated')).toBe(1);

      // Update timestamp
      const updatedTask = {
        ...task,
        updatedAt: new Date('2024-01-02')
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      expect(renderCount.get('task-updated')).toBe(2);
    });
  });

  describe('Debug Logging', () => {
    it('should log re-render with changed fields when DEBUG is enabled', () => {
      const task = createTestTask({
        id: 'task-debug',
        status: 'backlog',
        executionProgress: {
          phase: 'planning' as ExecutionProgress['phase'],
          phaseProgress: 10,
          overallProgress: 10
        }
      });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      // Clear previous logs
      vi.mocked(console.log).mockClear();

      // Update multiple fields
      const updatedTask = {
        ...task,
        status: 'in_progress' as TaskStatus,
        executionProgress: {
          phase: 'coding' as ExecutionProgress['phase'],
          phaseProgress: 50,
          overallProgress: 50
        }
      };

      rerender(
        <TaskCardWithRenderTracking task={updatedTask} onClick={vi.fn()} />
      );

      // Should log re-render with changes
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[TaskCard\] Re-render: task-debug/)
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('status:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('phase:')
      );
    });

    it('should not log when task does not re-render', () => {
      const task = createTestTask({ id: 'task-no-log' });

      const { rerender } = render(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      // Clear initial render logs
      vi.mocked(console.log).mockClear();

      // Re-render with same task (no changes)
      rerender(
        <TaskCardWithRenderTracking task={task} onClick={vi.fn()} />
      );

      // Should NOT log (no re-render)
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('[TaskCard] Re-render')
      );
    });
  });
});
