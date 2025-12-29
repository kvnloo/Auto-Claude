import { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  TrendingUp,
  FileCheck,
  TestTube2,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { BenchmarkResultsProps, InstanceResult } from './types';

/**
 * Colors for charts and status indicators
 */
const COLORS = {
  resolved: 'hsl(142, 76%, 36%)', // green-600
  unresolved: 'hsl(0, 84%, 60%)', // red-500
  error: 'hsl(38, 92%, 50%)', // amber-500
  passed: 'hsl(142, 76%, 36%)', // green-600
  failed: 'hsl(0, 84%, 60%)', // red-500
};

/**
 * ResultsView - Visualization component for SWE-bench benchmark results
 *
 * Displays:
 * - Resolve rate as primary metric gauge
 * - F2P/P2P test metrics
 * - Per-instance breakdown with filtering and search
 * - Charts for visual representation of results
 */
export function ResultsView({
  resolveRate,
  patchApplicationSuccess,
  testResults,
  instanceBreakdown,
}: BenchmarkResultsProps) {
  const [expandedInstances, setExpandedInstances] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'resolved' | 'unresolved' | 'error'>('all');

  // Calculate metrics
  const resolvedCount = instanceBreakdown.filter((i) => i.status === 'resolved').length;
  const unresolvedCount = instanceBreakdown.filter((i) => i.status === 'unresolved').length;
  const errorCount = instanceBreakdown.filter((i) => i.status === 'error').length;
  const totalInstances = instanceBreakdown.length;

  // Pie chart data for instance status distribution
  const statusDistributionData = useMemo(() => [
    { name: 'Resolved', value: resolvedCount, color: COLORS.resolved },
    { name: 'Unresolved', value: unresolvedCount, color: COLORS.unresolved },
    { name: 'Error', value: errorCount, color: COLORS.error },
  ].filter((d) => d.value > 0), [resolvedCount, unresolvedCount, errorCount]);

  // Pie chart data for test results
  const testResultsData = useMemo(() => [
    { name: 'Passed', value: testResults.passed, color: COLORS.passed },
    { name: 'Failed', value: testResults.failed, color: COLORS.failed },
  ].filter((d) => d.value > 0), [testResults.passed, testResults.failed]);

  // Bar chart data for F2P/P2P metrics
  const testMetricsData = useMemo(() => {
    // Calculate F2P (Fail-to-Pass) and P2P (Pass-to-Pass) from instance breakdown
    let f2pPassed = 0;
    let f2pFailed = 0;
    let p2pPassed = 0;
    let p2pFailed = 0;

    // These metrics would typically come from the backend
    // For now, approximate from test results
    const avgTestsPerInstance = totalInstances > 0 ? testResults.total / totalInstances : 0;
    const f2pRatio = resolvedCount / Math.max(totalInstances, 1);

    f2pPassed = Math.round(testResults.passed * f2pRatio);
    f2pFailed = Math.round(testResults.failed * f2pRatio);
    p2pPassed = testResults.passed - f2pPassed;
    p2pFailed = testResults.failed - f2pFailed;

    return [
      { name: 'Fail-to-Pass (F2P)', passed: f2pPassed, failed: f2pFailed },
      { name: 'Pass-to-Pass (P2P)', passed: p2pPassed, failed: p2pFailed },
    ];
  }, [testResults, resolvedCount, totalInstances]);

  // Filtered instances for the breakdown table
  const filteredInstances = useMemo(() => {
    return instanceBreakdown.filter((instance) => {
      const matchesSearch = searchQuery === '' ||
        instance.instanceId.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = statusFilter === 'all' || instance.status === statusFilter;
      return matchesSearch && matchesFilter;
    });
  }, [instanceBreakdown, searchQuery, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-sm font-medium leading-none">Benchmark Results</h3>
        <p className="text-sm text-muted-foreground">
          SWE-bench evaluation metrics and per-instance breakdown
        </p>
      </div>

      {/* Primary Metrics Cards */}
      <div className="grid grid-cols-3 gap-4">
        {/* Resolve Rate */}
        <MetricCard
          title="Resolve Rate"
          value={`${resolveRate.toFixed(1)}%`}
          icon={<TrendingUp className="h-4 w-4" />}
          description={`${resolvedCount} of ${totalInstances} instances resolved`}
          color="success"
          isHighlighted
        />

        {/* Patch Application Success */}
        <MetricCard
          title="Patch Success"
          value={`${patchApplicationSuccess.toFixed(1)}%`}
          icon={<FileCheck className="h-4 w-4" />}
          description="Patches applied successfully"
          color="info"
        />

        {/* Test Pass Rate */}
        <MetricCard
          title="Test Pass Rate"
          value={testResults.total > 0
            ? `${((testResults.passed / testResults.total) * 100).toFixed(1)}%`
            : 'N/A'}
          icon={<TestTube2 className="h-4 w-4" />}
          description={`${testResults.passed} of ${testResults.total} tests passed`}
          color="primary"
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-2 gap-4">
        {/* Instance Status Distribution Pie Chart */}
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <h4 className="mb-4 text-sm font-medium">Instance Status Distribution</h4>
          {statusDistributionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={statusDistributionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                  animationBegin={0}
                  animationDuration={800}
                >
                  {statusDistributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--muted))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number) => [`${value} instances`, '']}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span className="text-xs text-foreground">{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
              No data available
            </div>
          )}
        </div>

        {/* F2P/P2P Test Metrics Bar Chart */}
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <h4 className="mb-4 text-sm font-medium">Test Metrics (F2P / P2P)</h4>
          {testResults.total > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={testMetricsData}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 90, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={85}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--muted))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                />
                <Bar
                  dataKey="passed"
                  fill={COLORS.passed}
                  name="Passed"
                  stackId="stack"
                  radius={[0, 4, 4, 0]}
                  animationBegin={0}
                  animationDuration={800}
                />
                <Bar
                  dataKey="failed"
                  fill={COLORS.failed}
                  name="Failed"
                  stackId="stack"
                  radius={[0, 4, 4, 0]}
                  animationBegin={0}
                  animationDuration={800}
                />
                <Legend
                  verticalAlign="top"
                  height={30}
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span className="text-xs text-foreground">{value}</span>
                  )}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
              No test data available
            </div>
          )}
        </div>
      </div>

      {/* Test Results Summary */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <h4 className="mb-4 text-sm font-medium">Test Results Summary</h4>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{testResults.total}</div>
            <div className="text-xs text-muted-foreground">Total Tests</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-success">{testResults.passed}</div>
            <div className="text-xs text-muted-foreground">Passed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-destructive">{testResults.failed}</div>
            <div className="text-xs text-muted-foreground">Failed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">
              {testResults.total > 0
                ? `${((testResults.passed / testResults.total) * 100).toFixed(1)}%`
                : '0%'}
            </div>
            <div className="text-xs text-muted-foreground">Pass Rate</div>
          </div>
        </div>
      </div>

      {/* Instance Breakdown Section */}
      <div className="rounded-lg border border-border bg-muted/30">
        {/* Section Header */}
        <button
          onClick={() => setExpandedInstances(!expandedInstances)}
          className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
        >
          <div className="space-y-1">
            <h4 className="text-sm font-medium">Per-Instance Breakdown</h4>
            <p className="text-xs text-muted-foreground">
              {totalInstances} instances evaluated
            </p>
          </div>
          <motion.div
            animate={{ rotate: expandedInstances ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          </motion.div>
        </button>

        <AnimatePresence>
          {expandedInstances && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="border-t border-border p-4 space-y-4">
                {/* Filters */}
                <div className="flex items-center gap-4">
                  {/* Search */}
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search by instance ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={cn(
                        'w-full rounded-md border border-border bg-background py-2 pl-10 pr-4',
                        'text-sm text-foreground placeholder:text-muted-foreground',
                        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
                      )}
                    />
                  </div>

                  {/* Status Filter */}
                  <div className="flex items-center gap-2">
                    {(['all', 'resolved', 'unresolved', 'error'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setStatusFilter(filter)}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                          statusFilter === filter
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        )}
                      >
                        {filter.charAt(0).toUpperCase() + filter.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Instance List */}
                <div className="max-h-[400px] overflow-y-auto rounded-md border border-border">
                  {filteredInstances.length > 0 ? (
                    <table className="w-full">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                            Instance ID
                          </th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">
                            Status
                          </th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">
                            Patch Applied
                          </th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">
                            Tests Passed
                          </th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">
                            Tests Failed
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {filteredInstances.map((instance, index) => (
                          <InstanceRow key={instance.instanceId} instance={instance} index={index} />
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                      {searchQuery || statusFilter !== 'all'
                        ? 'No instances match your filters'
                        : 'No instances to display'}
                    </div>
                  )}
                </div>

                {/* Summary */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Showing {filteredInstances.length} of {totalInstances} instances
                  </span>
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-success" />
                      Resolved: {resolvedCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-destructive" />
                      Unresolved: {unresolvedCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      Error: {errorCount}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * Metric card component for displaying key metrics
 */
function MetricCard({
  title,
  value,
  icon,
  description,
  color,
  isHighlighted = false,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  description: string;
  color: 'success' | 'info' | 'primary' | 'destructive';
  isHighlighted?: boolean;
}) {
  const colorClasses = {
    success: 'text-success',
    info: 'text-info',
    primary: 'text-primary',
    destructive: 'text-destructive',
  };

  const bgClasses = {
    success: 'bg-success/10',
    info: 'bg-info/10',
    primary: 'bg-primary/10',
    destructive: 'bg-destructive/10',
  };

  return (
    <motion.div
      className={cn(
        'rounded-lg border border-border p-4',
        isHighlighted ? bgClasses[color] : 'bg-muted/30'
      )}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-2">
        <div className={cn('rounded-full p-1.5', bgClasses[color])}>
          <div className={colorClasses[color]}>{icon}</div>
        </div>
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
      </div>
      <div className={cn('mt-2 text-3xl font-bold', colorClasses[color])}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{description}</div>
    </motion.div>
  );
}

/**
 * Instance row component for the breakdown table
 */
function InstanceRow({ instance, index }: { instance: InstanceResult; index: number }) {
  const statusConfig = {
    resolved: {
      icon: <CheckCircle2 className="h-4 w-4" />,
      color: 'text-success',
      bg: 'bg-success/20',
      label: 'Resolved',
    },
    unresolved: {
      icon: <XCircle className="h-4 w-4" />,
      color: 'text-destructive',
      bg: 'bg-destructive/20',
      label: 'Unresolved',
    },
    error: {
      icon: <AlertCircle className="h-4 w-4" />,
      color: 'text-amber-500',
      bg: 'bg-amber-500/20',
      label: 'Error',
    },
  };

  const config = statusConfig[instance.status];

  return (
    <motion.tr
      className="hover:bg-muted/30 transition-colors"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, delay: Math.min(index * 0.02, 0.5) }}
    >
      <td className="px-4 py-2">
        <span className="font-mono text-xs text-foreground" title={instance.instanceId}>
          {instance.instanceId.length > 40
            ? `${instance.instanceId.substring(0, 40)}...`
            : instance.instanceId}
        </span>
      </td>
      <td className="px-4 py-2">
        <div className="flex justify-center">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              config.bg,
              config.color
            )}
          >
            {config.icon}
            {config.label}
          </span>
        </div>
      </td>
      <td className="px-4 py-2 text-center">
        {instance.patchApplied ? (
          <CheckCircle2 className="mx-auto h-4 w-4 text-success" />
        ) : (
          <XCircle className="mx-auto h-4 w-4 text-destructive" />
        )}
      </td>
      <td className="px-4 py-2 text-center">
        <span className="text-sm font-medium text-success">{instance.testsPassed}</span>
      </td>
      <td className="px-4 py-2 text-center">
        <span className="text-sm font-medium text-destructive">{instance.testsFailed}</span>
      </td>
    </motion.tr>
  );
}
