import { motion, AnimatePresence } from 'motion/react';
import { Clock, Loader2, CheckCircle2, XCircle, AlertCircle, Activity } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { BenchmarkMonitorProps, BenchmarkStatus } from './types';

/**
 * Status display configuration (colors and icons)
 */
const STATUS_CONFIG: Record<BenchmarkStatus, { color: string; bgColor: string; label: string }> = {
  idle: { color: 'bg-muted-foreground', bgColor: 'bg-muted', label: 'Ready' },
  loading: { color: 'bg-amber-500', bgColor: 'bg-amber-500/20', label: 'Loading...' },
  running: { color: 'bg-info', bgColor: 'bg-info/20', label: 'Running' },
  completed: { color: 'bg-success', bgColor: 'bg-success/20', label: 'Completed' },
  failed: { color: 'bg-destructive', bgColor: 'bg-destructive/20', label: 'Failed' },
};

/**
 * Format milliseconds to human-readable duration
 * @param ms Milliseconds
 * @returns Formatted duration string (e.g., "2h 30m 15s")
 */
function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes % 60 > 0 || hours > 0) {
    parts.push(`${minutes % 60}m`);
  }
  if (seconds % 60 > 0 || parts.length === 0) {
    parts.push(`${seconds % 60}s`);
  }

  return parts.join(' ');
}

/**
 * Format estimated completion time
 * @param estimatedMs Estimated remaining milliseconds
 * @returns Formatted estimated time string
 */
function formatEstimatedCompletion(estimatedMs: number | null): string {
  if (estimatedMs === null || estimatedMs <= 0) return 'Calculating...';

  const completionTime = new Date(Date.now() + estimatedMs);
  const timeStr = completionTime.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `~${formatDuration(estimatedMs)} (${timeStr})`;
}

/**
 * ExecutionMonitor - Real-time progress monitoring dashboard for SWE-bench benchmark execution
 *
 * Displays:
 * - Progress bar with percentage
 * - Current instance being processed
 * - Elapsed time since start
 * - Estimated time remaining and completion time
 */
export function ExecutionMonitor({
  status,
  currentInstance,
  progress,
  totalInstances,
  elapsedTime,
  estimatedRemaining,
}: BenchmarkMonitorProps) {
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  const isRunning = status === 'running' || status === 'loading';
  const isComplete = status === 'completed';
  const isFailed = status === 'failed';
  const progressPercentage = totalInstances > 0 ? Math.round((progress / totalInstances) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header with status */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-medium leading-none">Execution Monitor</h3>
          <p className="text-sm text-muted-foreground">
            Real-time benchmark progress tracking
          </p>
        </div>
        <StatusBadge status={status} config={statusConfig} isRunning={isRunning} />
      </div>

      {/* Progress section */}
      <div className="space-y-2">
        {/* Progress label row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Progress</span>
            {isRunning && (
              <motion.div
                className={cn('h-1.5 w-1.5 rounded-full', statusConfig.color)}
                animate={{
                  scale: [1, 1.5, 1],
                  opacity: [1, 0.5, 1],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            )}
          </div>
          <span className="text-xs font-medium text-foreground">
            {progress} / {totalInstances} ({progressPercentage}%)
          </span>
        </div>

        {/* Progress bar */}
        <div
          className={cn(
            'relative h-2 w-full overflow-hidden rounded-full',
            isFailed ? 'bg-destructive/20' : 'bg-border'
          )}
        >
          <AnimatePresence mode="wait">
            {isFailed ? (
              // Failed state - pulsing red bar
              <motion.div
                key="failed"
                className="absolute inset-0 bg-destructive/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
            ) : isRunning && progressPercentage === 0 ? (
              // Indeterminate progress when just starting
              <motion.div
                key="indeterminate"
                className={cn('absolute h-full w-1/4 rounded-full', statusConfig.color)}
                animate={{
                  x: ['-100%', '500%'],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            ) : (
              // Determinate progress bar
              <motion.div
                key="determinate"
                className={cn('h-full rounded-full', statusConfig.color)}
                initial={{ width: 0 }}
                animate={{ width: `${progressPercentage}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Current instance */}
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-start gap-3">
          <div className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full shrink-0',
            statusConfig.bgColor
          )}>
            {isRunning ? (
              <Activity className={cn('h-4 w-4', 'text-info')} />
            ) : isComplete ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : isFailed ? (
              <XCircle className="h-4 w-4 text-destructive" />
            ) : (
              <Clock className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              {isRunning ? 'Currently Processing' : isComplete ? 'Last Processed' : isFailed ? 'Failed On' : 'Waiting'}
            </p>
            {currentInstance ? (
              <p className="mt-0.5 truncate text-sm font-mono text-foreground" title={currentInstance}>
                {currentInstance}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground italic">
                {status === 'idle' ? 'No instance selected' : 'Processing...'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Time statistics */}
      <div className="grid grid-cols-2 gap-3">
        {/* Elapsed time */}
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Elapsed Time</span>
          </div>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {formatDuration(elapsedTime)}
          </p>
        </div>

        {/* Estimated remaining */}
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Est. Remaining</span>
          </div>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {isComplete ? (
              <span className="text-success">Done</span>
            ) : isFailed ? (
              <span className="text-destructive">N/A</span>
            ) : !isRunning ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              formatEstimatedCompletion(estimatedRemaining)
            )}
          </p>
        </div>
      </div>

      {/* Instance indicators (for visual progress tracking) */}
      {totalInstances > 0 && totalInstances <= 50 && (
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Instance Progress</span>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: totalInstances }).map((_, index) => (
              <motion.div
                key={`instance-${index}`}
                className={cn(
                  'h-2 w-2 rounded-full',
                  index < progress
                    ? 'bg-success'
                    : index === progress && isRunning
                      ? 'bg-info'
                      : 'bg-muted-foreground/30'
                )}
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                  ...(index === progress && isRunning && {
                    boxShadow: [
                      '0 0 0 0 rgba(var(--info), 0.4)',
                      '0 0 0 4px rgba(var(--info), 0)',
                    ],
                  }),
                }}
                transition={{
                  scale: { delay: index * 0.02, duration: 0.15 },
                  opacity: { delay: index * 0.02, duration: 0.15 },
                  boxShadow: index === progress && isRunning
                    ? { duration: 1, repeat: Infinity, ease: 'easeOut' }
                    : undefined,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Summary for larger runs */}
      {totalInstances > 50 && isRunning && (
        <div className="text-xs text-muted-foreground">
          Processing instance {progress + 1} of {totalInstances.toLocaleString()}
        </div>
      )}
    </div>
  );
}

/**
 * Status badge component for displaying current status
 */
function StatusBadge({
  status,
  config,
  isRunning,
}: {
  status: BenchmarkStatus;
  config: { color: string; bgColor: string; label: string };
  isRunning: boolean;
}) {
  const getStatusIcon = () => {
    switch (status) {
      case 'loading':
      case 'running':
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="h-3 w-3" />;
      case 'failed':
        return <XCircle className="h-3 w-3" />;
      default:
        return <Clock className="h-3 w-3" />;
    }
  };

  return (
    <motion.div
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        config.bgColor,
        status === 'running' && 'text-info',
        status === 'loading' && 'text-amber-500',
        status === 'completed' && 'text-success',
        status === 'failed' && 'text-destructive',
        status === 'idle' && 'text-muted-foreground'
      )}
      animate={
        isRunning
          ? { opacity: [1, 0.7, 1] }
          : { opacity: 1 }
      }
      transition={
        isRunning
          ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
          : undefined
      }
    >
      {getStatusIcon()}
      <span>{config.label}</span>
    </motion.div>
  );
}
