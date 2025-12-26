/**
 * Claude Flow Store - Zustand state management for Claude Flow parallel agent orchestration
 *
 * Manages:
 * - Configuration state (agent count, topology mode)
 * - Execution metrics for parallel tasks
 * - Task execution progress
 * - Loading and error states
 *
 * Used by ConfigPanel and MetricsDisplay components.
 */
import { create } from 'zustand';

// ============================================
// Types
// ============================================

/** Valid agent count options */
export type AgentCount = 4 | 8 | 12;

/** Valid topology modes for parallel execution */
export type TopologyMode = 'distributed' | 'hierarchical' | 'mesh' | 'centralized';

/** Claude Flow configuration state */
export interface ClaudeFlowConfig {
  agentCount: AgentCount;
  topology: TopologyMode;
  /** Optional model override */
  model?: string;
  /** Maximum timeout in seconds */
  timeout?: number;
}

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

/** Individual agent result from parallel execution */
export interface AgentResult {
  agent_id: string;
  status: 'success' | 'failed' | 'timeout';
  output: string;
  error?: string;
  execution_time_seconds: number;
}

/** Parallel task result with aggregated data */
export interface ParallelTaskResult {
  task_id: string;
  config: ClaudeFlowConfig;
  metrics: ExecutionMetrics;
  agent_results: AgentResult[];
  aggregated_output: string;
  created_at: string;
}

/** Task execution progress state */
export interface TaskProgress {
  /** Task identifier */
  taskId: string;
  /** Current execution phase */
  phase: 'idle' | 'initializing' | 'executing' | 'aggregating' | 'completed' | 'failed';
  /** Progress percentage (0-100) */
  progress: number;
  /** Number of agents that have completed */
  agentsCompleted: number;
  /** Total number of agents */
  agentsTotal: number;
  /** Current status message */
  statusMessage: string;
  /** Error message if failed */
  error?: string;
}

// ============================================
// Default Values
// ============================================

/** Default configuration for Claude Flow */
export const DEFAULT_CLAUDE_FLOW_CONFIG: ClaudeFlowConfig = {
  agentCount: 8,
  topology: 'distributed',
  timeout: 300
};

/** Initial progress state */
const INITIAL_PROGRESS: TaskProgress = {
  taskId: '',
  phase: 'idle',
  progress: 0,
  agentsCompleted: 0,
  agentsTotal: 0,
  statusMessage: ''
};

// ============================================
// Store Interface
// ============================================

interface ClaudeFlowState {
  // Configuration
  config: ClaudeFlowConfig;
  configLoading: boolean;
  configError: string | null;
  configDirty: boolean;

  // Execution Metrics
  currentMetrics: ExecutionMetrics | null;
  metricsLoading: boolean;
  metricsError: string | null;

  // Task Progress
  currentProgress: TaskProgress;

  // Task History
  taskHistory: ParallelTaskResult[];
  historyLoading: boolean;

  // Server Status
  serverAvailable: boolean;
  serverChecking: boolean;

  // Configuration Actions
  setConfig: (config: ClaudeFlowConfig) => void;
  updateConfig: (updates: Partial<ClaudeFlowConfig>) => void;
  setAgentCount: (count: AgentCount) => void;
  setTopology: (topology: TopologyMode) => void;
  resetConfig: () => void;
  setConfigLoading: (loading: boolean) => void;
  setConfigError: (error: string | null) => void;
  setConfigDirty: (dirty: boolean) => void;

  // Metrics Actions
  setCurrentMetrics: (metrics: ExecutionMetrics | null) => void;
  setMetricsLoading: (loading: boolean) => void;
  setMetricsError: (error: string | null) => void;

  // Progress Actions
  setProgress: (progress: Partial<TaskProgress>) => void;
  updateProgress: (updates: Partial<TaskProgress>) => void;
  resetProgress: () => void;

  // History Actions
  setTaskHistory: (history: ParallelTaskResult[]) => void;
  addTaskResult: (result: ParallelTaskResult) => void;
  setHistoryLoading: (loading: boolean) => void;

  // Server Status Actions
  setServerAvailable: (available: boolean) => void;
  setServerChecking: (checking: boolean) => void;

  // Utility Actions
  clearAll: () => void;
}

// ============================================
// Store Implementation
// ============================================

export const useClaudeFlowStore = create<ClaudeFlowState>((set) => ({
  // Configuration
  config: DEFAULT_CLAUDE_FLOW_CONFIG,
  configLoading: false,
  configError: null,
  configDirty: false,

  // Execution Metrics
  currentMetrics: null,
  metricsLoading: false,
  metricsError: null,

  // Task Progress
  currentProgress: INITIAL_PROGRESS,

  // Task History
  taskHistory: [],
  historyLoading: false,

  // Server Status
  serverAvailable: false,
  serverChecking: false,

  // Configuration Actions
  setConfig: (config) => set({ config, configDirty: false }),

  updateConfig: (updates) =>
    set((state) => ({
      config: { ...state.config, ...updates },
      configDirty: true
    })),

  setAgentCount: (agentCount) =>
    set((state) => ({
      config: { ...state.config, agentCount },
      configDirty: true
    })),

  setTopology: (topology) =>
    set((state) => ({
      config: { ...state.config, topology },
      configDirty: true
    })),

  resetConfig: () =>
    set({
      config: DEFAULT_CLAUDE_FLOW_CONFIG,
      configDirty: false,
      configError: null
    }),

  setConfigLoading: (configLoading) => set({ configLoading }),

  setConfigError: (configError) => set({ configError }),

  setConfigDirty: (configDirty) => set({ configDirty }),

  // Metrics Actions
  setCurrentMetrics: (currentMetrics) => set({ currentMetrics }),

  setMetricsLoading: (metricsLoading) => set({ metricsLoading }),

  setMetricsError: (metricsError) => set({ metricsError }),

  // Progress Actions
  setProgress: (progress) =>
    set({
      currentProgress: { ...INITIAL_PROGRESS, ...progress }
    }),

  updateProgress: (updates) =>
    set((state) => ({
      currentProgress: { ...state.currentProgress, ...updates }
    })),

  resetProgress: () => set({ currentProgress: INITIAL_PROGRESS }),

  // History Actions
  setTaskHistory: (taskHistory) => set({ taskHistory }),

  addTaskResult: (result) =>
    set((state) => ({
      taskHistory: [result, ...state.taskHistory].slice(0, 100) // Keep last 100 results
    })),

  setHistoryLoading: (historyLoading) => set({ historyLoading }),

  // Server Status Actions
  setServerAvailable: (serverAvailable) => set({ serverAvailable }),

  setServerChecking: (serverChecking) => set({ serverChecking }),

  // Utility Actions
  clearAll: () =>
    set({
      config: DEFAULT_CLAUDE_FLOW_CONFIG,
      configLoading: false,
      configError: null,
      configDirty: false,
      currentMetrics: null,
      metricsLoading: false,
      metricsError: null,
      currentProgress: INITIAL_PROGRESS,
      taskHistory: [],
      historyLoading: false,
      serverAvailable: false,
      serverChecking: false
    })
}));

// ============================================
// Async Actions (Outside Store)
// ============================================

/**
 * Load Claude Flow configuration from backend/storage
 */
export async function loadClaudeFlowConfig(): Promise<void> {
  const store = useClaudeFlowStore.getState();
  store.setConfigLoading(true);
  store.setConfigError(null);

  try {
    // Check if electronAPI is available (running in Electron)
    if (typeof window !== 'undefined' && window.electronAPI?.getClaudeFlowConfig) {
      const result = await window.electronAPI.getClaudeFlowConfig();
      if (result.success && result.data) {
        store.setConfig(result.data);
      }
    } else {
      // In non-Electron environment, load from localStorage
      const stored = localStorage.getItem('claude-flow-config');
      if (stored) {
        const config = JSON.parse(stored) as ClaudeFlowConfig;
        // Validate config values
        if (isValidConfig(config)) {
          store.setConfig(config);
        }
      }
    }
  } catch (error) {
    store.setConfigError(
      error instanceof Error ? error.message : 'Failed to load configuration'
    );
  } finally {
    store.setConfigLoading(false);
  }
}

/**
 * Save Claude Flow configuration to backend/storage
 */
export async function saveClaudeFlowConfig(
  config?: ClaudeFlowConfig
): Promise<boolean> {
  const store = useClaudeFlowStore.getState();
  const configToSave = config || store.config;

  store.setConfigLoading(true);
  store.setConfigError(null);

  try {
    // Validate config before saving
    if (!isValidConfig(configToSave)) {
      throw new Error('Invalid configuration values');
    }

    // Check if electronAPI is available (running in Electron)
    if (typeof window !== 'undefined' && window.electronAPI?.saveClaudeFlowConfig) {
      const result = await window.electronAPI.saveClaudeFlowConfig(configToSave);
      if (result.success) {
        store.setConfig(configToSave);
        store.setConfigDirty(false);
        return true;
      }
      throw new Error(result.error || 'Failed to save configuration');
    } else {
      // In non-Electron environment, save to localStorage
      localStorage.setItem('claude-flow-config', JSON.stringify(configToSave));
      store.setConfig(configToSave);
      store.setConfigDirty(false);
      return true;
    }
  } catch (error) {
    store.setConfigError(
      error instanceof Error ? error.message : 'Failed to save configuration'
    );
    return false;
  } finally {
    store.setConfigLoading(false);
  }
}

/**
 * Load execution metrics for a specific task
 */
export async function loadTaskMetrics(taskId: string): Promise<void> {
  const store = useClaudeFlowStore.getState();
  store.setMetricsLoading(true);
  store.setMetricsError(null);

  try {
    if (typeof window !== 'undefined' && window.electronAPI?.getTaskMetrics) {
      const result = await window.electronAPI.getTaskMetrics(taskId);
      if (result.success && result.data) {
        store.setCurrentMetrics(result.data);
      } else {
        store.setCurrentMetrics(null);
        if (result.error) {
          store.setMetricsError(result.error);
        }
      }
    }
  } catch (error) {
    store.setMetricsError(
      error instanceof Error ? error.message : 'Failed to load metrics'
    );
  } finally {
    store.setMetricsLoading(false);
  }
}

/**
 * Load task history for the current project
 */
export async function loadTaskHistory(projectId: string): Promise<void> {
  const store = useClaudeFlowStore.getState();
  store.setHistoryLoading(true);

  try {
    if (typeof window !== 'undefined' && window.electronAPI?.getParallelTaskHistory) {
      const result = await window.electronAPI.getParallelTaskHistory(projectId);
      if (result.success && result.data) {
        store.setTaskHistory(result.data);
      }
    }
  } catch {
    // Silently fail - history is optional
  } finally {
    store.setHistoryLoading(false);
  }
}

/**
 * Check if Claude Flow MCP server is available
 */
export async function checkServerStatus(): Promise<boolean> {
  const store = useClaudeFlowStore.getState();
  store.setServerChecking(true);

  try {
    if (typeof window !== 'undefined' && window.electronAPI?.checkClaudeFlowServer) {
      const result = await window.electronAPI.checkClaudeFlowServer();
      const available = result.success && result.data === true;
      store.setServerAvailable(available);
      return available;
    }
    return false;
  } catch {
    store.setServerAvailable(false);
    return false;
  } finally {
    store.setServerChecking(false);
  }
}

/**
 * Start a parallel task execution
 */
export async function startParallelTask(
  taskId: string,
  description: string
): Promise<boolean> {
  const store = useClaudeFlowStore.getState();
  const { config } = store;

  // Reset progress
  store.setProgress({
    taskId,
    phase: 'initializing',
    progress: 0,
    agentsCompleted: 0,
    agentsTotal: config.agentCount,
    statusMessage: 'Initializing parallel execution...'
  });

  try {
    if (typeof window !== 'undefined' && window.electronAPI?.startParallelTask) {
      const result = await window.electronAPI.startParallelTask({
        taskId,
        description,
        config
      });

      if (!result.success) {
        store.updateProgress({
          phase: 'failed',
          error: result.error || 'Failed to start parallel task'
        });
        return false;
      }

      store.updateProgress({
        phase: 'executing',
        statusMessage: 'Executing with parallel agents...'
      });
      return true;
    }
    return false;
  } catch (error) {
    store.updateProgress({
      phase: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return false;
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Validate configuration values
 */
function isValidConfig(config: ClaudeFlowConfig): boolean {
  const validAgentCounts: AgentCount[] = [4, 8, 12];
  const validTopologies: TopologyMode[] = [
    'distributed',
    'hierarchical',
    'mesh',
    'centralized'
  ];

  return (
    validAgentCounts.includes(config.agentCount) &&
    validTopologies.includes(config.topology)
  );
}

/**
 * Check if configuration has been modified from defaults
 */
export function isConfigModified(config: ClaudeFlowConfig): boolean {
  return (
    config.agentCount !== DEFAULT_CLAUDE_FLOW_CONFIG.agentCount ||
    config.topology !== DEFAULT_CLAUDE_FLOW_CONFIG.topology
  );
}

/**
 * Get estimated speedup factor based on agent count
 */
export function getEstimatedSpeedup(agentCount: AgentCount): number {
  switch (agentCount) {
    case 4:
      return 4.0;
    case 8:
      return 6.0;
    case 12:
      return 7.5;
    default:
      return 1.0;
  }
}

/**
 * Get topology description
 */
export function getTopologyDescription(topology: TopologyMode): string {
  switch (topology) {
    case 'distributed':
      return 'Equal peers working independently';
    case 'hierarchical':
      return 'Leader coordinates worker agents';
    case 'mesh':
      return 'Fully connected agent network';
    case 'centralized':
      return 'Single coordinator with workers';
    default:
      return 'Unknown topology';
  }
}

// ============================================
// Selectors
// ============================================

/**
 * Get the current configuration
 */
export function selectConfig(): ClaudeFlowConfig {
  return useClaudeFlowStore.getState().config;
}

/**
 * Check if configuration is loading or saving
 */
export function selectConfigLoading(): boolean {
  return useClaudeFlowStore.getState().configLoading;
}

/**
 * Get the current execution progress
 */
export function selectProgress(): TaskProgress {
  return useClaudeFlowStore.getState().currentProgress;
}

/**
 * Check if a task is currently executing
 */
export function selectIsExecuting(): boolean {
  const phase = useClaudeFlowStore.getState().currentProgress.phase;
  return phase === 'initializing' || phase === 'executing' || phase === 'aggregating';
}

/**
 * Get the current metrics
 */
export function selectMetrics(): ExecutionMetrics | null {
  return useClaudeFlowStore.getState().currentMetrics;
}

// ============================================
// Type augmentation for window.electronAPI
// ============================================

declare global {
  interface Window {
    electronAPI?: {
      getClaudeFlowConfig?: () => Promise<{ success: boolean; data?: ClaudeFlowConfig; error?: string }>;
      saveClaudeFlowConfig?: (config: ClaudeFlowConfig) => Promise<{ success: boolean; error?: string }>;
      getTaskMetrics?: (taskId: string) => Promise<{ success: boolean; data?: ExecutionMetrics; error?: string }>;
      getParallelTaskHistory?: (projectId: string) => Promise<{ success: boolean; data?: ParallelTaskResult[]; error?: string }>;
      checkClaudeFlowServer?: () => Promise<{ success: boolean; data?: boolean; error?: string }>;
      startParallelTask?: (params: { taskId: string; description: string; config: ClaudeFlowConfig }) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

export default useClaudeFlowStore;
