import { useState, useEffect, useCallback } from 'react';
import { ListChecks, Activity, BarChart3, Play, StopCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import {
  useBenchmarkStore,
  checkInfrastructureHealth,
  startBenchmark,
  cancelBenchmark,
  getVariantInfo,
} from '../../stores/benchmarkStore';
import { VariantSelector } from './VariantSelector';
import { ConfigPanel } from './ConfigPanel';
import { ExecutionMonitor } from './ExecutionMonitor';
import { ResultsView } from './ResultsView';
import type { BenchmarkProps } from './types';
import { cn } from '../../lib/utils';

/**
 * Tab configuration for the benchmark dashboard
 */
type BenchmarkTab = 'selection' | 'monitor' | 'results';

/**
 * BenchmarkDashboard - Main dashboard for SWE-bench benchmark evaluation
 *
 * Provides a tabbed interface for:
 * - Selection: Choose benchmark variant and configure execution settings
 * - Monitor: Real-time progress tracking during benchmark execution
 * - Results: Visualization of benchmark results and metrics
 */
export function BenchmarkDashboard({ projectId }: BenchmarkProps) {
  const [activeTab, setActiveTab] = useState<BenchmarkTab>('selection');

  // Store state
  const {
    selectedVariant,
    setSelectedVariant,
    config,
    setMaxWorkers,
    setInstanceCount,
    setConfig,
    status,
    progress,
    error,
    results,
    infrastructure,
    healthCheckLoading,
    isRunning,
    canStart,
  } = useBenchmarkStore();

  // Check infrastructure health on mount
  useEffect(() => {
    checkInfrastructureHealth();
  }, []);

  // Auto-switch to monitor tab when execution starts
  useEffect(() => {
    if (status === 'running') {
      setActiveTab('monitor');
    } else if (status === 'completed' && results) {
      setActiveTab('results');
    }
  }, [status, results]);

  // Handle start benchmark
  const handleStart = useCallback(async () => {
    await startBenchmark(projectId);
  }, [projectId]);

  // Handle cancel benchmark
  const handleCancel = useCallback(async () => {
    await cancelBenchmark();
  }, []);

  // Get variant info for max instance count
  const variantInfo = getVariantInfo(selectedVariant);

  // Determine if tabs should be disabled
  const isExecutionActive = isRunning();
  const selectionDisabled = isExecutionActive;
  const monitorDisabled = status === 'idle' && !progress.startTime;
  const resultsDisabled = !results;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as BenchmarkTab)}
        className="flex flex-col h-full"
      >
        {/* Tab Header */}
        <div className="border-b border-border px-6 py-3">
          <div className="flex items-center justify-between">
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger
                value="selection"
                className="gap-2"
                disabled={selectionDisabled}
              >
                <ListChecks className="h-4 w-4" />
                Selection
              </TabsTrigger>
              <TabsTrigger
                value="monitor"
                className="gap-2"
                disabled={monitorDisabled}
              >
                <Activity className="h-4 w-4" />
                Monitor
              </TabsTrigger>
              <TabsTrigger
                value="results"
                className="gap-2"
                disabled={resultsDisabled}
              >
                <BarChart3 className="h-4 w-4" />
                Results
              </TabsTrigger>
            </TabsList>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {status === 'idle' && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => checkInfrastructureHealth()}
                    disabled={healthCheckLoading}
                    className="gap-2"
                  >
                    <RefreshCw
                      className={cn(
                        'h-4 w-4',
                        healthCheckLoading && 'animate-spin'
                      )}
                    />
                    Check Infrastructure
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleStart}
                    disabled={!canStart() || healthCheckLoading}
                    className="gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Start Benchmark
                  </Button>
                </>
              )}
              {isExecutionActive && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancel}
                  className="gap-2"
                >
                  <StopCircle className="h-4 w-4" />
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Infrastructure Warning */}
        {infrastructure && !infrastructure.dockerAvailable && (
          <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">
                Docker is not available
              </p>
              <p className="text-sm text-muted-foreground">
                Please start Docker to run SWE-bench evaluations.
              </p>
            </div>
          </div>
        )}

        {/* Disk Space Warning */}
        {infrastructure && !infrastructure.diskSpaceOk && (
          <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-600">
                Low disk space
              </p>
              <p className="text-sm text-muted-foreground">
                Only {infrastructure.diskSpaceGb.toFixed(1)} GB available. At
                least 10 GB is recommended for SWE-bench evaluations.
              </p>
            </div>
          </div>
        )}

        {/* ARM Architecture Warning */}
        {infrastructure?.armWarning && (
          <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-600">
                ARM Architecture Detected
              </p>
              <p className="text-sm text-muted-foreground">
                {infrastructure.armWarning}
              </p>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Error</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
        )}

        {/* Selection Tab */}
        <TabsContent value="selection" className="flex-1 overflow-auto m-0 p-6">
          <div className="space-y-8 max-w-2xl">
            <VariantSelector
              selectedVariant={selectedVariant}
              onVariantChange={setSelectedVariant}
              disabled={isExecutionActive}
            />
            <ConfigPanel
              maxWorkers={config.maxWorkers}
              instanceCount={config.instanceCount}
              cacheLevel={config.cacheLevel}
              onMaxWorkersChange={setMaxWorkers}
              onInstanceCountChange={setInstanceCount}
              onCacheLevelChange={(value) => setConfig({ cacheLevel: value })}
              disabled={isExecutionActive}
              recommendedMaxWorkers={infrastructure?.recommendedMaxWorkers}
              maxInstanceCount={variantInfo.instanceCount}
            />

            {/* Infrastructure Status */}
            {infrastructure && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <h4 className="text-sm font-medium">Infrastructure Status</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Docker</span>
                    <span
                      className={
                        infrastructure.dockerAvailable
                          ? 'text-success'
                          : 'text-destructive'
                      }
                    >
                      {infrastructure.dockerAvailable
                        ? 'Available'
                        : 'Not Available'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Disk Space</span>
                    <span
                      className={
                        infrastructure.diskSpaceOk
                          ? 'text-success'
                          : 'text-amber-500'
                      }
                    >
                      {infrastructure.diskSpaceGb.toFixed(1)} GB
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">CPU Cores</span>
                    <span className="text-foreground">
                      {infrastructure.cpuCores}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Recommended Workers
                    </span>
                    <span className="text-foreground">
                      {infrastructure.recommendedMaxWorkers}
                    </span>
                  </div>
                  {infrastructure.isArm && (
                    <div className="col-span-2 flex items-center justify-between">
                      <span className="text-muted-foreground">Architecture</span>
                      <span className="text-amber-500">ARM (Apple Silicon)</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Monitor Tab */}
        <TabsContent value="monitor" className="flex-1 overflow-auto m-0 p-6">
          <div className="max-w-2xl">
            <ExecutionMonitor
              status={status}
              currentInstance={progress.currentInstance}
              progress={progress.completedInstances}
              totalInstances={progress.totalInstances}
              elapsedTime={progress.elapsedTime}
              estimatedRemaining={progress.estimatedRemaining}
            />
          </div>
        </TabsContent>

        {/* Results Tab */}
        <TabsContent value="results" className="flex-1 overflow-auto m-0 p-6">
          {results ? (
            <ResultsView
              resolveRate={results.resolveRate}
              patchApplicationSuccess={results.patchApplicationSuccess}
              testResults={results.testResults}
              instanceBreakdown={results.instanceBreakdown}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No results available. Run a benchmark to see results.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
