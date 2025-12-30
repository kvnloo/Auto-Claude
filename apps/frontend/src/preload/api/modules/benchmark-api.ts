import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { invokeIpc } from './ipc-utils';

/**
 * Benchmark configuration for SWE-bench evaluation
 */
export interface BenchmarkConfig {
  variant: 'lite' | 'verified' | 'full' | 'multimodal' | 'multilingual';
  maxWorkers: number;
  instanceCount: number;
  cacheLevel: 'none' | 'base' | 'env' | 'instance';
}

/**
 * Infrastructure health check result
 */
export interface InfrastructureHealth {
  dockerAvailable: boolean;
  diskSpaceOk: boolean;
  diskSpaceGb: number;
  cpuCores: number;
  recommendedMaxWorkers: number;
  isArm: boolean;
  armWarning: string | null;
}

/**
 * Benchmark API operations
 */
export interface BenchmarkAPI {
  checkBenchmarkInfrastructure: () => Promise<IPCResult<InfrastructureHealth>>;
  startBenchmark: (projectId: string, config: BenchmarkConfig) => Promise<IPCResult<{ runId: string }>>;
  cancelBenchmark: () => Promise<IPCResult>;
}

/**
 * Creates the Benchmark API implementation
 */
export const createBenchmarkAPI = (): BenchmarkAPI => ({
  checkBenchmarkInfrastructure: (): Promise<IPCResult<InfrastructureHealth>> =>
    invokeIpc(IPC_CHANNELS.BENCHMARK_CHECK_INFRASTRUCTURE),

  startBenchmark: (projectId: string, config: BenchmarkConfig): Promise<IPCResult<{ runId: string }>> =>
    invokeIpc(IPC_CHANNELS.BENCHMARK_START, projectId, config),

  cancelBenchmark: (): Promise<IPCResult> =>
    invokeIpc(IPC_CHANNELS.BENCHMARK_CANCEL)
});
