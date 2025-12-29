import { useMemo } from 'react';
import {
  Table,
  FileSearch,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  SkipForward,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import { cn } from '../../lib/utils';
import {
  useSWEBenchStore,
  formatExecutionTime,
  getStatusLabel,
  loadEvaluationRuns,
  type InstanceStatus,
  type SWEBenchInstanceResult,
} from '../../stores/swebench-store';

interface SWEBenchResultsProps {
  className?: string;
}

/**
 * SWE-bench Results Table Component
 *
 * Displays a table of evaluation results with:
 * - Instance ID column
 * - Status column with colored badges
 * - Execution time column
 * - Error message column with tooltips
 * - Filtering by status
 * - Sorting by instance_id, status, or execution time
 */
export function SWEBenchResults({ className }: SWEBenchResultsProps) {
  const currentRun = useSWEBenchStore((state) => state.currentRun);
  const runs = useSWEBenchStore((state) => state.runs);
  const selectedInstanceId = useSWEBenchStore((state) => state.selectedInstanceId);
  const isLoading = useSWEBenchStore((state) => state.isLoading);
  const error = useSWEBenchStore((state) => state.error);
  const statusFilter = useSWEBenchStore((state) => state.statusFilter);
  const sortBy = useSWEBenchStore((state) => state.sortBy);
  const sortOrder = useSWEBenchStore((state) => state.sortOrder);
  const getFilteredResults = useSWEBenchStore((state) => state.getFilteredResults);
  const setStatusFilter = useSWEBenchStore((state) => state.setStatusFilter);
  const setSortBy = useSWEBenchStore((state) => state.setSortBy);
  const setSortOrder = useSWEBenchStore((state) => state.setSortOrder);
  const selectInstance = useSWEBenchStore((state) => state.selectInstance);

  // Get the display run (current or most recent historical)
  const displayRun = currentRun || (runs.length > 0 ? runs[runs.length - 1] : null);
  const filteredResults = getFilteredResults();

  // Status count summary
  const statusCounts = useMemo(() => {
    if (!displayRun) return null;
    const results = displayRun.results;
    return {
      all: results.length,
      pending: results.filter((r) => r.status === 'pending').length,
      running: results.filter((r) => r.status === 'running').length,
      success: results.filter((r) => r.status === 'success').length,
      failed: results.filter((r) => r.status === 'failed').length,
      error: results.filter((r) => r.status === 'error').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    };
  }, [displayRun]);

  // Toggle sort order or change sort column
  const handleSort = (column: 'instanceId' | 'status' | 'executionTime') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  // Render sort indicator
  const SortIndicator = ({ column }: { column: 'instanceId' | 'status' | 'executionTime' }) => {
    if (sortBy !== column) {
      return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/50" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3 text-primary" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 text-primary" />
    );
  };

  if (isLoading) {
    return (
      <Card className={cn('w-full', className)}>
        <div className="flex h-64 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading results...</p>
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn('w-full', className)}>
        <div className="flex h-64 items-center justify-center">
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
      </Card>
    );
  }

  if (!displayRun || displayRun.results.length === 0) {
    return <EmptyState className={className} />;
  }

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Table className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Evaluation Results</CardTitle>
              <CardDescription>
                {displayRun.runId} - {filteredResults.length} of{' '}
                {displayRun.results.length} instances
              </CardDescription>
            </div>
          </div>

          {/* Filter Control */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                setStatusFilter(value as InstanceStatus | 'all')
              }
            >
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  All ({statusCounts?.all ?? 0})
                </SelectItem>
                <SelectItem value="success">
                  Success ({statusCounts?.success ?? 0})
                </SelectItem>
                <SelectItem value="failed">
                  Failed ({statusCounts?.failed ?? 0})
                </SelectItem>
                <SelectItem value="error">
                  Error ({statusCounts?.error ?? 0})
                </SelectItem>
                <SelectItem value="pending">
                  Pending ({statusCounts?.pending ?? 0})
                </SelectItem>
                <SelectItem value="running">
                  Running ({statusCounts?.running ?? 0})
                </SelectItem>
                <SelectItem value="skipped">
                  Skipped ({statusCounts?.skipped ?? 0})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <TooltipProvider>
          <ScrollArea className="h-[500px]">
            <div className="min-w-full">
              {/* Table Header */}
              <div className="sticky top-0 z-10 flex items-center border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
                <button
                  className="flex flex-1 items-center hover:text-foreground transition-colors"
                  onClick={() => handleSort('instanceId')}
                >
                  Instance ID
                  <SortIndicator column="instanceId" />
                </button>
                <button
                  className="flex w-24 items-center justify-center hover:text-foreground transition-colors"
                  onClick={() => handleSort('status')}
                >
                  Status
                  <SortIndicator column="status" />
                </button>
                <button
                  className="flex w-28 items-center justify-center hover:text-foreground transition-colors"
                  onClick={() => handleSort('executionTime')}
                >
                  Time
                  <SortIndicator column="executionTime" />
                </button>
                <div className="w-48 text-center">Error</div>
              </div>

              {/* Table Body */}
              <div className="divide-y divide-border">
                {filteredResults.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                    No results match the current filter
                  </div>
                ) : (
                  filteredResults.map((result) => (
                    <ResultRow
                      key={result.instanceId}
                      result={result}
                      isSelected={selectedInstanceId === result.instanceId}
                      onSelect={() => selectInstance(result.instanceId)}
                    />
                  ))
                )}
              </div>
            </div>
          </ScrollArea>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

/**
 * Individual result row component
 */
interface ResultRowProps {
  result: SWEBenchInstanceResult;
  isSelected: boolean;
  onSelect: () => void;
}

function ResultRow({ result, isSelected, onSelect }: ResultRowProps) {
  const { instanceId, status, executionTimeSeconds, errorMessage } = result;

  return (
    <button
      className={cn(
        'flex w-full items-center px-4 py-3 text-left text-sm',
        'hover:bg-muted/50 transition-colors cursor-pointer',
        isSelected && 'bg-primary/5 border-l-2 border-l-primary'
      )}
      onClick={onSelect}
    >
      {/* Instance ID */}
      <div className="flex-1 min-w-0 pr-4">
        <code className="block truncate text-xs font-mono">{instanceId}</code>
      </div>

      {/* Status Badge */}
      <div className="w-24 flex justify-center">
        <StatusBadge status={status} />
      </div>

      {/* Execution Time */}
      <div className="w-28 text-center text-xs text-muted-foreground">
        {formatExecutionTime(executionTimeSeconds)}
      </div>

      {/* Error Message */}
      <div className="w-48 flex justify-center">
        {errorMessage ? (
          <ErrorTooltip message={errorMessage} />
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </div>
    </button>
  );
}

/**
 * Status badge for table rows
 */
function StatusBadge({ status }: { status: InstanceStatus }) {
  const getStatusConfig = () => {
    switch (status) {
      case 'pending':
        return {
          icon: Clock,
          variant: 'muted' as const,
        };
      case 'running':
        return {
          icon: Loader2,
          variant: 'info' as const,
          animate: true,
        };
      case 'success':
        return {
          icon: CheckCircle2,
          variant: 'success' as const,
        };
      case 'failed':
        return {
          icon: XCircle,
          variant: 'destructive' as const,
        };
      case 'error':
        return {
          icon: AlertCircle,
          variant: 'warning' as const,
        };
      case 'skipped':
        return {
          icon: SkipForward,
          variant: 'secondary' as const,
        };
      default:
        return {
          icon: Clock,
          variant: 'muted' as const,
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1 text-xs px-2 py-0.5">
      <Icon
        className={cn('h-3 w-3', config.animate && 'animate-spin')}
      />
      <span className="sr-only md:not-sr-only">{getStatusLabel(status)}</span>
    </Badge>
  );
}

/**
 * Error tooltip component
 */
function ErrorTooltip({ message }: { message: string }) {
  // Truncate message for display
  const displayMessage = message.length > 100 ? `${message.slice(0, 100)}...` : message;
  const fullMessage = message;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 transition-colors">
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
          <span className="truncate max-w-[150px]">{displayMessage}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[400px]">
        <p className="text-sm break-words whitespace-pre-wrap">{fullMessage}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Empty state component
 */
function EmptyState({ className }: { className?: string }) {
  return (
    <Card className={cn('w-full', className)}>
      <div className="flex h-64 flex-col items-center justify-center text-center p-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
          <FileSearch className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-foreground">No Results Yet</h3>
        <p className="max-w-md text-sm text-muted-foreground mb-6">
          Run a SWE-bench evaluation to see instance-level results here.
        </p>
        <div className="rounded-lg bg-muted p-4 text-left">
          <p className="text-xs text-muted-foreground mb-2">Start an evaluation:</p>
          <code className="text-xs text-foreground font-mono">
            python -m cli.swebench_eval --dataset princeton-nlp/SWE-bench_Lite --max-instances 10
          </code>
        </div>
      </div>
    </Card>
  );
}

export default SWEBenchResults;
