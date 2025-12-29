import { useEffect } from 'react';
import {
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  AlertCircle,
  RefreshCw,
  Loader2,
  TrendingUp,
  Database
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Progress } from '../ui/progress';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import {
  useSWEBenchStore,
  formatExecutionTime,
  getStatusColor,
  getStatusLabel,
  loadEvaluationRuns,
  type EvaluationStatus,
  type InstanceStatus
} from '../../stores/swebench-store';

/**
 * SWE-bench Dashboard Component
 *
 * Displays benchmark evaluation progress and metrics including:
 * - Total instances and completed count
 * - Progress bar with percentage
 * - Success rate and resolution metrics
 * - Current evaluation status
 */
export function SWEBenchDashboard() {
  const currentRun = useSWEBenchStore((state) => state.currentRun);
  const runs = useSWEBenchStore((state) => state.runs);
  const isLoading = useSWEBenchStore((state) => state.isLoading);
  const error = useSWEBenchStore((state) => state.error);
  const getProgressPercentage = useSWEBenchStore((state) => state.getProgressPercentage);
  const getSuccessRate = useSWEBenchStore((state) => state.getSuccessRate);

  // Load runs on mount
  useEffect(() => {
    loadEvaluationRuns();
  }, []);

  // Determine which run to display (current or most recent historical)
  const displayRun = currentRun || (runs.length > 0 ? runs[runs.length - 1] : null);
  const progressPercentage = getProgressPercentage();
  const successRate = getSuccessRate();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading evaluation data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => loadEvaluationRuns()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!displayRun) {
    return <EmptyState />;
  }

  const { metrics, progress, status, dataset, runId, startedAt, completedAt } = displayRun;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">SWE-bench Dashboard</h2>
              <p className="text-sm text-muted-foreground">
                Benchmark evaluation progress and results
              </p>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>

        {/* Run Info */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Run: {runId}</CardTitle>
                <CardDescription>{dataset}</CardDescription>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                {startedAt && (
                  <div>Started: {new Date(startedAt).toLocaleString()}</div>
                )}
                {completedAt && (
                  <div>Completed: {new Date(completedAt).toLocaleString()}</div>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Overall Progress */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Overall Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {metrics.completedInstances} of {metrics.totalInstances} instances completed
                </span>
                <span className="font-medium">{progressPercentage}%</span>
              </div>
              <Progress
                value={progressPercentage}
                className="h-3"
                animated={status === 'running'}
              />
            </div>

            {/* Current instance indicator */}
            {progress.currentInstanceId && status === 'running' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>Processing: {progress.currentInstanceId}</span>
              </div>
            )}

            {/* Time stats */}
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
              <div className="text-sm">
                <span className="text-muted-foreground">Elapsed:</span>
                <span className="ml-2 font-medium">
                  {formatExecutionTime(progress.elapsedTimeSeconds)}
                </span>
              </div>
              {progress.estimatedRemainingSeconds !== null && (
                <div className="text-sm">
                  <span className="text-muted-foreground">ETA:</span>
                  <span className="ml-2 font-medium">
                    {formatExecutionTime(progress.estimatedRemainingSeconds)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Statistics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Database}
            label="Total Instances"
            value={metrics.totalInstances}
            iconColor="text-blue-500"
            bgColor="bg-blue-500/10"
          />
          <StatCard
            icon={CheckCircle2}
            label="Successful"
            value={metrics.successfulInstances}
            iconColor="text-green-500"
            bgColor="bg-green-500/10"
          />
          <StatCard
            icon={XCircle}
            label="Failed"
            value={metrics.failedInstances}
            iconColor="text-red-500"
            bgColor="bg-red-500/10"
          />
          <StatCard
            icon={AlertCircle}
            label="Errors"
            value={metrics.errorInstances}
            iconColor="text-orange-500"
            bgColor="bg-orange-500/10"
          />
        </div>

        {/* Success Rate Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Resolution Rate
            </CardTitle>
            <CardDescription>
              Percentage of successfully resolved instances
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="text-4xl font-bold text-primary">
                {metrics.resolutionRate.toFixed(1)}%
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Success Rate</span>
                  <span className="font-medium">{successRate}%</span>
                </div>
                <Progress
                  value={successRate}
                  className="h-2"
                />
              </div>
            </div>

            {/* Additional Metrics */}
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-4">
              <div className="text-sm">
                <span className="text-muted-foreground">Total Time:</span>
                <span className="ml-2 font-medium">
                  {formatExecutionTime(metrics.totalExecutionTimeSeconds)}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Avg. per Instance:</span>
                <span className="ml-2 font-medium">
                  {formatExecutionTime(metrics.averageExecutionTimeSeconds)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Instance Breakdown by Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Instance Status Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <StatusRow
                status="success"
                count={metrics.successfulInstances}
                total={metrics.totalInstances}
              />
              <StatusRow
                status="failed"
                count={metrics.failedInstances}
                total={metrics.totalInstances}
              />
              <StatusRow
                status="error"
                count={metrics.errorInstances}
                total={metrics.totalInstances}
              />
              <StatusRow
                status="skipped"
                count={metrics.skippedInstances}
                total={metrics.totalInstances}
              />
              <StatusRow
                status="pending"
                count={metrics.totalInstances - metrics.completedInstances}
                total={metrics.totalInstances}
              />
            </div>
          </CardContent>
        </Card>

        {/* Historical Runs */}
        {runs.length > 1 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Historical Runs</CardTitle>
              <CardDescription>
                {runs.length} evaluation{runs.length !== 1 ? 's' : ''} completed
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {runs.slice(-5).reverse().map((run) => (
                  <div
                    key={run.runId}
                    className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <StatusBadge status={run.status} size="sm" />
                      <span className="text-sm font-medium">{run.runId}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span>{run.metrics.resolutionRate.toFixed(1)}%</span>
                      <span>{run.metrics.successfulInstances}/{run.metrics.totalInstances}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}

/**
 * Empty state when no evaluation data is available
 */
function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center p-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <BarChart3 className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mb-2 text-lg font-medium text-foreground">
        No Evaluation Data
      </h3>
      <p className="max-w-md text-sm text-muted-foreground mb-6">
        Start a SWE-bench evaluation using the CLI to see progress and results here.
      </p>
      <div className="rounded-lg bg-muted p-4 text-left">
        <p className="text-xs text-muted-foreground mb-2">Run evaluation with:</p>
        <code className="text-xs text-foreground font-mono">
          python -m cli.swebench_eval --dataset princeton-nlp/SWE-bench_Lite --max-instances 10
        </code>
      </div>
    </div>
  );
}

/**
 * Status badge component
 */
interface StatusBadgeProps {
  status: EvaluationStatus;
  size?: 'sm' | 'default';
}

function StatusBadge({ status, size = 'default' }: StatusBadgeProps) {
  const getStatusInfo = (status: EvaluationStatus) => {
    switch (status) {
      case 'idle':
        return { label: 'Idle', variant: 'secondary' as const, icon: Clock };
      case 'running':
        return { label: 'Running', variant: 'default' as const, icon: Loader2 };
      case 'paused':
        return { label: 'Paused', variant: 'outline' as const, icon: Clock };
      case 'completed':
        return { label: 'Completed', variant: 'default' as const, icon: CheckCircle2 };
      case 'failed':
        return { label: 'Failed', variant: 'destructive' as const, icon: XCircle };
      default:
        return { label: 'Unknown', variant: 'secondary' as const, icon: AlertCircle };
    }
  };

  const { label, variant, icon: Icon } = getStatusInfo(status);
  const iconClass = status === 'running' ? 'animate-spin' : '';

  return (
    <Badge
      variant={variant}
      className={cn(
        'gap-1',
        size === 'sm' && 'text-xs px-2 py-0.5'
      )}
    >
      <Icon className={cn('h-3 w-3', iconClass)} />
      {label}
    </Badge>
  );
}

/**
 * Statistic card component
 */
interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  iconColor: string;
  bgColor: string;
}

function StatCard({ icon: Icon, label, value, iconColor, bgColor }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', bgColor)}>
            <Icon className={cn('h-5 w-5', iconColor)} />
          </div>
          <div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Status row for instance breakdown
 */
interface StatusRowProps {
  status: InstanceStatus;
  count: number;
  total: number;
}

function StatusRow({ status, count, total }: StatusRowProps) {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <div className="w-20">
        <span className={cn('text-sm font-medium', getStatusColor(status))}>
          {getStatusLabel(status)}
        </span>
      </div>
      <div className="flex-1">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-300',
              status === 'success' && 'bg-green-500',
              status === 'failed' && 'bg-red-500',
              status === 'error' && 'bg-orange-500',
              status === 'skipped' && 'bg-gray-400',
              status === 'pending' && 'bg-gray-300',
              status === 'running' && 'bg-blue-500'
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      <div className="w-16 text-right">
        <span className="text-sm text-muted-foreground">{count}</span>
      </div>
    </div>
  );
}

export default SWEBenchDashboard;
