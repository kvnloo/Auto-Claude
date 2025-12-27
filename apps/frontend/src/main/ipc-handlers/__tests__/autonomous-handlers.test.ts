/**
 * Unit tests for Autonomous Mode IPC Handlers
 * Tests all IPC handlers for autonomous mode operations:
 * - Queue control: start, stop, pause, resume
 * - Status queries: getStatus, getQueue
 * - Task management: addTask, removeTask
 * - Settings: get, save
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type {
  AutonomousTask,
  QueueStatus,
  SessionStats,
  TaskPriority,
  QueuePauseReason
} from '../../../shared/types/autonomous';
import type { AutonomousModeSettings } from '../../../shared/types/settings';

// ============================================
// Mock Setup
// ============================================

// Mock BrowserWindow
const mockWebContents = {
  send: vi.fn()
};

const mockMainWindow: Partial<BrowserWindow> = {
  isDestroyed: vi.fn(() => false),
  webContents: mockWebContents as unknown as BrowserWindow['webContents']
};

// Mock AutonomousQueueManager
const mockQueueManager = {
  configure: vi.fn(),
  updateSettings: vi.fn(),
  getSettings: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn(),
  getSessionStats: vi.fn(),
  getQueue: vi.fn(() => []),
  addTask: vi.fn(),
  removeTask: vi.fn(() => true),
  getTask: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn()
};

// Mock electron ipcMain handlers storage
const ipcHandlers: Record<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>> = {};

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => {
      ipcHandlers[channel] = handler;
    }),
    removeHandler: vi.fn((channel: string) => {
      delete ipcHandlers[channel];
    })
  }
}));

// Mock autonomous queue manager
vi.mock('../../services/autonomous-queue-manager', () => ({
  getAutonomousQueueManager: vi.fn(() => mockQueueManager),
  AutonomousQueueManager: vi.fn()
}));

// Mock project store
const mockProject = {
  id: 'test-project-id',
  name: 'Test Project',
  path: '/test/project/path'
};

vi.mock('../../project-store', () => ({
  projectStore: {
    getProject: vi.fn((id: string) => (id === 'test-project-id' ? mockProject : null))
  }
}));

// Mock path resolver
vi.mock('../../updater/path-resolver', () => ({
  getEffectiveSourcePath: vi.fn(() => '/path/to/auto-claude')
}));

// Mock debug logger
vi.mock('../../../shared/utils/debug-logger', () => ({
  debugLog: vi.fn(),
  debugError: vi.fn()
}));

// Mock fs for settings persistence
// Use a global-like object that's accessible in the mock factory
const mockSettingsStore: Record<string, string> = {};
(globalThis as Record<string, unknown>).__mockSettingsStore = mockSettingsStore;

vi.mock('fs', () => {
  // Access the store via globalThis since vi.mock is hoisted
  const getStore = () => (globalThis as Record<string, unknown>).__mockSettingsStore as Record<string, string>;

  const readFileSync = vi.fn((path: string) => {
    const store = getStore();
    if (store && store[path]) {
      return store[path];
    }
    throw new Error('File not found');
  });

  const writeFileSync = vi.fn((path: string, data: string) => {
    const store = getStore();
    if (store) {
      store[path] = data;
    }
  });

  const mkdirSync = vi.fn();
  const existsSync = vi.fn(() => true);

  const fsImplementation = {
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync
  };

  return {
    default: fsImplementation,
    ...fsImplementation
  };
});

// Mock path module
vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual as object,
    join: (...args: string[]) => args.join('/'),
    dirname: (p: string) => p.split('/').slice(0, -1).join('/')
  };
});

// ============================================
// Test Helper Functions
// ============================================

/**
 * Create mock IpcMainInvokeEvent
 */
function createMockEvent(): IpcMainInvokeEvent {
  return {} as IpcMainInvokeEvent;
}

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
    createdAt: new Date('2025-01-01T00:00:00Z'),
    retryCount: 0,
    maxRetries: 2,
    ...options
  };
}

/**
 * Create mock QueueStatus
 */
function createMockQueueStatus(overrides: Partial<QueueStatus> = {}): QueueStatus {
  return {
    state: 'idle',
    pendingCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    failedCount: 0,
    totalCount: 0,
    consecutiveFailures: 0,
    lastUpdated: new Date(),
    ...overrides
  };
}

/**
 * Create mock SessionStats
 */
function createMockSessionStats(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    sessionStartedAt: new Date(),
    elapsedTimeMs: 0,
    timeLimitMs: 14400000,
    remainingTimeMs: 14400000,
    tasksCompleted: 0,
    tasksFailed: 0,
    tasksInProgress: 0,
    tasksSkipped: 0,
    totalTasksProcessed: 0,
    pullRequestsCreated: 0,
    tokensUsed: 0,
    avgTaskDurationMs: 0,
    successRate: 0,
    rateLimitHits: 0,
    ...overrides
  };
}

/**
 * Create mock settings
 */
function createMockSettings(overrides: Partial<AutonomousModeSettings> = {}): AutonomousModeSettings {
  return {
    enabled: false,
    maxConcurrentTasks: 1,
    maxConsecutiveFailures: 3,
    sessionTimeLimitMinutes: 240,
    pollIntervalSeconds: 60,
    ...overrides
  };
}

// ============================================
// Test Suite
// ============================================

describe('Autonomous Mode IPC Handlers', () => {
  let registerAutonomousHandlers: typeof import('../autonomous-handlers').registerAutonomousHandlers;
  let mockPythonEnvManager: { getPythonPath: () => string };
  let getMainWindow: () => BrowserWindow | null;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    Object.keys(ipcHandlers).forEach(key => delete ipcHandlers[key]);
    Object.keys(mockSettingsStore).forEach(key => delete mockSettingsStore[key]);

    // Reset queue manager mocks to default values
    mockQueueManager.getStatus.mockReturnValue(createMockQueueStatus());
    mockQueueManager.getSessionStats.mockReturnValue(createMockSessionStats());
    mockQueueManager.getQueue.mockReturnValue([]);
    mockQueueManager.getSettings.mockReturnValue(createMockSettings());
    mockQueueManager.removeTask.mockReturnValue(true);
    mockQueueManager.start.mockResolvedValue(undefined);
    mockQueueManager.stop.mockResolvedValue(undefined);
    mockQueueManager.pause.mockResolvedValue(undefined);
    mockQueueManager.resume.mockResolvedValue(undefined);

    // Setup mock python env manager
    mockPythonEnvManager = {
      getPythonPath: vi.fn(() => '/path/to/python3')
    };

    // Setup getMainWindow
    getMainWindow = () => mockMainWindow as BrowserWindow;

    // Import and register handlers
    vi.resetModules();
    const module = await import('../autonomous-handlers');
    registerAutonomousHandlers = module.registerAutonomousHandlers;
    registerAutonomousHandlers(
      mockPythonEnvManager as unknown as import('../../python-env-manager').PythonEnvManager,
      getMainWindow
    );
  });

  afterEach(() => {
    vi.resetModules();
  });

  // =========================================
  // Handler Registration Tests
  // =========================================

  describe('Handler Registration', () => {
    it('should register all IPC handlers', () => {
      expect(ipcHandlers['autonomous:start']).toBeDefined();
      expect(ipcHandlers['autonomous:stop']).toBeDefined();
      expect(ipcHandlers['autonomous:pause']).toBeDefined();
      expect(ipcHandlers['autonomous:resume']).toBeDefined();
      expect(ipcHandlers['autonomous:getStatus']).toBeDefined();
      expect(ipcHandlers['autonomous:getQueue']).toBeDefined();
      expect(ipcHandlers['autonomous:addTask']).toBeDefined();
      expect(ipcHandlers['autonomous:removeTask']).toBeDefined();
      expect(ipcHandlers['autonomous:settingsGet']).toBeDefined();
      expect(ipcHandlers['autonomous:settingsSave']).toBeDefined();
    });
  });

  // =========================================
  // Queue Control Tests
  // =========================================

  describe('AUTONOMOUS_START', () => {
    it('should start the queue successfully', async () => {
      mockQueueManager.getStatus.mockReturnValue(
        createMockQueueStatus({ state: 'running' })
      );

      const result = await ipcHandlers['autonomous:start'](
        createMockEvent(),
        'test-project-id'
      );

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ state: 'running' })
      });
      expect(mockQueueManager.configure).toHaveBeenCalledWith(
        '/path/to/python3',
        '/path/to/auto-claude',
        '/test/project/path'
      );
      expect(mockQueueManager.start).toHaveBeenCalled();
    });

    it('should return error if project not found', async () => {
      const result = await ipcHandlers['autonomous:start'](
        createMockEvent(),
        'non-existent-project'
      );

      expect(result).toEqual({
        success: false,
        error: 'Project not found'
      });
      expect(mockQueueManager.start).not.toHaveBeenCalled();
    });

    it('should load and apply settings when starting', async () => {
      // Pre-save settings
      mockSettingsStore['/test/project/path/.auto-claude/autonomous-settings.json'] = JSON.stringify({
        enabled: true,
        maxConcurrentTasks: 2,
        maxConsecutiveFailures: 5,
        sessionTimeLimitMinutes: 120,
        pollIntervalSeconds: 45
      });

      await ipcHandlers['autonomous:start'](createMockEvent(), 'test-project-id');

      expect(mockQueueManager.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          maxConcurrentTasks: 2,
          maxConsecutiveFailures: 5
        })
      );
    });

    it('should use default settings when none exist', async () => {
      await ipcHandlers['autonomous:start'](createMockEvent(), 'test-project-id');

      expect(mockQueueManager.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
          maxConcurrentTasks: 1,
          maxConsecutiveFailures: 3,
          sessionTimeLimitMinutes: 240,
          pollIntervalSeconds: 60
        })
      );
    });

    it('should handle start error gracefully', async () => {
      mockQueueManager.start.mockRejectedValue(new Error('Start failed'));

      const result = await ipcHandlers['autonomous:start'](
        createMockEvent(),
        'test-project-id'
      );

      expect(result).toEqual({
        success: false,
        error: 'Start failed'
      });
    });
  });

  describe('AUTONOMOUS_STOP', () => {
    it('should stop the queue and return session stats', async () => {
      const mockStats = createMockSessionStats({
        tasksCompleted: 5,
        tasksFailed: 1
      });
      mockQueueManager.getSessionStats.mockReturnValue(mockStats);

      const result = await ipcHandlers['autonomous:stop'](createMockEvent());

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          tasksCompleted: 5,
          tasksFailed: 1
        })
      });
      expect(mockQueueManager.stop).toHaveBeenCalled();
    });

    it('should handle stop error gracefully', async () => {
      mockQueueManager.stop.mockRejectedValue(new Error('Stop failed'));

      const result = await ipcHandlers['autonomous:stop'](createMockEvent());

      expect(result).toEqual({
        success: false,
        error: 'Stop failed'
      });
    });
  });

  describe('AUTONOMOUS_PAUSE', () => {
    it('should pause the queue with default reason', async () => {
      mockQueueManager.getStatus.mockReturnValue(
        createMockQueueStatus({ state: 'paused', pauseReason: 'user_requested' })
      );

      const result = await ipcHandlers['autonomous:pause'](createMockEvent());

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          state: 'paused',
          pauseReason: 'user_requested'
        })
      });
      expect(mockQueueManager.pause).toHaveBeenCalledWith('user_requested');
    });

    it('should pause the queue with custom reason', async () => {
      mockQueueManager.getStatus.mockReturnValue(
        createMockQueueStatus({ state: 'paused', pauseReason: 'rate_limit_hit' })
      );

      const result = await ipcHandlers['autonomous:pause'](
        createMockEvent(),
        'rate_limit_hit' as QueuePauseReason
      );

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          state: 'paused',
          pauseReason: 'rate_limit_hit'
        })
      });
      expect(mockQueueManager.pause).toHaveBeenCalledWith('rate_limit_hit');
    });

    it('should handle pause error gracefully', async () => {
      mockQueueManager.pause.mockRejectedValue(new Error('Pause failed'));

      const result = await ipcHandlers['autonomous:pause'](createMockEvent());

      expect(result).toEqual({
        success: false,
        error: 'Pause failed'
      });
    });
  });

  describe('AUTONOMOUS_RESUME', () => {
    it('should resume the queue', async () => {
      mockQueueManager.getStatus.mockReturnValue(
        createMockQueueStatus({ state: 'running' })
      );

      const result = await ipcHandlers['autonomous:resume'](createMockEvent());

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ state: 'running' })
      });
      expect(mockQueueManager.resume).toHaveBeenCalled();
    });

    it('should handle resume error gracefully', async () => {
      mockQueueManager.resume.mockRejectedValue(new Error('Resume failed'));

      const result = await ipcHandlers['autonomous:resume'](createMockEvent());

      expect(result).toEqual({
        success: false,
        error: 'Resume failed'
      });
    });
  });

  // =========================================
  // Status Query Tests
  // =========================================

  describe('AUTONOMOUS_GET_STATUS', () => {
    it('should return current queue status', async () => {
      const mockStatus = createMockQueueStatus({
        state: 'running',
        pendingCount: 5,
        completedCount: 3
      });
      mockQueueManager.getStatus.mockReturnValue(mockStatus);

      const result = await ipcHandlers['autonomous:getStatus'](createMockEvent());

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          state: 'running',
          pendingCount: 5,
          completedCount: 3
        })
      });
    });

    it('should handle getStatus error gracefully', async () => {
      mockQueueManager.getStatus.mockImplementation(() => {
        throw new Error('Status error');
      });

      const result = await ipcHandlers['autonomous:getStatus'](createMockEvent());

      expect(result).toEqual({
        success: false,
        error: 'Status error'
      });
    });
  });

  describe('AUTONOMOUS_GET_QUEUE', () => {
    it('should return empty queue', async () => {
      mockQueueManager.getQueue.mockReturnValue([]);

      const result = await ipcHandlers['autonomous:getQueue'](createMockEvent());

      expect(result).toEqual({
        success: true,
        data: []
      });
    });

    it('should return queue with tasks', async () => {
      const tasks = [
        createMockTask('task-1'),
        createMockTask('task-2', { status: 'in_progress' }),
        createMockTask('task-3', { status: 'completed' })
      ];
      mockQueueManager.getQueue.mockReturnValue(tasks);

      const result = await ipcHandlers['autonomous:getQueue'](createMockEvent());

      expect(result).toEqual({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ id: 'task-1', status: 'pending' }),
          expect.objectContaining({ id: 'task-2', status: 'in_progress' }),
          expect.objectContaining({ id: 'task-3', status: 'completed' })
        ])
      });
    });

    it('should handle getQueue error gracefully', async () => {
      mockQueueManager.getQueue.mockImplementation(() => {
        throw new Error('Queue error');
      });

      const result = await ipcHandlers['autonomous:getQueue'](createMockEvent());

      expect(result).toEqual({
        success: false,
        error: 'Queue error'
      });
    });
  });

  // =========================================
  // Task Management Tests
  // =========================================

  describe('AUTONOMOUS_ADD_TASK', () => {
    it('should add task to queue', async () => {
      const task = createMockTask('new-task');

      const result = await ipcHandlers['autonomous:addTask'](
        createMockEvent(),
        task
      );

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ id: 'new-task' })
      });
      expect(mockQueueManager.addTask).toHaveBeenCalled();
    });

    it('should normalize date strings to Date objects', async () => {
      const task = {
        ...createMockTask('new-task'),
        createdAt: '2025-01-01T00:00:00Z' as unknown as Date,
        startedAt: '2025-01-02T00:00:00Z' as unknown as Date
      };

      await ipcHandlers['autonomous:addTask'](createMockEvent(), task);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          createdAt: expect.any(Date),
          startedAt: expect.any(Date)
        })
      );
    });

    it('should handle add task error gracefully', async () => {
      mockQueueManager.addTask.mockImplementation(() => {
        throw new Error('Add failed');
      });

      const task = createMockTask('new-task');
      const result = await ipcHandlers['autonomous:addTask'](
        createMockEvent(),
        task
      );

      expect(result).toEqual({
        success: false,
        error: 'Add failed'
      });
    });
  });

  describe('AUTONOMOUS_REMOVE_TASK', () => {
    it('should remove task from queue', async () => {
      mockQueueManager.removeTask.mockReturnValue(true);

      const result = await ipcHandlers['autonomous:removeTask'](
        createMockEvent(),
        'task-to-remove'
      );

      expect(result).toEqual({
        success: true,
        data: true
      });
      expect(mockQueueManager.removeTask).toHaveBeenCalledWith('task-to-remove');
    });

    it('should return error if task not found', async () => {
      mockQueueManager.removeTask.mockReturnValue(false);

      const result = await ipcHandlers['autonomous:removeTask'](
        createMockEvent(),
        'non-existent-task'
      );

      expect(result).toEqual({
        success: false,
        error: 'Task not found in queue'
      });
    });

    it('should handle remove task error gracefully', async () => {
      mockQueueManager.removeTask.mockImplementation(() => {
        throw new Error('Remove failed');
      });

      const result = await ipcHandlers['autonomous:removeTask'](
        createMockEvent(),
        'task-id'
      );

      expect(result).toEqual({
        success: false,
        error: 'Remove failed'
      });
    });
  });

  // =========================================
  // Settings Tests
  // =========================================

  describe('AUTONOMOUS_SETTINGS_GET', () => {
    it('should return settings for project', async () => {
      const settings = createMockSettings({ enabled: true, maxConcurrentTasks: 2 });
      mockSettingsStore['/test/project/path/.auto-claude/autonomous-settings.json'] =
        JSON.stringify(settings);

      const result = await ipcHandlers['autonomous:settingsGet'](
        createMockEvent(),
        'test-project-id'
      );

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          enabled: true,
          maxConcurrentTasks: 2
        })
      });
    });

    it('should return default settings if none exist', async () => {
      const result = await ipcHandlers['autonomous:settingsGet'](
        createMockEvent(),
        'test-project-id'
      );

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          enabled: false,
          maxConcurrentTasks: 1,
          maxConsecutiveFailures: 3,
          sessionTimeLimitMinutes: 240,
          pollIntervalSeconds: 60
        })
      });
    });

    it('should return error if project not found', async () => {
      const result = await ipcHandlers['autonomous:settingsGet'](
        createMockEvent(),
        'non-existent-project'
      );

      expect(result).toEqual({
        success: false,
        error: 'Project not found'
      });
    });
  });

  describe('AUTONOMOUS_SETTINGS_SAVE', () => {
    it('should save valid settings', async () => {
      const settings = createMockSettings({
        enabled: true,
        maxConcurrentTasks: 2,
        maxConsecutiveFailures: 4,
        sessionTimeLimitMinutes: 180,
        pollIntervalSeconds: 45
      });

      const result = await ipcHandlers['autonomous:settingsSave'](
        createMockEvent(),
        'test-project-id',
        settings
      );

      expect(result).toEqual({
        success: true,
        data: true
      });
      expect(mockQueueManager.updateSettings).toHaveBeenCalledWith(settings);
    });

    it('should validate maxConcurrentTasks range', async () => {
      const invalidSettings = createMockSettings({ maxConcurrentTasks: 5 });

      const result = await ipcHandlers['autonomous:settingsSave'](
        createMockEvent(),
        'test-project-id',
        invalidSettings
      );

      expect(result).toEqual({
        success: false,
        error: 'maxConcurrentTasks must be between 1 and 3'
      });
    });

    it('should validate maxConcurrentTasks minimum', async () => {
      const invalidSettings = createMockSettings({ maxConcurrentTasks: 0 });

      const result = await ipcHandlers['autonomous:settingsSave'](
        createMockEvent(),
        'test-project-id',
        invalidSettings
      );

      expect(result).toEqual({
        success: false,
        error: 'maxConcurrentTasks must be between 1 and 3'
      });
    });

    it('should validate maxConsecutiveFailures range', async () => {
      const invalidSettings = createMockSettings({ maxConsecutiveFailures: 10 });

      const result = await ipcHandlers['autonomous:settingsSave'](
        createMockEvent(),
        'test-project-id',
        invalidSettings
      );

      expect(result).toEqual({
        success: false,
        error: 'maxConsecutiveFailures must be between 1 and 5'
      });
    });

    it('should validate maxConsecutiveFailures minimum', async () => {
      const invalidSettings = createMockSettings({ maxConsecutiveFailures: 0 });

      const result = await ipcHandlers['autonomous:settingsSave'](
        createMockEvent(),
        'test-project-id',
        invalidSettings
      );

      expect(result).toEqual({
        success: false,
        error: 'maxConsecutiveFailures must be between 1 and 5'
      });
    });

    it('should validate sessionTimeLimitMinutes maximum', async () => {
      const invalidSettings = createMockSettings({ sessionTimeLimitMinutes: 600 });

      const result = await ipcHandlers['autonomous:settingsSave'](
        createMockEvent(),
        'test-project-id',
        invalidSettings
      );

      expect(result).toEqual({
        success: false,
        error: 'sessionTimeLimitMinutes must be between 60 and 480'
      });
    });

    it('should validate sessionTimeLimitMinutes minimum', async () => {
      const invalidSettings = createMockSettings({ sessionTimeLimitMinutes: 30 });

      const result = await ipcHandlers['autonomous:settingsSave'](
        createMockEvent(),
        'test-project-id',
        invalidSettings
      );

      expect(result).toEqual({
        success: false,
        error: 'sessionTimeLimitMinutes must be between 60 and 480'
      });
    });

    it('should validate pollIntervalSeconds minimum', async () => {
      const invalidSettings = createMockSettings({ pollIntervalSeconds: 10 });

      const result = await ipcHandlers['autonomous:settingsSave'](
        createMockEvent(),
        'test-project-id',
        invalidSettings
      );

      expect(result).toEqual({
        success: false,
        error: 'pollIntervalSeconds must be at least 30'
      });
    });

    it('should return error if project not found', async () => {
      const settings = createMockSettings();

      const result = await ipcHandlers['autonomous:settingsSave'](
        createMockEvent(),
        'non-existent-project',
        settings
      );

      expect(result).toEqual({
        success: false,
        error: 'Project not found'
      });
    });
  });

  // =========================================
  // Event Forwarding Tests
  // =========================================

  describe('Event Forwarding', () => {
    it('should setup event forwarding on registration', () => {
      // Verify that event listeners were registered
      expect(mockQueueManager.on).toHaveBeenCalledWith('queue-started', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('queue-stopped', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('queue-paused', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('queue-resumed', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('task-started', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('task-progress', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('task-completed', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('task-failed', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('status-update', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('rate-limit', expect.any(Function));
      expect(mockQueueManager.on).toHaveBeenCalledWith('queue-error', expect.any(Function));
    });

    it('should forward queue-started event to renderer', () => {
      // Find the queue-started handler from the on() calls
      const callArgs = mockQueueManager.on.mock.calls;
      const queueStartedCall = callArgs.find(
        (call: [string, (...args: unknown[]) => void]) => call[0] === 'queue-started'
      );

      if (queueStartedCall) {
        const handler = queueStartedCall[1];
        handler();

        expect(mockWebContents.send).toHaveBeenCalledWith(
          'autonomous:progress',
          expect.objectContaining({
            type: 'queue_started'
          })
        );
      }
    });

    it('should forward task-completed event to renderer', () => {
      const callArgs = mockQueueManager.on.mock.calls;
      const taskCompletedCall = callArgs.find(
        (call: [string, (...args: unknown[]) => void]) => call[0] === 'task-completed'
      );

      if (taskCompletedCall) {
        const handler = taskCompletedCall[1];
        const mockTask = createMockTask('task-1');
        handler(mockTask, 'https://github.com/test/repo/pull/1');

        expect(mockWebContents.send).toHaveBeenCalledWith(
          'autonomous:taskComplete',
          expect.objectContaining({
            type: 'task_completed',
            taskId: 'task-1',
            payload: expect.objectContaining({
              pullRequestUrl: 'https://github.com/test/repo/pull/1'
            })
          })
        );
      }
    });

    it('should forward task-failed event to renderer', () => {
      const callArgs = mockQueueManager.on.mock.calls;
      const taskFailedCall = callArgs.find(
        (call: [string, (...args: unknown[]) => void]) => call[0] === 'task-failed'
      );

      if (taskFailedCall) {
        const handler = taskFailedCall[1];
        const mockTask = createMockTask('task-1');
        handler(mockTask, 'Execution error');

        expect(mockWebContents.send).toHaveBeenCalledWith(
          'autonomous:taskFailed',
          expect.objectContaining({
            type: 'task_failed',
            taskId: 'task-1',
            payload: expect.objectContaining({
              error: 'Execution error'
            })
          })
        );
      }
    });

    it('should forward queue-error event to renderer', () => {
      const callArgs = mockQueueManager.on.mock.calls;
      const queueErrorCall = callArgs.find(
        (call: [string, (...args: unknown[]) => void]) => call[0] === 'queue-error'
      );

      if (queueErrorCall) {
        const handler = queueErrorCall[1];
        handler('Critical system error');

        expect(mockWebContents.send).toHaveBeenCalledWith(
          'autonomous:error',
          expect.objectContaining({
            type: 'error',
            payload: expect.objectContaining({
              error: 'Critical system error'
            })
          })
        );
      }
    });

    it('should not send events if main window is destroyed', () => {
      (mockMainWindow.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const callArgs = mockQueueManager.on.mock.calls;
      const queueStartedCall = callArgs.find(
        (call: [string, (...args: unknown[]) => void]) => call[0] === 'queue-started'
      );

      if (queueStartedCall) {
        const handler = queueStartedCall[1];
        handler();

        // Should not call send() when window is destroyed
        const sendCalls = mockWebContents.send.mock.calls.filter(
          (call: [string, unknown]) => call[0] === 'autonomous:progress'
        );
        // The event handler should not send when window is destroyed
        expect(sendCalls.length).toBe(0);
      }
    });
  });

  // =========================================
  // Edge Cases
  // =========================================

  describe('Edge Cases', () => {
    it('should handle null main window', async () => {
      // Re-register with null window getter
      vi.resetModules();
      Object.keys(ipcHandlers).forEach(key => delete ipcHandlers[key]);

      const module = await import('../autonomous-handlers');
      module.registerAutonomousHandlers(
        mockPythonEnvManager as unknown as import('../../python-env-manager').PythonEnvManager,
        () => null
      );

      // Trigger an event - should not throw
      const callArgs = mockQueueManager.on.mock.calls;
      const queueStartedCall = callArgs.find(
        (call: [string, (...args: unknown[]) => void]) => call[0] === 'queue-started'
      );

      if (queueStartedCall) {
        const handler = queueStartedCall[1];
        expect(() => handler()).not.toThrow();
      }
    });

    it('should handle empty task ID on remove', async () => {
      mockQueueManager.removeTask.mockReturnValue(false);

      const result = await ipcHandlers['autonomous:removeTask'](
        createMockEvent(),
        ''
      );

      expect(result).toEqual({
        success: false,
        error: 'Task not found in queue'
      });
    });

    it('should handle settings with undefined tokenBudget', async () => {
      const settings = createMockSettings({ tokenBudget: undefined });

      const result = await ipcHandlers['autonomous:settingsSave'](
        createMockEvent(),
        'test-project-id',
        settings
      );

      expect(result).toEqual({
        success: true,
        data: true
      });
    });

    it('should handle concurrent start requests', async () => {
      // Both should succeed but the queue manager handles the state
      const results = await Promise.all([
        ipcHandlers['autonomous:start'](createMockEvent(), 'test-project-id'),
        ipcHandlers['autonomous:start'](createMockEvent(), 'test-project-id')
      ]);

      // Both should return success since queue manager handles the actual state
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(mockQueueManager.start).toHaveBeenCalledTimes(2);
    });
  });
});

// ============================================
// Settings Persistence Tests
// ============================================

describe('Settings Persistence', () => {
  let registerAutonomousHandlers: typeof import('../autonomous-handlers').registerAutonomousHandlers;
  let mockPythonEnvManager: { getPythonPath: () => string };
  let getMainWindow: () => BrowserWindow | null;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(ipcHandlers).forEach(key => delete ipcHandlers[key]);
    Object.keys(mockSettingsStore).forEach(key => delete mockSettingsStore[key]);

    mockQueueManager.getStatus.mockReturnValue(createMockQueueStatus());
    mockQueueManager.getSessionStats.mockReturnValue(createMockSessionStats());
    mockQueueManager.getSettings.mockReturnValue(createMockSettings());

    mockPythonEnvManager = {
      getPythonPath: vi.fn(() => '/path/to/python3')
    };
    getMainWindow = () => mockMainWindow as BrowserWindow;

    vi.resetModules();
    const module = await import('../autonomous-handlers');
    registerAutonomousHandlers = module.registerAutonomousHandlers;
    registerAutonomousHandlers(
      mockPythonEnvManager as unknown as import('../../python-env-manager').PythonEnvManager,
      getMainWindow
    );
  });

  it('should persist settings to file system', async () => {
    const settings = createMockSettings({
      enabled: true,
      maxConcurrentTasks: 2
    });

    await ipcHandlers['autonomous:settingsSave'](
      createMockEvent(),
      'test-project-id',
      settings
    );

    const savedData = mockSettingsStore['/test/project/path/.auto-claude/autonomous-settings.json'];
    expect(savedData).toBeDefined();

    const parsed = JSON.parse(savedData);
    expect(parsed.enabled).toBe(true);
    expect(parsed.maxConcurrentTasks).toBe(2);
  });

  it('should retrieve persisted settings', async () => {
    // Save settings first
    const settings = createMockSettings({
      enabled: true,
      maxConcurrentTasks: 3,
      sessionTimeLimitMinutes: 120
    });
    mockSettingsStore['/test/project/path/.auto-claude/autonomous-settings.json'] =
      JSON.stringify(settings);

    // Retrieve settings
    const result = await ipcHandlers['autonomous:settingsGet'](
      createMockEvent(),
      'test-project-id'
    );

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        enabled: true,
        maxConcurrentTasks: 3,
        sessionTimeLimitMinutes: 120
      })
    });
  });

  it('should update queue manager when saving settings', async () => {
    const settings = createMockSettings({
      enabled: true,
      pollIntervalSeconds: 45
    });

    await ipcHandlers['autonomous:settingsSave'](
      createMockEvent(),
      'test-project-id',
      settings
    );

    expect(mockQueueManager.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        pollIntervalSeconds: 45
      })
    );
  });
});
