import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  Clock,
  Timer,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  TrendingUp,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { cn } from '../../lib/utils';
import {
  useSWEBenchStore,
  formatExecutionTime,
  type EvaluationStatus,
} from '../../stores/swebench-store';

/**
 * Hook to detect user's reduced motion preference.
 * Listens for changes to the prefers-reduced-motion media query.
 */
function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handleChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return reducedMotion;
}

/**
 * Hook to track elapsed time with real-time updates
 */
function useElapsedTimer(startedAt: Date | null, isRunning: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt || !isRunning) {
      return;
    }

    const updateElapsed = () => {
      const now = new Date();
      const elapsedSeconds = Math.floor(
        (now.getTime() - startedAt.getTime()) / 1000
      );
      setElapsed(elapsedSeconds);
    };

    // Update immediately
    updateElapsed();

    // Update every second
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startedAt, isRunning]);

  return elapsed;
}

interface SWEBenchProgressProps {
  className?: string;
}

/**
 * Progress monitor component for SWE-bench evaluations.
 * Displays:
 * - Current instance being processed
 * - Elapsed time with real-time updates
 * - Estimated time remaining (ETA)
 * - Overall progress visualization
 * - Instance processing rate
 */
export function SWEBenchProgress({ className }: SWEBenchProgressProps) {
  const currentRun = useSWEBenchStore((state) => state.currentRun);
  const getProgressPercentage = useSWEBenchStore(
    (state) => state.getProgressPercentage
  );

  const reducedMotion = useReducedMotion();
  const isRunning = currentRun?.status === 'running';
  const elapsedSeconds = useElapsedTimer(currentRun?.startedAt || null, isRunning);

  // If no run is active, show empty state
  if (!currentRun) {
    return (
      <Card className={cn('w-full', className)}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5" />
            Progress Monitor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Clock className="mb-3 h-12 w-12 opacity-40" />
            <p className="text-sm">No evaluation running</p>
            <p className="text-xs mt-1">
              Start an evaluation to see progress here
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { progress, metrics, status } = currentRun;
  const progressPercentage = getProgressPercentage();

  // Calculate real elapsed time if running, otherwise use stored value
  const displayElapsed = isRunning ? elapsedSeconds : progress.elapsedTimeSeconds;

  // Calculate ETA based on current progress
  const calculateETA = (): number | null => {
    if (!isRunning || metrics.completedInstances === 0) return null;

    const instancesRemaining = metrics.totalInstances - metrics.completedInstances;
    if (instancesRemaining <= 0) return 0;

    const avgTimePerInstance = displayElapsed / metrics.completedInstances;
    return Math.round(avgTimePerInstance * instancesRemaining);
  };

  const eta = progress.estimatedRemainingSeconds ?? calculateETA();

  // Calculate instances per hour
  const calculateInstancesPerHour = (): number | null => {
    if (displayElapsed === 0 || metrics.completedInstances === 0) return null;
    return Math.round((metrics.completedInstances / displayElapsed) * 3600);
  };

  const instancesPerHour =
    progress.instancesPerHour ?? calculateInstancesPerHour();

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5" />
            Progress Monitor
          </CardTitle>
          <StatusBadge status={status} reducedMotion={reducedMotion} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Instance */}
        <CurrentInstanceDisplay
          instanceId={progress.currentInstanceId}
          instanceIndex={progress.currentInstanceIndex}
          totalInstances={metrics.totalInstances}
          status={status}
          reducedMotion={reducedMotion}
        />

        {/* Progress Bar */}
        <ProgressBarSection
          progress={progressPercentage}
          completedInstances={metrics.completedInstances}
          totalInstances={metrics.totalInstances}
          status={status}
        />

        {/* Time Metrics */}
        <TimeMetricsGrid
          elapsedSeconds={displayElapsed}
          etaSeconds={eta}
          instancesPerHour={instancesPerHour}
          isRunning={isRunning}
        />

        {/* Success/Failure Stats */}
        <StatsRow
          successful={metrics.successfulInstances}
          failed={metrics.failedInstances}
          errors={metrics.errorInstances}
          status={status}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Status badge component showing the current evaluation status
 */
function StatusBadge({
  status,
  reducedMotion,
}: {
  status: EvaluationStatus;
  reducedMotion: boolean;
}) {
  const getStatusConfig = () => {
    switch (status) {
      case 'running':
        return {
          icon: Play,
          label: 'Running',
          variant: 'success' as const,
          animate: !reducedMotion,
        };
      case 'paused':
        return {
          icon: Pause,
          label: 'Paused',
          variant: 'warning' as const,
          animate: false,
        };
      case 'completed':
        return {
          icon: CheckCircle2,
          label: 'Completed',
          variant: 'success' as const,
          animate: false,
        };
      case 'failed':
        return {
          icon: XCircle,
          label: 'Failed',
          variant: 'destructive' as const,
          animate: false,
        };
      default:
        return {
          icon: Clock,
          label: 'Idle',
          variant: 'muted' as const,
          animate: false,
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="flex items-center gap-1">
      {config.animate ? (
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          <Icon className="h-3 w-3" />
        </motion.div>
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {config.label}
    </Badge>
  );
}

/**
 * Displays the current instance being processed
 */
function CurrentInstanceDisplay({
  instanceId,
  instanceIndex,
  totalInstances,
  status,
  reducedMotion,
}: {
  instanceId: string | null;
  instanceIndex: number;
  totalInstances: number;
  status: EvaluationStatus;
  reducedMotion: boolean;
}) {
  const isRunning = status === 'running';

  if (!instanceId && !isRunning) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Waiting to start...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning && (
            <motion.div
              animate={reducedMotion ? {} : { rotate: 360 }}
              transition={
                reducedMotion
                  ? {}
                  : { duration: 1, repeat: Infinity, ease: 'linear' }
              }
            >
              <Loader2 className="h-4 w-4 text-primary" />
            </motion.div>
          )}
          <span className="text-sm font-medium">Current Instance</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {instanceIndex + 1} of {totalInstances}
        </span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={instanceId || 'empty'}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.2 }}
          className="mt-2"
        >
          {instanceId ? (
            <code className="block truncate rounded bg-background px-2 py-1 text-sm font-mono">
              {instanceId}
            </code>
          ) : (
            <span className="text-sm text-muted-foreground">
              Processing...
            </span>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * Progress bar with percentage and instance count
 */
function ProgressBarSection({
  progress,
  completedInstances,
  totalInstances,
  status,
}: {
  progress: number;
  completedInstances: number;
  totalInstances: number;
  status: EvaluationStatus;
}) {
  const isRunning = status === 'running';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Overall Progress</span>
        <span className="font-medium">{progress}%</span>
      </div>
      <Progress value={progress} animated={isRunning} />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {completedInstances} / {totalInstances} instances
        </span>
        <span>{totalInstances - completedInstances} remaining</span>
      </div>
    </div>
  );
}

/**
 * Grid showing time-related metrics
 */
function TimeMetricsGrid({
  elapsedSeconds,
  etaSeconds,
  instancesPerHour,
  isRunning,
}: {
  elapsedSeconds: number;
  etaSeconds: number | null;
  instancesPerHour: number | null;
  isRunning: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {/* Elapsed Time */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
        <div className="flex items-center justify-center gap-1 text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span className="text-xs">Elapsed</span>
        </div>
        <div className="mt-1 text-lg font-semibold">
          {formatExecutionTime(elapsedSeconds)}
        </div>
      </div>

      {/* ETA */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
        <div className="flex items-center justify-center gap-1 text-muted-foreground">
          <Timer className="h-3.5 w-3.5" />
          <span className="text-xs">ETA</span>
        </div>
        <div className="mt-1 text-lg font-semibold">
          {isRunning && etaSeconds !== null
            ? formatExecutionTime(etaSeconds)
            : '-'}
        </div>
      </div>

      {/* Rate */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
        <div className="flex items-center justify-center gap-1 text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5" />
          <span className="text-xs">Rate</span>
        </div>
        <div className="mt-1 text-lg font-semibold">
          {instancesPerHour !== null ? `${instancesPerHour}/h` : '-'}
        </div>
      </div>
    </div>
  );
}

/**
 * Row showing success, failure, and error counts
 */
function StatsRow({
  successful,
  failed,
  errors,
  status,
}: {
  successful: number;
  failed: number;
  errors: number;
  status: EvaluationStatus;
}) {
  const isActive = status === 'running' || status === 'completed';

  if (!isActive && successful === 0 && failed === 0 && errors === 0) {
    return null;
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-4">
        {/* Successful */}
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-success">{successful}</span>
          <span className="text-xs text-muted-foreground">passed</span>
        </div>

        {/* Failed */}
        <div className="flex items-center gap-1.5">
          <XCircle className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium text-destructive">{failed}</span>
          <span className="text-xs text-muted-foreground">failed</span>
        </div>

        {/* Errors */}
        {errors > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 text-warning" />
            <span className="text-sm font-medium text-warning">{errors}</span>
            <span className="text-xs text-muted-foreground">errors</span>
          </div>
        )}
      </div>

      {/* Success Rate */}
      {(successful + failed) > 0 && (
        <div className="text-right">
          <span className="text-xs text-muted-foreground">Success Rate</span>
          <div className="text-sm font-medium">
            {Math.round((successful / (successful + failed)) * 100)}%
          </div>
        </div>
      )}
    </div>
  );
}

export default SWEBenchProgress;
