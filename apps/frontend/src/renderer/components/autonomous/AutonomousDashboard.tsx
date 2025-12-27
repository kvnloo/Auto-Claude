/**
 * Autonomous Mode Dashboard Component
 *
 * Main dashboard for autonomous mode operations, showing:
 * - Current task display
 * - Queue visualization
 * - Session statistics
 * - Control buttons (start/stop/pause/resume)
 */

import { useEffect } from 'react';
import {
  Play,
  Square,
  Pause,
  RotateCw,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  List
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { ScrollArea } from '../ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import {
  useAutonomousStore,
  useIsQueueRunning,
  useIsQueuePaused,
  usePendingTaskCount,
  useCompletedTaskCount,
  initializeAutonomousEventListeners
} from '../../stores/autonomous-store';
import type { AutonomousTask, QueuePauseReason } from '../../../shared/types/autonomous';

interface AutonomousDashboardProps {
  projectId: string;
}

/**
 * Format milliseconds as a human-readable duration string
 */
function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Get display text for pause reason
 */
function getPauseReasonText(reason: QueuePauseReason): string {
  const reasonMap: Record<QueuePauseReason, string> = {
    user_requested: 'Paused by user',
    rate_limit_hit: 'Rate limit reached',
    max_failures_reached: 'Too many failures',
    session_time_limit: 'Session time limit reached',
    token_budget_exhausted: 'Token budget exhausted',
    auth_expired: 'Authentication expired',
    critical_error: 'Critical error occurred'
  };
  return reasonMap[reason] || 'Paused';
}

/**
 * Get status badge variant
 */
function getStatusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'running':
      return 'default';
    case 'paused':
      return 'secondary';
    case 'completed':
      return 'default';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

/**
 * Queue Control Buttons
 */
function QueueControls({
  isRunning,
  isPaused,
  isLoading,
  onStart,
  onStop,
  onPause,
  onResume
}: {
  isRunning: boolean;
  isPaused: boolean;
  isLoading: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  return (
    <div className="flex gap-2">
      {!isRunning && !isPaused && (
        <Button onClick={onStart} disabled={isLoading} className="gap-2">
          <Play className="h-4 w-4" />
          Start Queue
        </Button>
      )}

      {isRunning && (
        <>
          <Button onClick={onPause} disabled={isLoading} variant="secondary" className="gap-2">
            <Pause className="h-4 w-4" />
            Pause
          </Button>
          <Button onClick={onStop} disabled={isLoading} variant="destructive" className="gap-2">
            <Square className="h-4 w-4" />
            Stop
          </Button>
        </>
      )}

      {isPaused && (
        <>
          <Button onClick={onResume} disabled={isLoading} className="gap-2">
            <RotateCw className="h-4 w-4" />
            Resume
          </Button>
          <Button onClick={onStop} disabled={isLoading} variant="destructive" className="gap-2">
            <Square className="h-4 w-4" />
            Stop
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * Current Task Display
 */
function CurrentTaskCard({ task, progress }: { task: AutonomousTask | null; progress: unknown }) {
  if (!task) {
    return (
      <Card className="col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Current Task
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            No task currently running
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 animate-pulse text-primary" />
            Current Task
          </CardTitle>
          <Badge variant={getStatusBadgeVariant(task.status)}>{task.status}</Badge>
        </div>
        <CardDescription className="line-clamp-2">{task.title}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {task.source && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium">Source:</span>
              <span>
                {task.source.provider === 'github_issue' &&
                  `GitHub #${(task.source as { issueNumber: number }).issueNumber}`}
                {task.source.provider === 'roadmap_feature' && 'Roadmap Feature'}
              </span>
            </div>
          )}

          {task.startedAt && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Started {new Date(task.startedAt).toLocaleTimeString()}</span>
            </div>
          )}

          {(() => {
            const progressData = progress as { percentage?: number } | null;
            if (progressData && typeof progressData.percentage === 'number') {
              return (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>Progress</span>
                    <span>{progressData.percentage}%</span>
                  </div>
                  <Progress value={progressData.percentage} />
                </div>
              );
            }
            return null;
          })()}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Session Statistics Card
 */
function SessionStatsCard({
  stats
}: {
  stats: {
    tasksCompleted: number;
    tasksFailed: number;
    elapsedTimeMs: number;
    remainingTimeMs: number;
    successRate: number;
    pullRequestsCreated: number;
  } | null;
}) {
  if (!stats) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Session Statistics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <div>
              <div className="text-2xl font-bold">{stats.tasksCompleted}</div>
              <div className="text-xs text-muted-foreground">Completed</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive" />
            <div>
              <div className="text-2xl font-bold">{stats.tasksFailed}</div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-lg font-semibold">{formatDuration(stats.elapsedTimeMs)}</div>
              <div className="text-xs text-muted-foreground">Elapsed</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-lg font-semibold">{Math.round(stats.successRate)}%</div>
              <div className="text-xs text-muted-foreground">Success Rate</div>
            </div>
          </div>
        </div>

        {stats.remainingTimeMs > 0 && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Time Remaining</span>
              <span className="font-medium">{formatDuration(stats.remainingTimeMs)}</span>
            </div>
          </div>
        )}

        {stats.pullRequestsCreated > 0 && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>{stats.pullRequestsCreated} PR(s) created</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Task Queue Card
 */
function TaskQueueCard({ tasks }: { tasks: AutonomousTask[] }) {
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const failedTasks = tasks.filter((t) => t.status === 'failed');

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <List className="h-5 w-5" />
            Task Queue
          </CardTitle>
          <Badge variant="outline">{tasks.length} total</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 mb-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 text-sm">
                  <div className="h-2 w-2 rounded-full bg-yellow-500" />
                  <span>{pendingTasks.length}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Pending</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 text-sm">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span>{completedTasks.length}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Completed</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 text-sm">
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                  <span>{failedTasks.length}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Failed</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {tasks.length === 0 ? (
          <div className="py-4 text-center text-muted-foreground text-sm">
            No tasks in queue
          </div>
        ) : (
          <ScrollArea className="h-[200px]">
            <div className="space-y-2">
              {tasks.slice(0, 10).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {task.status === 'pending' && (
                      <div className="h-2 w-2 rounded-full bg-yellow-500 flex-shrink-0" />
                    )}
                    {task.status === 'in_progress' && (
                      <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
                    )}
                    {task.status === 'completed' && (
                      <div className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
                    )}
                    {task.status === 'failed' && (
                      <div className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                    )}
                    <span className="truncate">{task.title}</span>
                  </div>
                  <Badge variant="outline" className="text-xs ml-2 flex-shrink-0">
                    {task.priority.level}
                  </Badge>
                </div>
              ))}
              {tasks.length > 10 && (
                <div className="text-center text-xs text-muted-foreground py-2">
                  +{tasks.length - 10} more tasks
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Main Autonomous Dashboard Component
 */
export function AutonomousDashboard({ projectId }: AutonomousDashboardProps) {
  const {
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

  const isRunning = useIsQueueRunning();
  const isPaused = useIsQueuePaused();
  const pendingCount = usePendingTaskCount();
  const completedCount = useCompletedTaskCount();

  // Initialize event listeners and load data
  useEffect(() => {
    const cleanup = initializeAutonomousEventListeners();
    loadSettings(projectId);
    refreshStatus();
    refreshQueue();

    return cleanup;
  }, [projectId, loadSettings, refreshStatus, refreshQueue]);

  // Handlers
  const handleStart = async () => {
    setError(null);
    await startQueue(projectId);
  };

  const handleStop = async () => {
    setError(null);
    await stopQueue();
  };

  const handlePause = async () => {
    setError(null);
    await pauseQueue();
  };

  const handleResume = async () => {
    setError(null);
    await resumeQueue();
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Autonomous Mode</h1>
          <p className="text-muted-foreground">
            Automatically process tasks from GitHub issues and roadmap features
          </p>
        </div>
        <QueueControls
          isRunning={isRunning}
          isPaused={isPaused}
          isLoading={isLoading}
          onStart={handleStart}
          onStop={handleStop}
          onPause={handlePause}
          onResume={handleResume}
        />
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Pause Reason Alert */}
      {isPaused && queueStatus?.pauseReason && (
        <div className="flex items-center gap-2 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-700 dark:text-yellow-400">
          <Pause className="h-5 w-5 flex-shrink-0" />
          <span>{getPauseReasonText(queueStatus.pauseReason)}</span>
        </div>
      )}

      {/* Status Bar */}
      <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
        <div className="flex items-center gap-2">
          <div
            className={`h-3 w-3 rounded-full ${
              isRunning
                ? 'bg-green-500 animate-pulse'
                : isPaused
                  ? 'bg-yellow-500'
                  : 'bg-muted-foreground'
            }`}
          />
          <span className="font-medium">
            {isRunning ? 'Running' : isPaused ? 'Paused' : 'Idle'}
          </span>
        </div>
        <Separator orientation="vertical" className="h-6" />
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            <strong>{pendingCount}</strong> pending
          </span>
          <span>
            <strong>{completedCount}</strong> completed
          </span>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Current Task - spans 2 columns */}
        <CurrentTaskCard task={currentTask} progress={currentTaskProgress} />

        {/* Task Queue */}
        <TaskQueueCard tasks={taskQueue} />

        {/* Session Statistics - spans full width when no current task */}
        {sessionStats && (
          <SessionStatsCard
            stats={{
              tasksCompleted: sessionStats.tasksCompleted,
              tasksFailed: sessionStats.tasksFailed,
              elapsedTimeMs: sessionStats.elapsedTimeMs,
              remainingTimeMs: sessionStats.remainingTimeMs,
              successRate: sessionStats.successRate,
              pullRequestsCreated: sessionStats.pullRequestsCreated
            }}
          />
        )}
      </div>
    </div>
  );
}

export default AutonomousDashboard;
