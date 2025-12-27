/**
 * Unit tests for Autonomous Queue Manager Service
 * Tests queue state transitions, task management, and guardrail enforcement
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type {
  AutonomousTask,
  QueueState,
  TaskPriority,
  QueuePauseReason
} from '../../../shared/types/autonomous';

// ============================================
// Mock Setup
// ============================================

// Mock child_process
const mockProcess = {
  stdout: new EventEmitter(),
  stderr: new EventEmitter(),
  on: vi.fn(),
  kill: vi.fn()
} as unknown as ChildProcess;

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProcess)
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true)
}));

// Mock debug-logger
vi.mock('../../../shared/utils/debug-logger', () => ({
  debugLog: vi.fn(),
  debugError: vi.fn()
}));

// Mock python-detector
vi.mock('../../python-detector', () => ({
  parsePythonCommand: vi.fn(() => ['python', []])
}));

// Mock rate-limit-detector
vi.mock('../../rate-limit-detector', () => ({
  getProfileEnv: vi.fn(() => ({}))
}));

// ============================================
// Test Helper Functions
// ============================================

/**
 * Create a mock task for testing
 */
function createMockTask(id: string, options: Partial<AutonomousTask> = {}): AutonomousTask {
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
    status: 'pending',
    priority: defaultPriority,
    dependencies: [],
    blockedBy: [],
    createdAt: new Date(),
    retryCount: 0,
    maxRetries: 2,
    ...options
  };
}

/**
 * Simulate a JSON event from the subprocess
 */
function emitProcessEvent(event: Record<string, unknown>): void {
  const jsonLine = JSON.stringify(event) + '\n';
  (mockProcess.stdout as EventEmitter).emit('data', Buffer.from(jsonLine));
}

// ============================================
// Queue Manager Tests
// ============================================

describe('AutonomousQueueManager', () => {
  let AutonomousQueueManager: typeof import('../autonomous-queue-manager').AutonomousQueueManager;
  let getAutonomousQueueManager: typeof import('../autonomous-queue-manager').getAutonomousQueueManager;
  let resetAutonomousQueueManager: typeof import('../autonomous-queue-manager').resetAutonomousQueueManager;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Reset mock process event handlers
    mockProcess.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'exit') {
        // Store the exit handler for later invocation
        (mockProcess as Record<string, unknown>)._exitHandler = handler;
      }
      if (event === 'error') {
        (mockProcess as Record<string, unknown>)._errorHandler = handler;
      }
      return mockProcess;
    });
    mockProcess.kill = vi.fn();

    // Import fresh module
    const module = await import('../autonomous-queue-manager');
    AutonomousQueueManager = module.AutonomousQueueManager;
    getAutonomousQueueManager = module.getAutonomousQueueManager;
    resetAutonomousQueueManager = module.resetAutonomousQueueManager;
  });

  afterEach(() => {
    resetAutonomousQueueManager();
  });

  // =========================================
  // Initialization Tests
  // =========================================

  describe('Initialization', () => {
    it('should create a new instance', () => {
      const manager = new AutonomousQueueManager();
      expect(manager).toBeInstanceOf(AutonomousQueueManager);
      expect(manager.state).toBe('idle');
    });

    it('should return singleton instance via getAutonomousQueueManager', () => {
      const instance1 = getAutonomousQueueManager();
      const instance2 = getAutonomousQueueManager();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton on resetAutonomousQueueManager', () => {
      const instance1 = getAutonomousQueueManager();
      resetAutonomousQueueManager();
      const instance2 = getAutonomousQueueManager();
      expect(instance1).not.toBe(instance2);
    });
  });

  // =========================================
  // Configuration Tests
  // =========================================

  describe('Configuration', () => {
    it('should configure paths correctly', () => {
      const manager = new AutonomousQueueManager();
      manager.configure('/path/to/python', '/path/to/auto-claude', '/path/to/project');

      // Configuration is internal, but we can verify by checking start behavior
      expect(manager.state).toBe('idle');
    });

    it('should update settings', () => {
      const manager = new AutonomousQueueManager();
      manager.updateSettings({
        enabled: true,
        maxConcurrentTasks: 2,
        maxConsecutiveFailures: 5
      });

      const settings = manager.getSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.maxConcurrentTasks).toBe(2);
      expect(settings.maxConsecutiveFailures).toBe(5);
    });

    it('should return copy of settings (not reference)', () => {
      const manager = new AutonomousQueueManager();
      const settings1 = manager.getSettings();
      settings1.enabled = true;
      const settings2 = manager.getSettings();
      expect(settings2.enabled).toBe(false);
    });

    it('should have default settings', () => {
      const manager = new AutonomousQueueManager();
      const settings = manager.getSettings();

      expect(settings.enabled).toBe(false);
      expect(settings.maxConcurrentTasks).toBe(1);
      expect(settings.maxConsecutiveFailures).toBe(3);
      expect(settings.sessionTimeLimitMinutes).toBe(240);
      expect(settings.pollIntervalSeconds).toBe(60);
    });
  });

  // =========================================
  // State Accessor Tests
  // =========================================

  describe('State Accessors', () => {
    it('should report isRunning correctly', () => {
      const manager = new AutonomousQueueManager();
      expect(manager.isRunning()).toBe(false);
    });

    it('should report isPaused correctly', () => {
      const manager = new AutonomousQueueManager();
      expect(manager.isPaused()).toBe(false);
    });

    it('should return empty queue initially', () => {
      const manager = new AutonomousQueueManager();
      expect(manager.getQueue()).toHaveLength(0);
    });

    it('should return correct initial status', () => {
      const manager = new AutonomousQueueManager();
      const status = manager.getStatus();

      expect(status.state).toBe('idle');
      expect(status.pendingCount).toBe(0);
      expect(status.completedCount).toBe(0);
      expect(status.failedCount).toBe(0);
      expect(status.totalCount).toBe(0);
    });

    it('should return initial session stats', () => {
      const manager = new AutonomousQueueManager();
      const stats = manager.getSessionStats();

      expect(stats.tasksCompleted).toBe(0);
      expect(stats.tasksFailed).toBe(0);
      expect(stats.successRate).toBe(0);
    });
  });

  // =========================================
  // Task Management Tests
  // =========================================

  describe('Task Management', () => {
    it('should add task to queue', () => {
      const manager = new AutonomousQueueManager();
      const task = createMockTask('task-1');

      manager.addTask(task);

      expect(manager.getQueue()).toHaveLength(1);
      expect(manager.getTask('task-1')).toBeDefined();
    });

    it('should remove task from queue', () => {
      const manager = new AutonomousQueueManager();
      const task = createMockTask('task-1');

      manager.addTask(task);
      const removed = manager.removeTask('task-1');

      expect(removed).toBe(true);
      expect(manager.getQueue()).toHaveLength(0);
    });

    it('should return false when removing non-existent task', () => {
      const manager = new AutonomousQueueManager();
      const removed = manager.removeTask('non-existent');
      expect(removed).toBe(false);
    });

    it('should track task status counts correctly', () => {
      const manager = new AutonomousQueueManager();

      manager.addTask(createMockTask('task-1', { status: 'pending' }));
      manager.addTask(createMockTask('task-2', { status: 'completed' }));
      manager.addTask(createMockTask('task-3', { status: 'failed' }));
      manager.addTask(createMockTask('task-4', { status: 'in_progress' }));

      const status = manager.getStatus();

      expect(status.pendingCount).toBe(1);
      expect(status.completedCount).toBe(1);
      expect(status.failedCount).toBe(1);
      expect(status.inProgressCount).toBe(1);
      expect(status.totalCount).toBe(4);
    });

    it('should emit status-update event when adding task', () => {
      const manager = new AutonomousQueueManager();
      const statusUpdateHandler = vi.fn();
      manager.on('status-update', statusUpdateHandler);

      manager.addTask(createMockTask('task-1'));

      expect(statusUpdateHandler).toHaveBeenCalled();
    });

    it('should emit status-update event when removing task', () => {
      const manager = new AutonomousQueueManager();
      manager.addTask(createMockTask('task-1'));

      const statusUpdateHandler = vi.fn();
      manager.on('status-update', statusUpdateHandler);

      manager.removeTask('task-1');

      expect(statusUpdateHandler).toHaveBeenCalled();
    });
  });

  // =========================================
  // Queue State Transition Tests
  // =========================================

  describe('Queue State Transitions', () => {
    it('should transition from idle to running on start', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      const startedHandler = vi.fn();
      manager.on('queue-started', startedHandler);

      await manager.start();

      expect(manager.state).toBe('running');
      expect(startedHandler).toHaveBeenCalled();
    });

    it('should not start if already running', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();
      const stateBefore = manager.state;

      await manager.start(); // Second start should be ignored

      expect(manager.state).toBe(stateBefore);
    });

    it('should emit error if source path not configured', async () => {
      const manager = new AutonomousQueueManager();
      const errorHandler = vi.fn();
      manager.on('queue-error', errorHandler);

      await manager.start();

      expect(errorHandler).toHaveBeenCalledWith('Auto-build source path not configured');
      expect(manager.state).toBe('idle');
    });

    it('should emit error if project path not configured', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source');

      const errorHandler = vi.fn();
      manager.on('queue-error', errorHandler);

      await manager.start();

      expect(errorHandler).toHaveBeenCalledWith('Project path not configured');
    });

    it('should transition to stopped on stop', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      const stoppedHandler = vi.fn();
      manager.on('queue-stopped', stoppedHandler);

      await manager.stop();

      expect(manager.state).toBe('stopped');
      expect(stoppedHandler).toHaveBeenCalled();
    });

    it('should not stop if already stopped', async () => {
      const manager = new AutonomousQueueManager();
      expect(manager.state).toBe('idle');

      await manager.stop();

      // Should remain idle (stop has no effect when idle)
      expect(manager.state).toBe('idle');
    });

    it('should transition to paused on pause', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      const pausedHandler = vi.fn();
      manager.on('queue-paused', pausedHandler);

      await manager.pause('user_requested');

      expect(manager.state).toBe('paused');
      expect(manager.isPaused()).toBe(true);
      expect(pausedHandler).toHaveBeenCalledWith('user_requested', expect.any(Object));
    });

    it('should not pause if not running', async () => {
      const manager = new AutonomousQueueManager();

      await manager.pause();

      expect(manager.state).toBe('idle');
    });

    it('should transition to running on resume', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();
      await manager.pause();

      const resumedHandler = vi.fn();
      manager.on('queue-resumed', resumedHandler);

      await manager.resume();

      expect(manager.state).toBe('running');
      expect(manager.isRunning()).toBe(true);
      expect(resumedHandler).toHaveBeenCalled();
    });

    it('should not resume if not paused', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      await manager.resume(); // Not paused, should be ignored

      expect(manager.state).toBe('running');
    });
  });

  // =========================================
  // Event Handling Tests
  // =========================================

  describe('Event Handling', () => {
    it('should handle task_started event', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      const taskStartedHandler = vi.fn();
      manager.on('task-started', taskStartedHandler);

      await manager.start();

      emitProcessEvent({
        event: 'task_started',
        task: {
          id: 'task-1',
          title: 'Test Task',
          description: 'Test Description',
          source: 'github_issue',
          status: 'in_progress'
        }
      });

      expect(taskStartedHandler).toHaveBeenCalled();
    });

    it('should handle task_completed event', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      const taskCompletedHandler = vi.fn();
      manager.on('task-completed', taskCompletedHandler);

      await manager.start();

      emitProcessEvent({
        event: 'task_completed',
        task: {
          id: 'task-1',
          title: 'Test Task',
          status: 'completed'
        },
        pr_url: 'https://github.com/test/repo/pull/1'
      });

      expect(taskCompletedHandler).toHaveBeenCalled();

      // Verify session stats updated
      const stats = manager.getSessionStats();
      expect(stats.tasksCompleted).toBe(1);
    });

    it('should handle task_failed event', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      const taskFailedHandler = vi.fn();
      manager.on('task-failed', taskFailedHandler);

      await manager.start();

      emitProcessEvent({
        event: 'task_failed',
        task: {
          id: 'task-1',
          title: 'Test Task',
          status: 'failed'
        },
        error: 'Test error'
      });

      expect(taskFailedHandler).toHaveBeenCalled();

      // Verify session stats updated
      const stats = manager.getSessionStats();
      expect(stats.tasksFailed).toBe(1);
    });

    it('should handle guardrail_triggered event', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      const pausedHandler = vi.fn();
      manager.on('queue-paused', pausedHandler);

      await manager.start();

      emitProcessEvent({
        event: 'guardrail_triggered',
        reason: 'max_failures'
      });

      expect(manager.state).toBe('paused');
      expect(pausedHandler).toHaveBeenCalledWith('max_failures_reached', expect.any(Object));
    });

    it('should handle rate_limit_backoff event', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      const rateLimitHandler = vi.fn();
      manager.on('rate-limit', rateLimitHandler);

      await manager.start();

      const resetTime = new Date().toISOString();
      emitProcessEvent({
        event: 'rate_limit_backoff',
        reset_time: resetTime
      });

      expect(rateLimitHandler).toHaveBeenCalledWith(expect.any(Date));
    });

    it('should handle auth_error event', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      const errorHandler = vi.fn();
      manager.on('queue-error', errorHandler);

      await manager.start();

      emitProcessEvent({
        event: 'auth_error',
        error: 'Authentication expired'
      });

      expect(manager.state).toBe('error');
      expect(errorHandler).toHaveBeenCalledWith(
        expect.stringContaining('Authentication error')
      );
    });

    it('should handle critical_error event', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      const errorHandler = vi.fn();
      manager.on('queue-error', errorHandler);

      await manager.start();

      emitProcessEvent({
        event: 'critical_error',
        error: 'Disk full'
      });

      expect(manager.state).toBe('error');
      expect(errorHandler).toHaveBeenCalledWith(
        expect.stringContaining('Critical error')
      );
    });

    it('should handle pr_created event', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      manager.addTask(createMockTask('task-1'));

      await manager.start();

      emitProcessEvent({
        event: 'pr_created',
        task_id: 'task-1',
        pr_url: 'https://github.com/test/repo/pull/123'
      });

      const task = manager.getTask('task-1');
      expect(task?.pullRequestUrl).toBe('https://github.com/test/repo/pull/123');
    });

    it('should handle non-JSON output gracefully', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      // Should not throw
      (mockProcess.stdout as EventEmitter).emit('data', Buffer.from('This is not JSON\n'));

      expect(manager.state).toBe('running');
    });
  });

  // =========================================
  // Guardrail Enforcement Tests
  // =========================================

  describe('Guardrail Enforcement', () => {
    it('should map max_failures reason to max_failures_reached', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      emitProcessEvent({
        event: 'guardrail_triggered',
        reason: 'max_failures'
      });

      const status = manager.getStatus();
      expect(status.pauseReason).toBe('max_failures_reached');
    });

    it('should map session_time_limit reason correctly', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      emitProcessEvent({
        event: 'guardrail_triggered',
        reason: 'session_time_limit'
      });

      const status = manager.getStatus();
      expect(status.pauseReason).toBe('session_time_limit');
    });

    it('should map token_budget reason correctly', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      emitProcessEvent({
        event: 'guardrail_triggered',
        reason: 'token_budget'
      });

      const status = manager.getStatus();
      expect(status.pauseReason).toBe('token_budget_exhausted');
    });

    it('should map rate_limit_max_backoff reason correctly', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      emitProcessEvent({
        event: 'guardrail_triggered',
        reason: 'rate_limit_max_backoff'
      });

      const status = manager.getStatus();
      expect(status.pauseReason).toBe('rate_limit_hit');
    });

    it('should map auth_failure reason correctly', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      emitProcessEvent({
        event: 'guardrail_triggered',
        reason: 'auth_failure'
      });

      const status = manager.getStatus();
      expect(status.pauseReason).toBe('auth_expired');
    });

    it('should update session stats when guardrail triggers', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');
      manager.updateSettings({ sessionTimeLimitMinutes: 60 });

      await manager.start();

      // Wait a bit to accumulate elapsed time
      await new Promise(resolve => setTimeout(resolve, 10));

      emitProcessEvent({
        event: 'guardrail_triggered',
        reason: 'session_time_limit'
      });

      const stats = manager.getSessionStats();
      expect(stats.elapsedTimeMs).toBeGreaterThan(0);
    });
  });

  // =========================================
  // Session Statistics Tests
  // =========================================

  describe('Session Statistics', () => {
    it('should track tasks completed', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      emitProcessEvent({
        event: 'task_completed',
        task: { id: 'task-1', title: 'Task 1' }
      });

      emitProcessEvent({
        event: 'task_completed',
        task: { id: 'task-2', title: 'Task 2' },
        pr_url: 'https://github.com/test/repo/pull/1'
      });

      const stats = manager.getSessionStats();
      expect(stats.tasksCompleted).toBe(2);
      expect(stats.pullRequestsCreated).toBe(1);
    });

    it('should track tasks failed', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      emitProcessEvent({
        event: 'task_failed',
        task: { id: 'task-1', title: 'Task 1' },
        error: 'Error 1'
      });

      emitProcessEvent({
        event: 'task_failed',
        task: { id: 'task-2', title: 'Task 2' },
        error: 'Error 2'
      });

      const stats = manager.getSessionStats();
      expect(stats.tasksFailed).toBe(2);
    });

    it('should calculate success rate', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      emitProcessEvent({
        event: 'task_completed',
        task: { id: 'task-1', title: 'Task 1' }
      });

      emitProcessEvent({
        event: 'task_completed',
        task: { id: 'task-2', title: 'Task 2' }
      });

      emitProcessEvent({
        event: 'task_failed',
        task: { id: 'task-3', title: 'Task 3' },
        error: 'Error'
      });

      const stats = manager.getSessionStats();
      // 2 completed, 1 failed = 66.67%
      expect(stats.successRate).toBeCloseTo(66.67, 0);
    });

    it('should track elapsed time', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = manager.getSessionStats();
      expect(stats.elapsedTimeMs).toBeGreaterThan(0);
    });

    it('should reset stats on new session', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      emitProcessEvent({
        event: 'task_completed',
        task: { id: 'task-1', title: 'Task 1' }
      });

      await manager.stop();
      await manager.start();

      const stats = manager.getSessionStats();
      expect(stats.tasksCompleted).toBe(0);
    });

    it('should track remaining time correctly', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');
      manager.updateSettings({ sessionTimeLimitMinutes: 1 }); // 1 minute

      await manager.start();

      const stats = manager.getSessionStats();
      expect(stats.remainingTimeMs).toBeLessThanOrEqual(60 * 1000);
      expect(stats.remainingTimeMs).toBeGreaterThan(0);
    });
  });

  // =========================================
  // Process Lifecycle Tests
  // =========================================

  describe('Process Lifecycle', () => {
    it('should kill process on stop', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();
      await manager.stop();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should kill existing process before starting new one', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();
      await manager.stop();
      await manager.start();

      // Kill should have been called at least once
      expect(mockProcess.kill).toHaveBeenCalled();
    });
  });

  // =========================================
  // Edge Cases
  // =========================================

  describe('Edge Cases', () => {
    it('should handle multiple rapid state changes', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();
      await manager.pause();
      await manager.resume();
      await manager.pause();
      await manager.resume();
      await manager.stop();

      expect(manager.state).toBe('stopped');
    });

    it('should handle empty event data gracefully', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      // Empty event should not crash
      emitProcessEvent({
        event: 'task_started'
        // Missing task data
      });

      expect(manager.state).toBe('running');
    });

    it('should handle unknown event types gracefully', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      await manager.start();

      // Unknown event should be logged but not crash
      emitProcessEvent({
        event: 'unknown_event_type',
        data: 'some data'
      });

      expect(manager.state).toBe('running');
    });

    it('should calculate next poll time only when running', () => {
      const manager = new AutonomousQueueManager();

      const status = manager.getStatus();
      expect(status.nextPollAt).toBeUndefined();
    });

    it('should handle task parsing with missing fields', async () => {
      const manager = new AutonomousQueueManager();
      manager.configure('python', '/path/to/source', '/path/to/project');

      const taskStartedHandler = vi.fn();
      manager.on('task-started', taskStartedHandler);

      await manager.start();

      emitProcessEvent({
        event: 'task_started',
        task: {
          id: 'task-1'
          // Missing most fields
        }
      });

      expect(taskStartedHandler).toHaveBeenCalled();
      const taskArg = taskStartedHandler.mock.calls[0][0];
      expect(taskArg.id).toBe('task-1');
      expect(taskArg.title).toBe('Untitled Task');
    });
  });
});

// ============================================
// Pause Reason Mapping Tests
// ============================================

describe('Pause Reason Mapping', () => {
  let manager: InstanceType<typeof import('../autonomous-queue-manager').AutonomousQueueManager>;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../autonomous-queue-manager');
    manager = new module.AutonomousQueueManager();
    manager.configure('python', '/path/to/source', '/path/to/project');
  });

  const testCases: Array<{ reason: string; expected: QueuePauseReason }> = [
    { reason: 'max_failures', expected: 'max_failures_reached' },
    { reason: 'max_consecutive_failures', expected: 'max_failures_reached' },
    { reason: 'session_time_limit', expected: 'session_time_limit' },
    { reason: 'token_budget', expected: 'token_budget_exhausted' },
    { reason: 'rate_limit_max_backoff', expected: 'rate_limit_hit' },
    { reason: 'auth_failure', expected: 'auth_expired' },
    { reason: 'critical_error', expected: 'critical_error' },
    { reason: 'unknown_reason', expected: 'critical_error' } // Default case
  ];

  testCases.forEach(({ reason, expected }) => {
    it(`should map '${reason}' to '${expected}'`, async () => {
      await manager.start();

      emitProcessEvent({
        event: 'guardrail_triggered',
        reason
      });

      const status = manager.getStatus();
      expect(status.pauseReason).toBe(expected);
    });
  });
});
