import { create } from 'zustand';
import type {
  BenchmarkVariant,
  BenchmarkStatus,
  InstanceResult
} from '../components/benchmark/types';

/**
 * Benchmark configuration options
 */
export interface BenchmarkConfig {
  maxWorkers: number;
  instanceCount: number;
  cacheLevel: 'none' | 'base' | 'env' | 'instance';
}

/**
 * Benchmark execution progress
 */
export interface BenchmarkProgress {
  currentInstance: string | null;
  completedInstances: number;
  totalInstances: number;
  startTime: number | null;
  elapsedTime: number;
  estimatedRemaining: number | null;
}

/**
 * Benchmark results data
 */
export interface BenchmarkResults {
  resolveRate: number;
  patchApplicationSuccess: number;
  testResults: {
    passed: number;
    failed: number;
    total: number;
  };
  instanceBreakdown: InstanceResult[];
  runId: string | null;
  completedAt: number | null;
}

/**
 * Infrastructure health check status
 */
export interface InfrastructureHealth {
  dockerAvailable: boolean;
  diskSpaceOk: boolean;
  diskSpaceGb: number;
  cpuCores: number;
  recommendedMaxWorkers: number;
  isArm: boolean;
  armWarning: string | null;
  lastChecked: number | null;
}

/**
 * Benchmark store state interface
 */
interface BenchmarkState {
  // Selection
  selectedVariant: BenchmarkVariant;

  // Configuration
  config: BenchmarkConfig;

  // Execution state
  status: BenchmarkStatus;
  progress: BenchmarkProgress;
  error: string | null;

  // Results
  results: BenchmarkResults | null;

  // Infrastructure health
  infrastructure: InfrastructureHealth | null;
  healthCheckLoading: boolean;

  // Actions - Selection
  setSelectedVariant: (variant: BenchmarkVariant) => void;

  // Actions - Configuration
  setConfig: (config: Partial<BenchmarkConfig>) => void;
  setMaxWorkers: (maxWorkers: number) => void;
  setInstanceCount: (instanceCount: number) => void;

  // Actions - Execution
  setStatus: (status: BenchmarkStatus) => void;
  setProgress: (progress: Partial<BenchmarkProgress>) => void;
  setError: (error: string | null) => void;

  // Actions - Results
  setResults: (results: BenchmarkResults | null) => void;
  addInstanceResult: (result: InstanceResult) => void;

  // Actions - Infrastructure
  setInfrastructure: (health: InfrastructureHealth | null) => void;
  setHealthCheckLoading: (loading: boolean) => void;

  // Actions - Lifecycle
  startExecution: () => void;
  completeExecution: (results: BenchmarkResults) => void;
  failExecution: (error: string) => void;
  cancelExecution: () => void;
  reset: () => void;

  // Selectors
  getProgressPercentage: () => number;
  isRunning: () => boolean;
  canStart: () => boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: BenchmarkConfig = {
  maxWorkers: 1,
  instanceCount: 10,
  cacheLevel: 'env'
};

/**
 * Default progress values
 */
const DEFAULT_PROGRESS: BenchmarkProgress = {
  currentInstance: null,
  completedInstances: 0,
  totalInstances: 0,
  startTime: null,
  elapsedTime: 0,
  estimatedRemaining: null
};

/**
 * Zustand store for SWE-bench benchmark state management
 */
export const useBenchmarkStore = create<BenchmarkState>((set, get) => ({
  // Initial state - Selection
  selectedVariant: 'lite',

  // Initial state - Configuration
  config: { ...DEFAULT_CONFIG },

  // Initial state - Execution
  status: 'idle',
  progress: { ...DEFAULT_PROGRESS },
  error: null,

  // Initial state - Results
  results: null,

  // Initial state - Infrastructure
  infrastructure: null,
  healthCheckLoading: false,

  // Actions - Selection
  setSelectedVariant: (variant) => set({ selectedVariant: variant }),

  // Actions - Configuration
  setConfig: (config) =>
    set((state) => ({
      config: { ...state.config, ...config }
    })),

  setMaxWorkers: (maxWorkers) =>
    set((state) => ({
      config: { ...state.config, maxWorkers }
    })),

  setInstanceCount: (instanceCount) =>
    set((state) => ({
      config: { ...state.config, instanceCount }
    })),

  // Actions - Execution
  setStatus: (status) => set({ status }),

  setProgress: (progress) =>
    set((state) => ({
      progress: { ...state.progress, ...progress }
    })),

  setError: (error) => set({ error }),

  // Actions - Results
  setResults: (results) => set({ results }),

  addInstanceResult: (result) =>
    set((state) => {
      if (!state.results) return state;

      const existingIndex = state.results.instanceBreakdown.findIndex(
        (r) => r.instanceId === result.instanceId
      );

      const instanceBreakdown =
        existingIndex >= 0
          ? state.results.instanceBreakdown.map((r, i) =>
              i === existingIndex ? result : r
            )
          : [...state.results.instanceBreakdown, result];

      return {
        results: {
          ...state.results,
          instanceBreakdown
        }
      };
    }),

  // Actions - Infrastructure
  setInfrastructure: (health) => set({ infrastructure: health }),
  setHealthCheckLoading: (loading) => set({ healthCheckLoading: loading }),

  // Actions - Lifecycle
  startExecution: () =>
    set((state) => ({
      status: 'running',
      error: null,
      progress: {
        ...DEFAULT_PROGRESS,
        totalInstances: state.config.instanceCount,
        startTime: Date.now()
      },
      results: {
        resolveRate: 0,
        patchApplicationSuccess: 0,
        testResults: { passed: 0, failed: 0, total: 0 },
        instanceBreakdown: [],
        runId: null,
        completedAt: null
      }
    })),

  completeExecution: (results) =>
    set({
      status: 'completed',
      results: {
        ...results,
        completedAt: Date.now()
      },
      progress: {
        ...get().progress,
        currentInstance: null
      }
    }),

  failExecution: (error) =>
    set({
      status: 'failed',
      error,
      progress: {
        ...get().progress,
        currentInstance: null
      }
    }),

  cancelExecution: () =>
    set({
      status: 'idle',
      error: null,
      progress: {
        ...get().progress,
        currentInstance: null
      }
    }),

  reset: () =>
    set({
      selectedVariant: 'lite',
      config: { ...DEFAULT_CONFIG },
      status: 'idle',
      progress: { ...DEFAULT_PROGRESS },
      error: null,
      results: null
    }),

  // Selectors
  getProgressPercentage: () => {
    const state = get();
    if (state.progress.totalInstances === 0) return 0;
    return Math.round(
      (state.progress.completedInstances / state.progress.totalInstances) * 100
    );
  },

  isRunning: () => {
    const state = get();
    return state.status === 'running' || state.status === 'loading';
  },

  canStart: () => {
    const state = get();
    return (
      state.status === 'idle' &&
      state.infrastructure !== null &&
      state.infrastructure.dockerAvailable &&
      state.infrastructure.diskSpaceOk
    );
  }
}));

/**
 * Check infrastructure health before starting benchmark
 */
export async function checkInfrastructureHealth(): Promise<void> {
  const store = useBenchmarkStore.getState();
  store.setHealthCheckLoading(true);
  store.setError(null);

  try {
    const result = await window.electronAPI.checkBenchmarkInfrastructure();
    if (result.success && result.data) {
      store.setInfrastructure({
        dockerAvailable: result.data.dockerAvailable,
        diskSpaceOk: result.data.diskSpaceOk,
        diskSpaceGb: result.data.diskSpaceGb,
        cpuCores: result.data.cpuCores,
        recommendedMaxWorkers: result.data.recommendedMaxWorkers,
        isArm: result.data.isArm,
        armWarning: result.data.armWarning,
        lastChecked: Date.now()
      });

      // Update max workers to recommended if higher
      if (store.config.maxWorkers > result.data.recommendedMaxWorkers) {
        store.setMaxWorkers(result.data.recommendedMaxWorkers);
      }
    } else {
      store.setError(result.error || 'Failed to check infrastructure');
    }
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    store.setHealthCheckLoading(false);
  }
}

/**
 * Start benchmark execution
 */
export async function startBenchmark(projectId: string): Promise<void> {
  const store = useBenchmarkStore.getState();

  if (!store.canStart()) {
    store.setError('Cannot start benchmark: infrastructure requirements not met');
    return;
  }

  store.startExecution();

  try {
    const result = await window.electronAPI.startBenchmark(projectId, {
      variant: store.selectedVariant,
      maxWorkers: store.config.maxWorkers,
      instanceCount: store.config.instanceCount,
      cacheLevel: store.config.cacheLevel
    });

    if (!result.success) {
      store.failExecution(result.error || 'Failed to start benchmark');
    }
    // Progress updates will come through IPC events
  } catch (error) {
    store.failExecution(error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Cancel running benchmark
 */
export async function cancelBenchmark(): Promise<void> {
  const store = useBenchmarkStore.getState();

  if (!store.isRunning()) {
    return;
  }

  try {
    await window.electronAPI.cancelBenchmark();
    store.cancelExecution();
  } catch (error) {
    store.setError(error instanceof Error ? error.message : 'Failed to cancel benchmark');
  }
}

/**
 * Update progress from IPC event
 */
export function updateProgressFromEvent(data: {
  currentInstance: string;
  completedInstances: number;
  totalInstances: number;
  instanceResult?: InstanceResult;
}): void {
  const store = useBenchmarkStore.getState();

  const elapsedTime = store.progress.startTime
    ? Date.now() - store.progress.startTime
    : 0;

  const estimatedRemaining =
    data.completedInstances > 0
      ? (elapsedTime / data.completedInstances) *
        (data.totalInstances - data.completedInstances)
      : null;

  store.setProgress({
    currentInstance: data.currentInstance,
    completedInstances: data.completedInstances,
    totalInstances: data.totalInstances,
    elapsedTime,
    estimatedRemaining
  });

  if (data.instanceResult) {
    store.addInstanceResult(data.instanceResult);
  }
}

/**
 * Handle benchmark completion event
 */
export function handleBenchmarkComplete(results: BenchmarkResults): void {
  const store = useBenchmarkStore.getState();
  store.completeExecution(results);
}

/**
 * Handle benchmark error event
 */
export function handleBenchmarkError(error: string): void {
  const store = useBenchmarkStore.getState();
  store.failExecution(error);
}

/**
 * Get variant display information
 */
export function getVariantInfo(variant: BenchmarkVariant): {
  name: string;
  description: string;
  instanceCount: number;
} {
  const variants: Record<BenchmarkVariant, { name: string; description: string; instanceCount: number }> = {
    lite: {
      name: 'SWE-bench Lite',
      description: 'Curated subset of 300 instances for faster evaluation',
      instanceCount: 300
    },
    verified: {
      name: 'SWE-bench Verified',
      description: 'Human-verified subset with high-quality instances',
      instanceCount: 500
    },
    full: {
      name: 'SWE-bench Full',
      description: 'Complete benchmark with 2,294 instances',
      instanceCount: 2294
    },
    multimodal: {
      name: 'SWE-bench Multimodal',
      description: 'Includes visual/image-based issues',
      instanceCount: 617
    },
    multilingual: {
      name: 'SWE-bench Multilingual',
      description: 'Issues from repositories in multiple languages',
      instanceCount: 510
    }
  };

  return variants[variant];
}
