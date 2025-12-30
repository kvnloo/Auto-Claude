import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';

/**
 * Configuration options for starting a SWE-bench evaluation
 */
export interface SWEBenchEvaluationConfig {
  dataset: string;
  maxInstances?: number;
  maxWorkers?: number;
  runId?: string;
  timeout?: number;
  model?: string;
}

/**
 * Progress information for a running evaluation
 */
export interface SWEBenchProgressInfo {
  runId: string;
  currentInstanceId: string | null;
  completedInstances: number;
  totalInstances: number;
  successfulInstances: number;
  failedInstances: number;
  elapsedTimeSeconds: number;
  status: 'running' | 'paused' | 'completed' | 'failed';
}

/**
 * SWE-bench Operations API
 */
export interface SWEBenchAPI {
  /**
   * Start a new SWE-bench evaluation
   * Creates a terminal and runs the evaluation CLI
   */
  startEvaluation: (config: SWEBenchEvaluationConfig) => Promise<IPCResult<{ terminalId: string; runId: string }>>;

  /**
   * Stop a running evaluation
   */
  stopEvaluation: (runId: string) => Promise<IPCResult<void>>;

  /**
   * Get all evaluation runs
   */
  getRuns: () => Promise<IPCResult<unknown[]>>;

  /**
   * Get a specific evaluation run by ID
   */
  getRun: (runId: string) => Promise<IPCResult<unknown>>;

  /**
   * Get current progress of a running evaluation
   */
  getProgress: (runId: string) => Promise<IPCResult<SWEBenchProgressInfo>>;

  /**
   * Subscribe to evaluation progress updates
   */
  onProgress: (callback: (progress: SWEBenchProgressInfo) => void) => () => void;

  /**
   * Subscribe to evaluation completion events
   */
  onComplete: (callback: (result: { runId: string; success: boolean }) => void) => () => void;

  /**
   * Subscribe to evaluation error events
   */
  onError: (callback: (error: { runId: string; message: string }) => void) => () => void;
}

/**
 * Creates the SWE-bench API implementation
 */
export const createSWEBenchAPI = (): SWEBenchAPI => ({
  startEvaluation: (config: SWEBenchEvaluationConfig): Promise<IPCResult<{ terminalId: string; runId: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SWEBENCH_START_EVALUATION, config),

  stopEvaluation: (runId: string): Promise<IPCResult<void>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SWEBENCH_STOP_EVALUATION, runId),

  getRuns: (): Promise<IPCResult<unknown[]>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SWEBENCH_GET_RUNS),

  getRun: (runId: string): Promise<IPCResult<unknown>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SWEBENCH_GET_RUN, runId),

  getProgress: (runId: string): Promise<IPCResult<SWEBenchProgressInfo>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SWEBENCH_GET_PROGRESS, runId),

  onProgress: (callback: (progress: SWEBenchProgressInfo) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: SWEBenchProgressInfo): void => {
      callback(progress);
    };
    ipcRenderer.on(IPC_CHANNELS.SWEBENCH_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SWEBENCH_PROGRESS, handler);
    };
  },

  onComplete: (callback: (result: { runId: string; success: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: { runId: string; success: boolean }): void => {
      callback(result);
    };
    ipcRenderer.on(IPC_CHANNELS.SWEBENCH_COMPLETE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SWEBENCH_COMPLETE, handler);
    };
  },

  onError: (callback: (error: { runId: string; message: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: { runId: string; message: string }): void => {
      callback(error);
    };
    ipcRenderer.on(IPC_CHANNELS.SWEBENCH_ERROR, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SWEBENCH_ERROR, handler);
    };
  }
});
