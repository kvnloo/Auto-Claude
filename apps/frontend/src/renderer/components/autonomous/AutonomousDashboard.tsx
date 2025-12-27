/**
 * Autonomous Mode Dashboard
 *
 * Main dashboard for autonomous mode showing:
 * - Current task display with progress
 * - Queue visualization (pending/in-progress/completed/failed tasks)
 * - Session statistics (tasks completed, failures, time elapsed, tokens used)
 * - Control buttons (Start, Stop, Pause/Resume)
 *
 * Uses Radix UI components and Tailwind CSS for consistency.
 */

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Square,
  Pause,
  RotateCcw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  GitPullRequest,
  Github,
  Map,
  Zap,
  Timer,
  Coins,
  TrendingUp,
  ListTodo,
  RefreshCw,
  Bot,
  ExternalLink,
  Activity
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import { cn } from '../../lib/utils';
import {
  useAutonomousStore,
  useIsQueueRunning,
  useIsQueuePaused,
  usePauseReason,
  initializeAutonomousEventListeners
} from '../../stores/autonomous-store';
import { useProjectStore } from '../../stores/project-store';
import type {
  AutonomousTask,
  TaskStatus,
  QueueState,
  QueuePauseReason,
  TaskProgressPhase,
  TaskProgress,
  SessionStats,
  GitHubIssueSource
} from '../../../shared/types/autonomous';

// ============================================
// Constants
// ============================================

const QUEUE_STATE_LABELS: Record<QueueState, string> = {
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
  error: 'Error'
};

const QUEUE_STATE_COLORS: Record<QueueState, string> = {
  idle: 'bg-muted text-muted-foreground',
  running: 'bg-primary/10 text-primary border-primary/30',
  paused: 'bg-warning/10 text-warning border-warning/30',
  stopped: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/10 text-destructive border-destructive/30'
};

const PAUSE_REASON_LABELS: Record<QueuePauseReason, string> = {
  user_requested: 'Paused by user',
  max_failures_reached: 'Max failures reached',
  session_time_limit: 'Session time limit',
  token_budget_exhausted: 'Token budget exhausted',
  rate_limit_hit: 'Rate limit hit',
  auth_expired: 'Authentication expired',
  critical_error: 'Critical error'
};

const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  in_progress: 'bg-info/10 text-info border-info/30',
  completed: 'bg-success/10 text-success border-success/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/30'
};

const TASK_STATUS_ICONS: Record<TaskStatus, typeof CheckCircle2> = {
  pending: Clock,
  in_progress: Loader2,
  completed: CheckCircle2,
  failed: XCircle
};

const PROGRESS_PHASE_LABELS: Record<TaskProgressPhase, string> = {
  fetching: 'Fetching tasks',
  prioritizing: 'Prioritizing',
  generating_spec: 'Generating spec',
  planning: 'Planning',
  implementing: 'Implementing',
  testing: 'Testing',
  qa_review: 'QA Review',
  creating_pr: 'Creating PR',
  updating_status: 'Updating status',
  completed: 'Completed',
  failed: 'Failed'
};

// ============================================
// Helper Functions
// ============================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

// ============================================
// Sub-Components
// ============================================

/**
 * Empty state when autonomous mode is not active and no tasks exist
 */
function EmptyState({ onStart, isLoading }: { onStart: () => void; isLoading: boolean }) {
  return (
    <div className="flex h-full items-center justify-center">
      <Card className="w-full max-w-lg p-8 text-center">
        <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Autonomous Mode</h2>
        <p className="text-muted-foreground mb-6">
          Enable autonomous mode to automatically process tasks from GitHub Issues and your Roadmap.
          Tasks will be executed through the full pipeline with PRs created for completed work.
        </p>
        <Button onClick={onStart} size="lg" disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Start Autonomous Mode
        </Button>
      </Card>
    </div>
  );
}

/**
 * Control buttons for queue management
 */
function QueueControls({
  state,
  isLoading,
  onStart,
  onStop,
  onPause,
  onResume,
  onRefresh
}: {
  state: QueueState;
  isLoading: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onRefresh: () => void;
}) {
  const isRunning = state === 'running';
  const isPaused = state === 'paused';
  const isStopped = state === 'stopped' || state === 'idle';

  return (
    <div className="flex items-center gap-2">
      {isStopped ? (
        <Button onClick={onStart} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Start
        </Button>
      ) : (
        <>
          {isRunning && (
            <Button variant="outline" onClick={onPause} disabled={isLoading}>
              <Pause className="h-4 w-4 mr-2" />
              Pause
            </Button>
          )}
          {isPaused && (
            <Button variant="outline" onClick={onResume} disabled={isLoading}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Resume
            </Button>
          )}
          <Button variant="destructive" onClick={onStop} disabled={isLoading}>
            <Square className="h-4 w-4 mr-2" />
            Stop
          </Button>
        </>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh status</TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * Queue status header with state badge
 */
function QueueStatusHeader({
  state,
  pauseReason,
  pendingCount,
  completedCount,
  failedCount
}: {
  state: QueueState;
  pauseReason?: QueuePauseReason;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Autonomous Mode</h2>
        </div>
        <Badge variant="outline" className={cn('text-xs', QUEUE_STATE_COLORS[state])}>
          {state === 'running' && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          {QUEUE_STATE_LABELS[state]}
        </Badge>
        {pauseReason && state === 'paused' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {PAUSE_REASON_LABELS[pauseReason]}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              Queue paused: {PAUSE_REASON_LABELS[pauseReason]}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Pending:</span>
          <span className="font-medium">{pendingCount}</span>
        </div>
        <div className="flex items-center gap-1">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="text-muted-foreground">Done:</span>
          <span className="font-medium text-success">{completedCount}</span>
        </div>
        {failedCount > 0 && (
          <div className="flex items-center gap-1">
            <XCircle className="h-4 w-4 text-destructive" />
            <span className="text-muted-foreground">Failed:</span>
            <span className="font-medium text-destructive">{failedCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Current task card with progress
 */
function CurrentTaskCard({
  task,
  progress
}: {
  task: AutonomousTask | null;
  progress: TaskProgress | null;
}) {
  if (!task) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Current Task
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 mr-2 animate-spin opacity-50" />
            Waiting for next task...
          </div>
        </CardContent>
      </Card>
    );
  }

  const isGitHubIssue = task.source.provider === 'github_issue';
  const SourceIcon = isGitHubIssue ? Github : Map;
  const sourceLabel = isGitHubIssue
    ? `#${(task.source as GitHubIssueSource).issueNumber}`
    : 'Roadmap';

  return (
    <Card className="ring-2 ring-primary/50 border-primary">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                In Progress
              </Badge>
              <Badge variant="outline" className="text-xs">
                <SourceIcon className="h-3 w-3 mr-1" />
                {sourceLabel}
              </Badge>
              {task.priority && (
                <Badge variant="outline" className="text-xs">
                  {task.priority.level}
                </Badge>
              )}
            </div>
            <CardTitle className="text-base line-clamp-2">{task.title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {task.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{task.description}</p>
        )}
        {progress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {PROGRESS_PHASE_LABELS[progress.phase] || progress.phase}
              </span>
              <span className="font-medium">{progress.progress}%</span>
            </div>
            <Progress value={progress.progress} animated className="h-2" />
            {progress.message && (
              <p className="text-xs text-muted-foreground truncate">{progress.message}</p>
            )}
          </div>
        )}
        {task.startedAt && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Started {new Date(task.startedAt).toLocaleTimeString()}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Session statistics display
 */
function SessionStatsCard({ stats }: { stats: SessionStats | null }) {
  if (!stats) {
    return null;
  }

  const timeProgress = stats.remainingTimeMs > 0
    ? ((stats.elapsedTimeMs / (stats.elapsedTimeMs + stats.remainingTimeMs)) * 100)
    : 0;

  const tokenProgress = stats.tokenBudget
    ? ((stats.tokensUsed / stats.tokenBudget) * 100)
    : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Session Statistics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Time Elapsed */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Timer className="h-3 w-3" />
              Time Elapsed
            </div>
            <div className="font-semibold">{formatDuration(stats.elapsedTimeMs)}</div>
            {stats.remainingTimeMs > 0 && (
              <div className="text-xs text-muted-foreground">
                {formatDuration(stats.remainingTimeMs)} remaining
              </div>
            )}
            {timeProgress > 0 && (
              <Progress value={timeProgress} className="h-1 mt-1" />
            )}
          </div>

          {/* Tasks Completed */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3" />
              Tasks Completed
            </div>
            <div className="font-semibold text-success">{stats.tasksCompleted}</div>
            {stats.tasksFailed > 0 && (
              <div className="text-xs text-destructive">
                {stats.tasksFailed} failed
              </div>
            )}
          </div>

          {/* Success Rate */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Zap className="h-3 w-3" />
              Success Rate
            </div>
            <div className={cn(
              'font-semibold',
              stats.successRate >= 80 ? 'text-success' :
              stats.successRate >= 50 ? 'text-warning' :
              'text-destructive'
            )}>
              {stats.successRate.toFixed(0)}%
            </div>
            <div className="text-xs text-muted-foreground">
              {stats.pullRequestsCreated} PRs created
            </div>
          </div>

          {/* Tokens Used */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Coins className="h-3 w-3" />
              Tokens Used
            </div>
            <div className="font-semibold">{formatNumber(stats.tokensUsed)}</div>
            {stats.tokenBudget && (
              <>
                <div className="text-xs text-muted-foreground">
                  of {formatNumber(stats.tokenBudget)} budget
                </div>
                <Progress
                  value={tokenProgress}
                  className={cn('h-1 mt-1', tokenProgress > 90 && '[&>div]:bg-warning')}
                />
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Single task item in the queue list
 */
function TaskQueueItem({ task }: { task: AutonomousTask }) {
  const StatusIcon = TASK_STATUS_ICONS[task.status];
  const isGitHubIssue = task.source.provider === 'github_issue';
  const SourceIcon = isGitHubIssue ? Github : Map;
  const sourceLabel = isGitHubIssue
    ? `#${(task.source as GitHubIssueSource).issueNumber}`
    : 'Feature';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        'p-3 rounded-lg border bg-card',
        task.status === 'in_progress' && 'ring-1 ring-primary/50 border-primary/30'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          'mt-0.5 p-1.5 rounded-full',
          task.status === 'completed' && 'bg-success/10 text-success',
          task.status === 'failed' && 'bg-destructive/10 text-destructive',
          task.status === 'in_progress' && 'bg-info/10 text-info',
          task.status === 'pending' && 'bg-muted text-muted-foreground'
        )}>
          <StatusIcon className={cn(
            'h-4 w-4',
            task.status === 'in_progress' && 'animate-spin'
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px]', TASK_STATUS_COLORS[task.status])}>
              {task.status === 'in_progress' ? 'Running' : task.status}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              <SourceIcon className="h-2.5 w-2.5 mr-1" />
              {sourceLabel}
            </Badge>
            {task.priority && (
              <Badge variant="outline" className="text-[10px]">
                {task.priority.level}
              </Badge>
            )}
          </div>
          <h4 className="text-sm font-medium truncate">{task.title}</h4>
          {task.error && (
            <p className="text-xs text-destructive mt-1 truncate">{task.error}</p>
          )}
          {task.pullRequestUrl && (
            <a
              href={task.pullRequestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
            >
              <GitPullRequest className="h-3 w-3" />
              View PR
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Queue visualization showing all tasks by status
 */
function TaskQueueList({ tasks }: { tasks: AutonomousTask[] }) {
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const failedTasks = tasks.filter((t) => t.status === 'failed');

  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          <ListTodo className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No tasks in queue</p>
          <p className="text-xs mt-1">
            Tasks from GitHub Issues and Roadmap will appear here
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ListTodo className="h-4 w-4" />
          Task Queue
          <span className="text-muted-foreground font-normal">({tasks.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="p-4 space-y-2">
            <AnimatePresence mode="popLayout">
              {/* In Progress */}
              {inProgressTasks.map((task) => (
                <TaskQueueItem key={task.id} task={task} />
              ))}
              {/* Pending */}
              {pendingTasks.map((task) => (
                <TaskQueueItem key={task.id} task={task} />
              ))}
              {/* Separator for completed/failed */}
              {(completedTasks.length > 0 || failedTasks.length > 0) &&
                (inProgressTasks.length > 0 || pendingTasks.length > 0) && (
                <Separator className="my-3" />
              )}
              {/* Completed */}
              {completedTasks.slice(0, 5).map((task) => (
                <TaskQueueItem key={task.id} task={task} />
              ))}
              {completedTasks.length > 5 && (
                <div className="text-xs text-muted-foreground text-center py-2">
                  +{completedTasks.length - 5} more completed tasks
                </div>
              )}
              {/* Failed */}
              {failedTasks.map((task) => (
                <TaskQueueItem key={task.id} task={task} />
              ))}
            </AnimatePresence>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ============================================
// Main Component
// ============================================

interface AutonomousDashboardProps {
  /** Optional project ID override. If not provided, uses active project from store. */
  projectId?: string;
}

export function AutonomousDashboard({ projectId: propProjectId }: AutonomousDashboardProps) {
  // Store state
  const {
    isEnabled,
    isLoading,
    error,
    queueStatus,
    currentTask,
    currentTaskProgress,
    taskQueue,
    sessionStats,
    startQueue,
    stopQueue,
    pauseQueue,
    resumeQueue,
    refreshStatus,
    refreshQueue,
    loadSettings,
    setError
  } = useAutonomousStore();

  // Get current project from store if not provided via props
  const activeProject = useProjectStore((state) => state.getActiveProject());
  const projectId = propProjectId ?? activeProject?.id;

  // Derived state
  const isQueueRunning = useIsQueueRunning();
  const isQueuePaused = useIsQueuePaused();
  const pauseReason = usePauseReason();

  // Initialize IPC event listeners
  useEffect(() => {
    const cleanup = initializeAutonomousEventListeners();
    return cleanup;
  }, []);

  // Load initial status and settings when project changes
  useEffect(() => {
    if (projectId) {
      loadSettings(projectId);
      refreshStatus();
      refreshQueue();
    }
  }, [projectId, loadSettings, refreshStatus, refreshQueue]);

  // Handlers
  const handleStart = useCallback(async () => {
    if (projectId) {
      setError(null);
      await startQueue(projectId);
    }
  }, [projectId, startQueue, setError]);

  const handleStop = useCallback(async () => {
    setError(null);
    await stopQueue();
  }, [stopQueue, setError]);

  const handlePause = useCallback(async () => {
    setError(null);
    await pauseQueue('user_requested');
  }, [pauseQueue, setError]);

  const handleResume = useCallback(async () => {
    setError(null);
    await resumeQueue();
  }, [resumeQueue, setError]);

  const handleRefresh = useCallback(async () => {
    await refreshStatus();
    await refreshQueue();
  }, [refreshStatus, refreshQueue]);

  const handleDismissError = useCallback(() => {
    setError(null);
  }, [setError]);

  // Show empty state if no queue status and not enabled
  const state = queueStatus?.state ?? 'idle';
  const showEmptyState = !isEnabled && state === 'idle' && taskQueue.length === 0;

  // No project selected state
  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <Card className="w-full max-w-lg p-8 text-center">
          <AlertTriangle className="h-12 w-12 text-warning mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">No Project Selected</h2>
          <p className="text-muted-foreground">
            Please select a project to enable autonomous mode.
          </p>
        </Card>
      </div>
    );
  }

  // Empty state - show when not running and no tasks
  if (showEmptyState) {
    return <EmptyState onStart={handleStart} isLoading={isLoading} />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-4 bg-card/50">
        <div className="flex items-center justify-between">
          <QueueStatusHeader
            state={state}
            pauseReason={pauseReason}
            pendingCount={queueStatus?.pendingCount ?? 0}
            completedCount={queueStatus?.completedCount ?? 0}
            failedCount={queueStatus?.failedCount ?? 0}
          />
          <QueueControls
            state={state}
            isLoading={isLoading}
            onStart={handleStart}
            onStop={handleStop}
            onPause={handlePause}
            onResume={handleResume}
            onRefresh={handleRefresh}
          />
        </div>

        {/* Error Alert */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4"
            >
              <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-sm">{error}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={handleDismissError}>
                  Dismiss
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left Column - Current Task & Stats */}
          <div className="space-y-4">
            {/* Current Task */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Current Task</h3>
              <CurrentTaskCard
                task={currentTask}
                progress={currentTaskProgress}
              />
            </div>

            {/* Session Stats */}
            {(isQueueRunning || isQueuePaused || sessionStats) && (
              <SessionStatsCard stats={sessionStats} />
            )}
          </div>

          {/* Right Column - Task Queue */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Queue</h3>
            <TaskQueueList tasks={taskQueue} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default AutonomousDashboard;
