import { create } from 'zustand';

// =============================================================================
// SWE-bench Types
// =============================================================================

/**
 * Status of an individual SWE-bench instance evaluation
 */
export type InstanceStatus = 'pending' | 'running' | 'success' | 'failed' | 'error' | 'skipped';

/**
 * Overall status of an evaluation run
 */
export type EvaluationStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

/**
 * A single SWE-bench instance result
 */
export interface SWEBenchInstanceResult {
  instanceId: string;
  status: InstanceStatus;
  modelPatch: string | null;
  errorMessage: string | null;
  executionTimeSeconds: number | null;
  testsPassed: number | null;
  testsTotal: number | null;
  regressionTestsPassed: number | null;
  regressionTestsTotal: number | null;
}

/**
 * Aggregated metrics for a benchmark evaluation run
 */
export interface EvaluationMetrics {
  totalInstances: number;
  completedInstances: number;
  successfulInstances: number;
  failedInstances: number;
  errorInstances: number;
  skippedInstances: number;
  resolutionRate: number;
  totalExecutionTimeSeconds: number;
  averageExecutionTimeSeconds: number;
}

/**
 * Progress information for real-time updates
 */
export interface EvaluationProgress {
  currentInstanceId: string | null;
  currentInstanceIndex: number;
  totalInstances: number;
  elapsedTimeSeconds: number;
  estimatedRemainingSeconds: number | null;
  instancesPerHour: number | null;
}

/**
 * Configuration for an evaluation run
 */
export interface EvaluationConfig {
  runId: string;
  dataset: string;
  maxInstances: number | null;
  maxWorkers: number;
  timeout: number;
  model: string;
}

/**
 * A complete evaluation run with all data
 */
export interface EvaluationRun {
  runId: string;
  dataset: string;
  status: EvaluationStatus;
  config: EvaluationConfig;
  metrics: EvaluationMetrics;
  progress: EvaluationProgress;
  results: SWEBenchInstanceResult[];
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

// =============================================================================
// Store Interface
// =============================================================================

interface SWEBenchState {
  // Current evaluation run
  currentRun: EvaluationRun | null;

  // Historical runs (for listing/comparison)
  runs: EvaluationRun[];

  // UI state
  selectedRunId: string | null;
  selectedInstanceId: string | null;
  isLoading: boolean;
  error: string | null;

  // Filter/sort state for results table
  statusFilter: InstanceStatus | 'all';
  sortBy: 'instanceId' | 'status' | 'executionTime';
  sortOrder: 'asc' | 'desc';

  // Actions
  setCurrentRun: (run: EvaluationRun | null) => void;
  updateCurrentRun: (updates: Partial<EvaluationRun>) => void;
  updateProgress: (progress: Partial<EvaluationProgress>) => void;
  updateMetrics: (metrics: Partial<EvaluationMetrics>) => void;
  addInstanceResult: (result: SWEBenchInstanceResult) => void;
  updateInstanceResult: (instanceId: string, updates: Partial<SWEBenchInstanceResult>) => void;
  setRuns: (runs: EvaluationRun[]) => void;
  addRun: (run: EvaluationRun) => void;
  selectRun: (runId: string | null) => void;
  selectInstance: (instanceId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setStatusFilter: (filter: InstanceStatus | 'all') => void;
  setSortBy: (sortBy: 'instanceId' | 'status' | 'executionTime') => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  clearCurrentRun: () => void;
  reset: () => void;

  // Selectors
  getSelectedRun: () => EvaluationRun | undefined;
  getSelectedInstance: () => SWEBenchInstanceResult | undefined;
  getFilteredResults: () => SWEBenchInstanceResult[];
  getProgressPercentage: () => number;
  getSuccessRate: () => number;
}

// =============================================================================
// Initial State
// =============================================================================

const createInitialMetrics = (): EvaluationMetrics => ({
  totalInstances: 0,
  completedInstances: 0,
  successfulInstances: 0,
  failedInstances: 0,
  errorInstances: 0,
  skippedInstances: 0,
  resolutionRate: 0,
  totalExecutionTimeSeconds: 0,
  averageExecutionTimeSeconds: 0,
});

const createInitialProgress = (): EvaluationProgress => ({
  currentInstanceId: null,
  currentInstanceIndex: 0,
  totalInstances: 0,
  elapsedTimeSeconds: 0,
  estimatedRemainingSeconds: null,
  instancesPerHour: null,
});

// =============================================================================
// Store Implementation
// =============================================================================

export const useSWEBenchStore = create<SWEBenchState>((set, get) => ({
  // Initial state
  currentRun: null,
  runs: [],
  selectedRunId: null,
  selectedInstanceId: null,
  isLoading: false,
  error: null,
  statusFilter: 'all',
  sortBy: 'instanceId',
  sortOrder: 'asc',

  // Actions
  setCurrentRun: (run) => set({ currentRun: run }),

  updateCurrentRun: (updates) =>
    set((state) => ({
      currentRun: state.currentRun
        ? { ...state.currentRun, ...updates }
        : null,
    })),

  updateProgress: (progress) =>
    set((state) => ({
      currentRun: state.currentRun
        ? {
            ...state.currentRun,
            progress: { ...state.currentRun.progress, ...progress },
          }
        : null,
    })),

  updateMetrics: (metrics) =>
    set((state) => ({
      currentRun: state.currentRun
        ? {
            ...state.currentRun,
            metrics: { ...state.currentRun.metrics, ...metrics },
          }
        : null,
    })),

  addInstanceResult: (result) =>
    set((state) => {
      if (!state.currentRun) return state;

      // Check if result already exists (update) or is new (add)
      const existingIndex = state.currentRun.results.findIndex(
        (r) => r.instanceId === result.instanceId
      );

      const newResults =
        existingIndex >= 0
          ? state.currentRun.results.map((r, i) =>
              i === existingIndex ? result : r
            )
          : [...state.currentRun.results, result];

      return {
        currentRun: {
          ...state.currentRun,
          results: newResults,
        },
      };
    }),

  updateInstanceResult: (instanceId, updates) =>
    set((state) => {
      if (!state.currentRun) return state;

      return {
        currentRun: {
          ...state.currentRun,
          results: state.currentRun.results.map((r) =>
            r.instanceId === instanceId ? { ...r, ...updates } : r
          ),
        },
      };
    }),

  setRuns: (runs) => set({ runs }),

  addRun: (run) =>
    set((state) => ({
      runs: [...state.runs, run],
    })),

  selectRun: (runId) => set({ selectedRunId: runId }),

  selectInstance: (instanceId) => set({ selectedInstanceId: instanceId }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  setStatusFilter: (statusFilter) => set({ statusFilter }),

  setSortBy: (sortBy) => set({ sortBy }),

  setSortOrder: (sortOrder) => set({ sortOrder }),

  clearCurrentRun: () => set({ currentRun: null }),

  reset: () =>
    set({
      currentRun: null,
      runs: [],
      selectedRunId: null,
      selectedInstanceId: null,
      isLoading: false,
      error: null,
      statusFilter: 'all',
      sortBy: 'instanceId',
      sortOrder: 'asc',
    }),

  // Selectors
  getSelectedRun: () => {
    const state = get();
    if (state.selectedRunId === state.currentRun?.runId) {
      return state.currentRun;
    }
    return state.runs.find((r) => r.runId === state.selectedRunId);
  },

  getSelectedInstance: () => {
    const state = get();
    const run = state.currentRun || state.runs.find((r) => r.runId === state.selectedRunId);
    if (!run || !state.selectedInstanceId) return undefined;
    return run.results.find((r) => r.instanceId === state.selectedInstanceId);
  },

  getFilteredResults: () => {
    const state = get();
    const run = state.currentRun || state.runs.find((r) => r.runId === state.selectedRunId);
    if (!run) return [];

    let results = [...run.results];

    // Apply status filter
    if (state.statusFilter !== 'all') {
      results = results.filter((r) => r.status === state.statusFilter);
    }

    // Apply sorting
    results.sort((a, b) => {
      let comparison = 0;

      switch (state.sortBy) {
        case 'instanceId':
          comparison = a.instanceId.localeCompare(b.instanceId);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'executionTime':
          comparison = (a.executionTimeSeconds ?? 0) - (b.executionTimeSeconds ?? 0);
          break;
      }

      return state.sortOrder === 'asc' ? comparison : -comparison;
    });

    return results;
  },

  getProgressPercentage: () => {
    const state = get();
    if (!state.currentRun) return 0;
    const { completedInstances, totalInstances } = state.currentRun.metrics;
    if (totalInstances === 0) return 0;
    return Math.round((completedInstances / totalInstances) * 100);
  },

  getSuccessRate: () => {
    const state = get();
    if (!state.currentRun) return 0;
    const { successfulInstances, completedInstances } = state.currentRun.metrics;
    if (completedInstances === 0) return 0;
    return Math.round((successfulInstances / completedInstances) * 100);
  },
}));

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new evaluation run with default values
 */
export function createEvaluationRun(
  runId: string,
  dataset: string,
  config: Partial<EvaluationConfig> = {}
): EvaluationRun {
  return {
    runId,
    dataset,
    status: 'idle',
    config: {
      runId,
      dataset,
      maxInstances: config.maxInstances ?? null,
      maxWorkers: config.maxWorkers ?? 1,
      timeout: config.timeout ?? 1800,
      model: config.model ?? 'autoclaude',
    },
    metrics: createInitialMetrics(),
    progress: createInitialProgress(),
    results: [],
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

/**
 * Start an evaluation run
 */
export function startEvaluation(runId: string, dataset: string, config: Partial<EvaluationConfig> = {}): void {
  const store = useSWEBenchStore.getState();
  const run = createEvaluationRun(runId, dataset, config);
  run.status = 'running';
  run.startedAt = new Date();
  store.setCurrentRun(run);
}

/**
 * Update evaluation with progress from backend
 */
export function updateEvaluationProgress(
  progress: Partial<EvaluationProgress>,
  metrics?: Partial<EvaluationMetrics>
): void {
  const store = useSWEBenchStore.getState();
  store.updateProgress(progress);
  if (metrics) {
    store.updateMetrics(metrics);
  }
}

/**
 * Add or update an instance result
 */
export function updateInstanceResult(result: SWEBenchInstanceResult): void {
  const store = useSWEBenchStore.getState();
  store.addInstanceResult(result);
}

/**
 * Complete the current evaluation run
 */
export function completeEvaluation(metrics?: Partial<EvaluationMetrics>, error?: string): void {
  const store = useSWEBenchStore.getState();

  if (metrics) {
    store.updateMetrics(metrics);
  }

  store.updateCurrentRun({
    status: error ? 'failed' : 'completed',
    completedAt: new Date(),
    error: error || null,
  });

  // Add completed run to history
  const currentRun = store.currentRun;
  if (currentRun) {
    store.addRun(currentRun);
  }
}

/**
 * Pause the current evaluation
 */
export function pauseEvaluation(): void {
  const store = useSWEBenchStore.getState();
  store.updateCurrentRun({ status: 'paused' });
}

/**
 * Resume a paused evaluation
 */
export function resumeEvaluation(): void {
  const store = useSWEBenchStore.getState();
  store.updateCurrentRun({ status: 'running' });
}

/**
 * Load evaluation runs from backend
 */
export async function loadEvaluationRuns(): Promise<void> {
  const store = useSWEBenchStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    // TODO: Implement IPC call to load runs from backend
    // For now, this is a placeholder
    // const result = await window.electronAPI.getSWEBenchRuns();
    // if (result.success && result.data) {
    //   store.setRuns(result.data);
    // }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to load evaluation runs');
  } finally {
    store.setLoading(false);
  }
}

/**
 * Load a specific evaluation run by ID
 */
export async function loadEvaluationRun(runId: string): Promise<EvaluationRun | null> {
  const store = useSWEBenchStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    // TODO: Implement IPC call to load run from backend
    // For now, check if it's in the local state
    const run = store.runs.find((r) => r.runId === runId);
    return run || null;
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to load evaluation run');
    return null;
  } finally {
    store.setLoading(false);
  }
}

/**
 * Format execution time for display
 */
export function formatExecutionTime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '-';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Get status display color
 */
export function getStatusColor(status: InstanceStatus): string {
  switch (status) {
    case 'pending':
      return 'text-gray-500';
    case 'running':
      return 'text-blue-500';
    case 'success':
      return 'text-green-500';
    case 'failed':
      return 'text-red-500';
    case 'error':
      return 'text-orange-500';
    case 'skipped':
      return 'text-gray-400';
    default:
      return 'text-gray-500';
  }
}

/**
 * Get status display label
 */
export function getStatusLabel(status: InstanceStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'running':
      return 'Running';
    case 'success':
      return 'Success';
    case 'failed':
      return 'Failed';
    case 'error':
      return 'Error';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Unknown';
  }
}
