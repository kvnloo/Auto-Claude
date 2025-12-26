/**
 * MetricsDisplay - Performance visualization component for Claude Flow parallel execution
 *
 * Displays execution metrics including:
 * - Execution time
 * - Speedup factor compared to sequential execution
 * - Agent count and success/failure rates
 * - API call statistics
 * - Timeline information
 *
 * Used in the task details page to show performance results of parallel execution.
 */
import { useMemo } from 'react';
import {
  Clock,
  Zap,
  Users,
  CheckCircle2,
  XCircle,
  Activity,
  TrendingUp,
  Calendar,
  Timer,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './ui/tooltip';
import { cn } from '../lib/utils';
import styles from './MetricsDisplay.module.css';

/** Execution metrics data structure matching backend schema */
export interface ExecutionMetrics {
  /** Total execution time in seconds */
  execution_time_seconds: number;
  /** Number of agents used */
  agent_count: number;
  /** Speedup factor compared to sequential execution */
  speedup_factor: number;
  /** Estimated sequential execution time in seconds */
  sequential_baseline_seconds: number;
  /** Number of agents that completed successfully */
  agents_successful: number;
  /** Number of agents that failed */
  agents_failed: number;
  /** Total number of API calls made */
  api_calls_total: number;
  /** ISO timestamp when execution started */
  started_at: string;
  /** ISO timestamp when execution completed */
  completed_at: string;
}

/** Props for the MetricsDisplay component */
export interface MetricsDisplayProps {
  /** Execution metrics to display */
  metrics: ExecutionMetrics | null;
  /** Whether metrics are currently loading */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Additional CSS class name */
  className?: string;
  /** Compact mode for smaller displays */
  compact?: boolean;
}

/** Metric card configuration for rendering */
interface MetricCardConfig {
  label: string;
  value: string;
  icon: React.ReactNode;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'info' | 'destructive';
}

/**
 * Format seconds into a human-readable duration string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format an ISO timestamp to a localized time string
 */
function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return 'Invalid time';
  }
}

/**
 * Format an ISO timestamp to a localized date string
 */
function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return 'Invalid date';
  }
}

/**
 * Get the speedup badge variant based on the speedup factor
 */
function getSpeedupVariant(speedup: number): 'default' | 'success' | 'warning' | 'info' {
  if (speedup >= 7) return 'success';
  if (speedup >= 5) return 'info';
  if (speedup >= 3) return 'warning';
  return 'default';
}

/**
 * Get a descriptive label for the speedup factor
 */
function getSpeedupLabel(speedup: number): string {
  if (speedup >= 7) return 'Excellent';
  if (speedup >= 5) return 'Good';
  if (speedup >= 3) return 'Moderate';
  return 'Low';
}

/**
 * MetricsDisplay component for showing parallel execution performance metrics
 */
export function MetricsDisplay({
  metrics,
  isLoading = false,
  error = null,
  className,
  compact = false
}: MetricsDisplayProps) {
  // Calculate derived values
  const derivedMetrics = useMemo(() => {
    if (!metrics) return null;

    const successRate =
      metrics.agent_count > 0
        ? (metrics.agents_successful / metrics.agent_count) * 100
        : 0;

    const timeSaved = metrics.sequential_baseline_seconds - metrics.execution_time_seconds;
    const apiCallsPerAgent =
      metrics.agent_count > 0
        ? Math.round(metrics.api_calls_total / metrics.agent_count)
        : 0;

    return {
      successRate,
      timeSaved,
      apiCallsPerAgent
    };
  }, [metrics]);

  // Loading state
  if (isLoading) {
    return (
      <Card className={cn(styles.metricsDisplay, className)}>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary animate-pulse" />
            <CardTitle className="text-lg">Execution Metrics</CardTitle>
          </div>
          <CardDescription>Loading metrics...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted/50 rounded-lg animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className={cn(styles.metricsDisplay, className)}>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-lg">Execution Metrics</CardTitle>
          </div>
          <CardDescription>Failed to load metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <span className="text-sm text-destructive">{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No metrics state
  if (!metrics || !derivedMetrics) {
    return (
      <Card className={cn(styles.metricsDisplay, className)}>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Execution Metrics</CardTitle>
          </div>
          <CardDescription>No metrics available</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground text-sm">
            Metrics will appear here after task execution completes.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Compact mode for smaller displays
  if (compact) {
    return (
      <TooltipProvider delayDuration={200}>
        <div className={cn(styles.compactMetrics, 'flex items-center gap-3', className)}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{formatDuration(metrics.execution_time_seconds)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Execution time</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant={getSpeedupVariant(metrics.speedup_factor)} className="gap-1">
                <TrendingUp className="h-3 w-3" />
                {metrics.speedup_factor.toFixed(1)}x
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Speedup factor vs sequential</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{metrics.agents_successful}/{metrics.agent_count}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Agents successful / total</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    );
  }

  // Full metrics display
  return (
    <Card className={cn(styles.metricsDisplay, className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Execution Metrics</CardTitle>
          </div>
          <Badge variant={getSpeedupVariant(metrics.speedup_factor)} className="gap-1">
            <TrendingUp className="h-3 w-3" />
            {getSpeedupLabel(metrics.speedup_factor)}
          </Badge>
        </div>
        <CardDescription>
          Parallel execution completed with {metrics.agent_count} agents
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Primary Metrics Grid */}
        <div className={cn(styles.metricsGrid, 'grid grid-cols-2 lg:grid-cols-4 gap-4')}>
          {/* Execution Time */}
          <div className={cn(styles.metricCard, 'rounded-lg border border-border bg-card p-4')}>
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium">Execution Time</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {formatDuration(metrics.execution_time_seconds)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Saved {formatDuration(derivedMetrics.timeSaved)}
            </div>
          </div>

          {/* Speedup Factor */}
          <div className={cn(styles.metricCard, styles.speedupCard, 'rounded-lg border border-border bg-card p-4')}>
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Zap className="h-4 w-4" />
              <span className="text-xs font-medium">Speedup Factor</span>
            </div>
            <div className="text-2xl font-bold text-primary">
              {metrics.speedup_factor.toFixed(1)}x
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              vs {formatDuration(metrics.sequential_baseline_seconds)} sequential
            </div>
          </div>

          {/* Agent Count */}
          <div className={cn(styles.metricCard, 'rounded-lg border border-border bg-card p-4')}>
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Users className="h-4 w-4" />
              <span className="text-xs font-medium">Agents</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-foreground">{metrics.agent_count}</span>
              <span className="text-sm text-muted-foreground">parallel</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-3 w-3" />
                {metrics.agents_successful}
              </span>
              {metrics.agents_failed > 0 && (
                <span className="flex items-center gap-1 text-xs text-destructive">
                  <XCircle className="h-3 w-3" />
                  {metrics.agents_failed}
                </span>
              )}
            </div>
          </div>

          {/* API Calls */}
          <div className={cn(styles.metricCard, 'rounded-lg border border-border bg-card p-4')}>
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Activity className="h-4 w-4" />
              <span className="text-xs font-medium">API Calls</span>
            </div>
            <div className="text-2xl font-bold text-foreground">{metrics.api_calls_total}</div>
            <div className="text-xs text-muted-foreground mt-1">
              ~{derivedMetrics.apiCallsPerAgent} per agent
            </div>
          </div>
        </div>

        {/* Success Rate Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Agent Success Rate</span>
            <span className="font-medium text-foreground">{derivedMetrics.successRate.toFixed(0)}%</span>
          </div>
          <Progress
            value={derivedMetrics.successRate}
            className={cn(
              'h-2',
              derivedMetrics.successRate === 100 && '[&>div]:bg-success',
              derivedMetrics.successRate >= 80 && derivedMetrics.successRate < 100 && '[&>div]:bg-info',
              derivedMetrics.successRate < 80 && '[&>div]:bg-warning'
            )}
          />
        </div>

        {/* Timeline */}
        <div className={cn(styles.timeline, 'rounded-lg border border-border bg-muted/30 p-4')}>
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <Calendar className="h-4 w-4" />
            <span className="text-xs font-medium">Execution Timeline</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Timer className="h-3 w-3" />
                <span className="text-xs">Started</span>
              </div>
              <div className="font-medium text-foreground">{formatTimestamp(metrics.started_at)}</div>
              <div className="text-xs text-muted-foreground">{formatDate(metrics.started_at)}</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <CheckCircle2 className="h-3 w-3" />
                <span className="text-xs">Completed</span>
              </div>
              <div className="font-medium text-foreground">{formatTimestamp(metrics.completed_at)}</div>
              <div className="text-xs text-muted-foreground">{formatDate(metrics.completed_at)}</div>
            </div>
          </div>
        </div>

        {/* Performance Summary */}
        <div className={cn(styles.summaryPanel, 'rounded-lg border border-border bg-card p-4')}>
          <div className="text-sm font-medium text-foreground mb-3">Performance Summary</div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Parallel efficiency</span>
              <span className="font-medium text-foreground">
                {((metrics.speedup_factor / metrics.agent_count) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Time saved</span>
              <span className="font-medium text-success">
                {formatDuration(derivedMetrics.timeSaved)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Avg API calls/agent</span>
              <span className="font-medium text-foreground">
                {derivedMetrics.apiCallsPerAgent}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Sample metrics data for testing/demo purposes */
export const SAMPLE_METRICS: ExecutionMetrics = {
  execution_time_seconds: 45.2,
  agent_count: 8,
  speedup_factor: 6.8,
  sequential_baseline_seconds: 307.4,
  agents_successful: 8,
  agents_failed: 0,
  api_calls_total: 96,
  started_at: '2025-12-26T13:00:00Z',
  completed_at: '2025-12-26T13:00:45Z'
};

export default MetricsDisplay;
