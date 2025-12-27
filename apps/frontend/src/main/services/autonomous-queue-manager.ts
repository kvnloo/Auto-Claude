/**
 * Autonomous Queue Manager Service
 * ================================
 *
 * Manages the autonomous task execution queue by spawning and controlling
 * the Python autonomous_runner.py subprocess. Follows the AgentQueueManager
 * pattern for process lifecycle management.
 *
 * Key Features:
 * - Spawns autonomous_runner.py subprocess with proper environment
 * - Parses stdout for JSON-based progress events
 * - Maintains in-memory queue state
 * - Enforces guardrails (max concurrent, max failures, time limit)
 * - Emits events for UI updates
 * - Graceful shutdown (allows current task to complete)
 * - Rate limit detection integration
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import { existsSync } from 'fs';
import type {
  AutonomousTask,
  TaskStatus,
  QueueState,
  QueueStatus,
  SessionStats,
  TaskProgress,
  QueuePauseReason
} from '../../shared/types/autonomous';
import type { AutonomousModeSettings } from '../../shared/types/settings';
import { debugLog, debugError } from '../../shared/utils/debug-logger';
import { parsePythonCommand } from '../python-detector';
import { getProfileEnv } from '../rate-limit-detector';

// ============================================
// Event Types for External Listeners
// ============================================

/**
 * Events emitted by the AutonomousQueueManager.
 */
export interface AutonomousQueueEvents {
  'queue-started': () => void;
  'queue-stopped': (stats: SessionStats) => void;
  'queue-paused': (reason: QueuePauseReason, stats: SessionStats) => void;
  'queue-resumed': () => void;
  'queue-error': (error: string) => void;
  'task-started': (task: AutonomousTask) => void;
  'task-progress': (progress: TaskProgress) => void;
  'task-completed': (task: AutonomousTask, prUrl?: string) => void;
  'task-failed': (task: AutonomousTask, error: string) => void;
  'status-update': (status: QueueStatus) => void;
  'rate-limit': (resetTime: Date) => void;
}

// ============================================
// Default Settings
// ============================================

const DEFAULT_SETTINGS: AutonomousModeSettings = {
  enabled: false,
  maxConcurrentTasks: 1,
  maxConsecutiveFailures: 3,
  sessionTimeLimitMinutes: 240, // 4 hours
  pollIntervalSeconds: 60,
  tokenBudget: undefined
};

// ============================================
// Autonomous Queue Manager Class
// ============================================

/**
 * Manages the autonomous task execution queue.
 *
 * Spawns the Python autonomous_runner.py subprocess and handles:
 * - Process lifecycle (start, stop, pause, resume)
 * - Event parsing from stdout (JSON-based protocol)
 * - Queue state management
 * - Guardrail enforcement
 * - UI event emission
 */
export class AutonomousQueueManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private processSpawnId: string | null = null;
  private killedSpawnIds: Set<string> = new Set();

  // Configuration
  private pythonPath: string = 'python';
  private autoBuildSourcePath: string | null = null;
  private projectPath: string | null = null;

  // State
  private _state: QueueState = 'idle';
  private _pauseReason?: QueuePauseReason;
  private settings: AutonomousModeSettings = { ...DEFAULT_SETTINGS };

  // Queue data
  private taskQueue: Map<string, AutonomousTask> = new Map();
  private currentTask: AutonomousTask | null = null;

  // Session tracking
  private sessionStartTime: Date | null = null;
  private sessionStats: SessionStats = this.createInitialStats();

  // Output buffer for rate limit detection
  private outputBuffer: string = '';
  private readonly maxOutputBufferSize = 10000;

  constructor() {
    super();
    debugLog('[AutonomousQueueManager] Initialized');
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Configure paths for Python and auto-claude source.
   */
  configure(
    pythonPath?: string,
    autoBuildSourcePath?: string,
    projectPath?: string
  ): void {
    if (pythonPath) {
      this.pythonPath = pythonPath;
    }
    if (autoBuildSourcePath) {
      this.autoBuildSourcePath = autoBuildSourcePath;
    }
    if (projectPath) {
      this.projectPath = projectPath;
    }
    debugLog('[AutonomousQueueManager] Configured:', {
      pythonPath: this.pythonPath,
      autoBuildSourcePath: this.autoBuildSourcePath,
      projectPath: this.projectPath
    });
  }

  /**
   * Update settings for autonomous mode.
   */
  updateSettings(settings: Partial<AutonomousModeSettings>): void {
    this.settings = { ...this.settings, ...settings };
    debugLog('[AutonomousQueueManager] Settings updated:', this.settings);
  }

  /**
   * Get current settings.
   */
  getSettings(): AutonomousModeSettings {
    return { ...this.settings };
  }

  // =========================================================================
  // State Accessors
  // =========================================================================

  /**
   * Get current queue state.
   */
  get state(): QueueState {
    return this._state;
  }

  /**
   * Check if the queue is running.
   */
  isRunning(): boolean {
    return this._state === 'running';
  }

  /**
   * Check if the queue is paused.
   */
  isPaused(): boolean {
    return this._state === 'paused';
  }

  /**
   * Get current queue status for UI.
   */
  getStatus(): QueueStatus {
    const tasks = Array.from(this.taskQueue.values());
    const pendingTasks = tasks.filter((t) => t.status === 'pending');
    const completedTasks = tasks.filter((t) => t.status === 'completed');
    const failedTasks = tasks.filter((t) => t.status === 'failed');
    const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');

    return {
      state: this._state,
      pauseReason: this._pauseReason,
      currentTask: this.currentTask || undefined,
      pendingCount: pendingTasks.length,
      inProgressCount: inProgressTasks.length,
      completedCount: completedTasks.length,
      failedCount: failedTasks.length,
      totalCount: tasks.length,
      consecutiveFailures: this.sessionStats.tasksFailed,
      lastUpdated: new Date(),
      nextPollAt: this.calculateNextPollTime()
    };
  }

  /**
   * Get session statistics.
   */
  getSessionStats(): SessionStats {
    return this.updateSessionStats();
  }

  /**
   * Get all tasks in the queue.
   */
  getQueue(): AutonomousTask[] {
    return Array.from(this.taskQueue.values());
  }

  // =========================================================================
  // Queue Operations
  // =========================================================================

  /**
   * Start the autonomous queue.
   *
   * Spawns the autonomous_runner.py subprocess and begins task execution.
   */
  async start(): Promise<void> {
    if (this._state === 'running') {
      debugLog('[AutonomousQueueManager] Already running');
      return;
    }

    if (!this.autoBuildSourcePath) {
      const error = 'Auto-build source path not configured';
      debugError('[AutonomousQueueManager]', error);
      this.emitError(error);
      return;
    }

    if (!this.projectPath) {
      const error = 'Project path not configured';
      debugError('[AutonomousQueueManager]', error);
      this.emitError(error);
      return;
    }

    const runnerPath = path.join(
      this.autoBuildSourcePath,
      'runners',
      'autonomous_runner.py'
    );

    if (!existsSync(runnerPath)) {
      const error = `Autonomous runner not found at: ${runnerPath}`;
      debugError('[AutonomousQueueManager]', error);
      this.emitError(error);
      return;
    }

    debugLog('[AutonomousQueueManager] Starting autonomous queue...');

    // Kill any existing process
    if (this.process) {
      this.killProcess();
    }

    // Reset session state
    this.sessionStartTime = new Date();
    this.sessionStats = this.createInitialStats();
    this.outputBuffer = '';
    this._pauseReason = undefined;

    // Build command arguments
    const args = this.buildRunnerArgs(runnerPath);

    // Spawn the process
    this.spawnProcess(args);

    // Update state
    this._state = 'running';
    this.emit('queue-started');
    this.emitStatusUpdate();
  }

  /**
   * Stop the autonomous queue.
   *
   * Signals graceful shutdown, allowing current task to complete.
   */
  async stop(): Promise<void> {
    if (this._state === 'stopped' || this._state === 'idle') {
      debugLog('[AutonomousQueueManager] Already stopped');
      return;
    }

    debugLog('[AutonomousQueueManager] Stopping autonomous queue...');
    this._state = 'stopped';

    // Send SIGTERM for graceful shutdown
    if (this.process) {
      this.killProcess();
    }

    const stats = this.updateSessionStats();
    this.emit('queue-stopped', stats);
    this.emitStatusUpdate();
  }

  /**
   * Pause the autonomous queue.
   *
   * @param reason - Reason for pausing
   */
  async pause(reason: QueuePauseReason = 'user_requested'): Promise<void> {
    if (this._state !== 'running') {
      debugLog('[AutonomousQueueManager] Cannot pause: not running');
      return;
    }

    debugLog('[AutonomousQueueManager] Pausing autonomous queue:', reason);
    this._state = 'paused';
    this._pauseReason = reason;

    // Note: We don't kill the process, just stop accepting new events
    // The Python runner will handle pause via its own logic

    const stats = this.updateSessionStats();
    this.emit('queue-paused', reason, stats);
    this.emitStatusUpdate();
  }

  /**
   * Resume the autonomous queue from paused state.
   */
  async resume(): Promise<void> {
    if (this._state !== 'paused') {
      debugLog('[AutonomousQueueManager] Cannot resume: not paused');
      return;
    }

    debugLog('[AutonomousQueueManager] Resuming autonomous queue...');
    this._state = 'running';
    this._pauseReason = undefined;

    this.emit('queue-resumed');
    this.emitStatusUpdate();
  }

  // =========================================================================
  // Task Management
  // =========================================================================

  /**
   * Add a task to the queue manually.
   *
   * @param task - Task to add
   */
  addTask(task: AutonomousTask): void {
    this.taskQueue.set(task.id, task);
    debugLog('[AutonomousQueueManager] Task added:', task.id);
    this.emitStatusUpdate();
  }

  /**
   * Remove a task from the queue.
   *
   * @param taskId - ID of task to remove
   * @returns True if task was removed
   */
  removeTask(taskId: string): boolean {
    const removed = this.taskQueue.delete(taskId);
    if (removed) {
      debugLog('[AutonomousQueueManager] Task removed:', taskId);
      this.emitStatusUpdate();
    }
    return removed;
  }

  /**
   * Get a specific task by ID.
   */
  getTask(taskId: string): AutonomousTask | undefined {
    return this.taskQueue.get(taskId);
  }

  // =========================================================================
  // Process Management
  // =========================================================================

  /**
   * Build runner arguments from current settings.
   */
  private buildRunnerArgs(runnerPath: string): string[] {
    const args = [runnerPath, '--project-dir', this.projectPath!];

    // Add guardrail settings
    args.push('--max-failures', String(this.settings.maxConsecutiveFailures));
    args.push('--session-time-limit', String(this.settings.sessionTimeLimitMinutes));
    args.push('--poll-interval', String(this.settings.pollIntervalSeconds));

    return args;
  }

  /**
   * Spawn the autonomous runner subprocess.
   */
  private spawnProcess(args: string[]): void {
    // Generate unique spawn ID
    this.processSpawnId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Get combined environment
    const env = this.buildEnvironment();

    // Parse Python command (handles space-separated like "py -3")
    const [pythonCommand, pythonBaseArgs] = parsePythonCommand(this.pythonPath);

    debugLog('[AutonomousQueueManager] Spawning process:', {
      command: pythonCommand,
      args: [...pythonBaseArgs, ...args].slice(0, 5),
      spawnId: this.processSpawnId
    });

    this.process = spawn(pythonCommand, [...pythonBaseArgs, ...args], {
      cwd: this.autoBuildSourcePath || undefined,
      env
    });

    // Handle stdout (JSON events)
    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleStdout(data);
    });

    // Handle stderr (logs and errors)
    this.process.stderr?.on('data', (data: Buffer) => {
      this.handleStderr(data);
    });

    // Handle process exit
    this.process.on('exit', (code: number | null) => {
      this.handleProcessExit(code);
    });

    // Handle process error
    this.process.on('error', (err: Error) => {
      this.handleProcessError(err);
    });
  }

  /**
   * Build environment variables for the subprocess.
   */
  private buildEnvironment(): NodeJS.ProcessEnv {
    // Get active Claude profile environment
    const profileEnv = getProfileEnv();

    return {
      ...process.env,
      ...profileEnv,
      PYTHONPATH: this.autoBuildSourcePath || '',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    };
  }

  /**
   * Kill the current subprocess.
   */
  private killProcess(): void {
    if (!this.process) {
      return;
    }

    // Track this spawn ID as intentionally killed
    if (this.processSpawnId) {
      this.killedSpawnIds.add(this.processSpawnId);
    }

    debugLog('[AutonomousQueueManager] Killing process:', this.processSpawnId);

    try {
      this.process.kill('SIGTERM');
    } catch (err) {
      debugError('[AutonomousQueueManager] Error killing process:', err);
    }

    this.process = null;
    this.processSpawnId = null;
  }

  // =========================================================================
  // Output Handling
  // =========================================================================

  /**
   * Handle stdout data from the subprocess.
   * Parses JSON events emitted by autonomous_runner.py.
   */
  private handleStdout(data: Buffer): void {
    const output = data.toString('utf8');

    // Collect output for rate limit detection
    this.outputBuffer = (this.outputBuffer + output).slice(-this.maxOutputBufferSize);

    // Parse JSON events (one per line)
    const lines = output.split('\n').filter((line) => line.trim().length > 0);

    for (const line of lines) {
      try {
        const event = JSON.parse(line.trim());
        this.handleEvent(event);
      } catch {
        // Not JSON - treat as log line
        debugLog('[AutonomousRunner]', line.trim());
      }
    }
  }

  /**
   * Handle stderr data from the subprocess.
   */
  private handleStderr(data: Buffer): void {
    const output = data.toString('utf8');
    this.outputBuffer = (this.outputBuffer + output).slice(-this.maxOutputBufferSize);

    // Log stderr output
    const lines = output.split('\n').filter((line) => line.trim().length > 0);
    for (const line of lines) {
      debugLog('[AutonomousRunner STDERR]', line.trim());
    }
  }

  /**
   * Handle a parsed event from the runner.
   */
  private handleEvent(event: Record<string, unknown>): void {
    const eventType = event.event as string;

    debugLog('[AutonomousQueueManager] Event received:', eventType);

    switch (eventType) {
      case 'started':
        // Runner started successfully
        break;

      case 'task_started':
        this.handleTaskStarted(event);
        break;

      case 'task_completed':
        this.handleTaskCompleted(event);
        break;

      case 'task_failed':
        this.handleTaskFailed(event);
        break;

      case 'status_synced':
        // Status sync events - log for debugging
        debugLog('[AutonomousQueueManager] Status synced:', event);
        break;

      case 'guardrail_triggered':
        this.handleGuardrailTriggered(event);
        break;

      case 'paused':
        this.handleRunnerPaused(event);
        break;

      case 'stopped':
        this.handleRunnerStopped(event);
        break;

      case 'queue_updated':
        // Queue was updated - refresh status
        this.emitStatusUpdate();
        break;

      case 'pr_created':
        this.handlePRCreated(event);
        break;

      case 'pr_creation_failed':
        debugLog('[AutonomousQueueManager] PR creation failed:', event);
        break;

      case 'rate_limit_backoff':
      case 'rate_limit_wait':
        this.handleRateLimitEvent(event);
        break;

      case 'auth_error':
        this.handleAuthError(event);
        break;

      case 'critical_error':
        this.handleCriticalError(event);
        break;

      case 'dependency_cycle':
        debugLog('[AutonomousQueueManager] Dependency cycle detected:', event);
        break;

      case 'idle':
        // Queue is idle, no tasks available
        debugLog('[AutonomousQueueManager] Queue idle:', event);
        break;

      case 'error':
        this.emitError(event.message as string || 'Unknown error');
        break;

      default:
        debugLog('[AutonomousQueueManager] Unknown event:', eventType, event);
    }
  }

  /**
   * Handle task_started event.
   */
  private handleTaskStarted(event: Record<string, unknown>): void {
    const taskData = event.task as Record<string, unknown>;
    if (taskData) {
      this.currentTask = this.parseTask(taskData);
      this.sessionStats.tasksInProgress = 1;
      this.emit('task-started', this.currentTask);
      this.emitStatusUpdate();
    }
  }

  /**
   * Handle task_completed event.
   */
  private handleTaskCompleted(event: Record<string, unknown>): void {
    const taskData = event.task as Record<string, unknown>;
    const prUrl = event.pr_url as string | undefined;

    if (taskData) {
      const task = this.parseTask(taskData);
      task.status = 'completed';
      this.taskQueue.set(task.id, task);

      this.sessionStats.tasksCompleted++;
      this.sessionStats.tasksInProgress = 0;
      this.sessionStats.totalTasksProcessed++;
      if (prUrl) {
        this.sessionStats.pullRequestsCreated++;
      }

      this.currentTask = null;
      this.emit('task-completed', task, prUrl);
      this.emitStatusUpdate();
    }
  }

  /**
   * Handle task_failed event.
   */
  private handleTaskFailed(event: Record<string, unknown>): void {
    const taskData = event.task as Record<string, unknown>;
    const error = event.error as string || 'Unknown error';

    if (taskData) {
      const task = this.parseTask(taskData);
      task.status = 'failed';
      task.error = error;
      this.taskQueue.set(task.id, task);

      this.sessionStats.tasksFailed++;
      this.sessionStats.tasksInProgress = 0;
      this.sessionStats.totalTasksProcessed++;

      this.currentTask = null;
      this.emit('task-failed', task, error);
      this.emitStatusUpdate();
    }
  }

  /**
   * Handle guardrail_triggered event.
   */
  private handleGuardrailTriggered(event: Record<string, unknown>): void {
    const reason = event.reason as string;
    debugLog('[AutonomousQueueManager] Guardrail triggered:', reason);

    // Map reason to QueuePauseReason
    let pauseReason: QueuePauseReason;
    switch (reason) {
      case 'max_failures':
      case 'max_consecutive_failures':
        pauseReason = 'max_failures_reached';
        break;
      case 'session_time_limit':
        pauseReason = 'session_time_limit';
        break;
      case 'token_budget':
        pauseReason = 'token_budget_exhausted';
        break;
      case 'rate_limit_max_backoff':
        pauseReason = 'rate_limit_hit';
        break;
      case 'auth_failure':
        pauseReason = 'auth_expired';
        break;
      case 'critical_error':
        pauseReason = 'critical_error';
        break;
      default:
        pauseReason = 'critical_error';
    }

    this._state = 'paused';
    this._pauseReason = pauseReason;

    const stats = this.updateSessionStats();
    this.emit('queue-paused', pauseReason, stats);
    this.emitStatusUpdate();
  }

  /**
   * Handle runner paused event.
   */
  private handleRunnerPaused(event: Record<string, unknown>): void {
    const reason = event.reason as string || 'unknown';
    debugLog('[AutonomousQueueManager] Runner paused:', reason);

    // Already handled by guardrail_triggered in most cases
    if (this._state !== 'paused') {
      this._state = 'paused';
      this._pauseReason = 'user_requested';

      const stats = this.updateSessionStats();
      this.emit('queue-paused', 'user_requested', stats);
      this.emitStatusUpdate();
    }
  }

  /**
   * Handle runner stopped event.
   */
  private handleRunnerStopped(_event: Record<string, unknown>): void {
    debugLog('[AutonomousQueueManager] Runner stopped');

    if (this._state !== 'stopped') {
      this._state = 'stopped';
      const stats = this.updateSessionStats();
      this.emit('queue-stopped', stats);
      this.emitStatusUpdate();
    }
  }

  /**
   * Handle PR created event.
   */
  private handlePRCreated(event: Record<string, unknown>): void {
    const prUrl = event.pr_url as string;
    const taskId = event.task_id as string;
    debugLog('[AutonomousQueueManager] PR created:', { taskId, prUrl });

    // Update task with PR URL
    const task = this.taskQueue.get(taskId);
    if (task) {
      task.pullRequestUrl = prUrl;
      this.taskQueue.set(taskId, task);
    }
  }

  /**
   * Handle rate limit event.
   */
  private handleRateLimitEvent(event: Record<string, unknown>): void {
    const resetTime = event.reset_time as string;
    debugLog('[AutonomousQueueManager] Rate limit:', event);

    if (resetTime) {
      this.emit('rate-limit', new Date(resetTime));
    }
  }

  /**
   * Handle authentication error.
   */
  private handleAuthError(event: Record<string, unknown>): void {
    const error = event.error as string || 'Authentication failed';
    debugError('[AutonomousQueueManager] Auth error:', error);

    this._state = 'error';
    this._pauseReason = 'auth_expired';
    this.emitError(`Authentication error: ${error}. Run 'gh auth login' to re-authenticate.`);
    this.emitStatusUpdate();
  }

  /**
   * Handle critical error.
   */
  private handleCriticalError(event: Record<string, unknown>): void {
    const error = event.error as string || 'Critical system error';
    debugError('[AutonomousQueueManager] Critical error:', error);

    this._state = 'error';
    this._pauseReason = 'critical_error';
    this.emitError(`Critical error: ${error}`);
    this.emitStatusUpdate();
  }

  /**
   * Handle process exit.
   */
  private handleProcessExit(code: number | null): void {
    debugLog('[AutonomousQueueManager] Process exited:', { code, spawnId: this.processSpawnId });

    // Check if this was an intentional kill
    if (this.processSpawnId && this.killedSpawnIds.has(this.processSpawnId)) {
      this.killedSpawnIds.delete(this.processSpawnId);
      debugLog('[AutonomousQueueManager] Process was intentionally killed');
      return;
    }

    this.process = null;
    this.processSpawnId = null;

    // Update state if not already stopped
    if (this._state === 'running') {
      if (code === 0) {
        this._state = 'idle';
      } else {
        this._state = 'error';
        this.emitError(`Process exited with code ${code}`);
      }
      this.emitStatusUpdate();
    }
  }

  /**
   * Handle process error.
   */
  private handleProcessError(err: Error): void {
    debugError('[AutonomousQueueManager] Process error:', err);

    this.process = null;
    this.processSpawnId = null;
    this._state = 'error';
    this.emitError(`Process error: ${err.message}`);
    this.emitStatusUpdate();
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  /**
   * Parse task data from event.
   */
  private parseTask(data: Record<string, unknown>): AutonomousTask {
    // Parse dates
    const createdAt = data.created_at
      ? new Date(data.created_at as string)
      : new Date();
    const startedAt = data.started_at
      ? new Date(data.started_at as string)
      : undefined;
    const completedAt = data.completed_at
      ? new Date(data.completed_at as string)
      : undefined;

    // Parse source
    const sourceData = data.source as Record<string, unknown> | undefined;
    let source: AutonomousTask['source'];

    if (sourceData?.source === 'github_issue' || data.source === 'github_issue') {
      source = {
        provider: 'github_issue',
        issueNumber: (sourceData?.issue_number as number) || 0,
        repository: (sourceData?.repository as string) || 'unknown/unknown',
        issueUrl: (sourceData?.issue_url as string) || '',
        labels: (sourceData?.labels as string[]) || []
      };
    } else {
      source = {
        provider: 'roadmap_feature',
        featureId: (sourceData?.feature_id as string) || (data.external_id as string) || '',
        phaseId: (sourceData?.phase_id as string) || '',
        roadmapId: (sourceData?.roadmap_id as string) || ''
      };
    }

    // Parse priority
    const priorityData = data.priority as Record<string, unknown> | undefined;
    const priority: AutonomousTask['priority'] = {
      complexity: (priorityData?.complexity as number) || 5,
      impact: (priorityData?.impact as number) || 5,
      priority: (priorityData?.priority as number) || 5,
      recency: (priorityData?.recency as number) || 5,
      score: (priorityData?.score as number) || (data.priority_score as number) || 5,
      level: ((priorityData?.level as string) || 'medium') as 'critical' | 'high' | 'medium' | 'low'
    };

    return {
      id: (data.id as string) || `task-${Date.now()}`,
      title: (data.title as string) || 'Untitled Task',
      description: (data.description as string) || '',
      source,
      status: (data.status as TaskStatus) || 'pending',
      priority,
      dependencies: (data.dependencies as string[]) || [],
      blockedBy: (data.blocked_by as string[]) || [],
      createdAt,
      startedAt,
      completedAt,
      error: data.error_message as string | undefined,
      specId: data.spec_id as string | undefined,
      pullRequestUrl: data.pull_request_url as string | undefined,
      branchName: data.branch_name as string | undefined,
      retryCount: (data.retry_count as number) || 0,
      maxRetries: (data.max_retries as number) || 2
    };
  }

  /**
   * Create initial session stats.
   */
  private createInitialStats(): SessionStats {
    return {
      sessionStartedAt: new Date(),
      elapsedTimeMs: 0,
      timeLimitMs: this.settings.sessionTimeLimitMinutes * 60 * 1000,
      remainingTimeMs: this.settings.sessionTimeLimitMinutes * 60 * 1000,
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksInProgress: 0,
      tasksSkipped: 0,
      totalTasksProcessed: 0,
      pullRequestsCreated: 0,
      tokensUsed: 0,
      tokenBudget: this.settings.tokenBudget,
      tokensRemaining: this.settings.tokenBudget,
      avgTaskDurationMs: 0,
      successRate: 0,
      rateLimitHits: 0
    };
  }

  /**
   * Update session stats with current timing.
   */
  private updateSessionStats(): SessionStats {
    if (this.sessionStartTime) {
      const now = new Date();
      const elapsedMs = now.getTime() - this.sessionStartTime.getTime();
      const timeLimitMs = this.settings.sessionTimeLimitMinutes * 60 * 1000;

      this.sessionStats.elapsedTimeMs = elapsedMs;
      this.sessionStats.remainingTimeMs = Math.max(0, timeLimitMs - elapsedMs);
      this.sessionStats.timeLimitMs = timeLimitMs;
      this.sessionStats.sessionStartedAt = this.sessionStartTime;

      // Calculate success rate
      const total = this.sessionStats.tasksCompleted + this.sessionStats.tasksFailed;
      this.sessionStats.successRate =
        total > 0 ? (this.sessionStats.tasksCompleted / total) * 100 : 0;

      // Update token budget remaining
      if (this.settings.tokenBudget) {
        this.sessionStats.tokenBudget = this.settings.tokenBudget;
        this.sessionStats.tokensRemaining = Math.max(
          0,
          this.settings.tokenBudget - this.sessionStats.tokensUsed
        );
      }
    }

    return { ...this.sessionStats };
  }

  /**
   * Calculate next poll time.
   */
  private calculateNextPollTime(): Date | undefined {
    if (this._state !== 'running') {
      return undefined;
    }
    return new Date(Date.now() + this.settings.pollIntervalSeconds * 1000);
  }

  /**
   * Emit error event.
   */
  private emitError(error: string): void {
    this.emit('queue-error', error);
  }

  /**
   * Emit status update event.
   */
  private emitStatusUpdate(): void {
    const status = this.getStatus();
    this.emit('status-update', status);
  }
}

// ============================================
// Singleton Instance
// ============================================

let instance: AutonomousQueueManager | null = null;

/**
 * Get the singleton AutonomousQueueManager instance.
 */
export function getAutonomousQueueManager(): AutonomousQueueManager {
  if (!instance) {
    instance = new AutonomousQueueManager();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing).
 */
export function resetAutonomousQueueManager(): void {
  if (instance) {
    instance.stop().catch(() => {
      // Ignore errors on reset
    });
    instance = null;
  }
}
