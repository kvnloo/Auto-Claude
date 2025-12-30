/**
 * Benchmark IPC handlers registration
 *
 * This module provides IPC handlers for SWE-bench benchmark operations.
 * The handlers integrate with the backend Python services for actual benchmark execution.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as fs from 'fs';

const execAsync = promisify(exec);

/**
 * Infrastructure health check result
 */
interface InfrastructureHealth {
  dockerAvailable: boolean;
  diskSpaceOk: boolean;
  diskSpaceGb: number;
  cpuCores: number;
  recommendedMaxWorkers: number;
  isArm: boolean;
  armWarning: string | null;
}

/**
 * Check if Docker is available
 */
async function checkDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get available disk space in GB
 */
function getDiskSpaceGb(): number {
  try {
    // Get the home directory disk space
    const stats = fs.statfsSync(os.homedir());
    const freeBytes = stats.bfree * stats.bsize;
    return freeBytes / (1024 * 1024 * 1024);
  } catch {
    return 0;
  }
}

/**
 * Check infrastructure health for benchmark execution
 */
async function checkBenchmarkInfrastructure(): Promise<IPCResult<InfrastructureHealth>> {
  try {
    const dockerAvailable = await checkDockerAvailable();
    const diskSpaceGb = getDiskSpaceGb();
    const cpuCores = os.cpus().length;
    const isArm = os.arch() === 'arm64';

    const health: InfrastructureHealth = {
      dockerAvailable,
      diskSpaceOk: diskSpaceGb >= 10,
      diskSpaceGb,
      cpuCores,
      recommendedMaxWorkers: Math.max(1, Math.floor(cpuCores * 0.75)),
      isArm,
      armWarning: isArm
        ? 'Running on ARM architecture (Apple Silicon). Some Docker images may have compatibility issues. Consider using namespace="" flag for evaluation.'
        : null
    };

    return { success: true, data: health };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check infrastructure'
    };
  }
}

/**
 * Start benchmark execution
 *
 * This is a placeholder implementation. The actual benchmark execution
 * will be implemented via Python backend integration.
 */
async function startBenchmark(
  _event: Electron.IpcMainInvokeEvent,
  projectId: string,
  config: {
    variant: string;
    maxWorkers: number;
    instanceCount: number;
    cacheLevel: string;
  }
): Promise<IPCResult<{ runId: string }>> {
  try {
    // Generate a unique run ID
    const runId = `benchmark-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    console.log('[Benchmark] Starting benchmark:', {
      projectId,
      runId,
      variant: config.variant,
      maxWorkers: config.maxWorkers,
      instanceCount: config.instanceCount,
      cacheLevel: config.cacheLevel
    });

    // TODO: Integrate with Python backend for actual benchmark execution
    // For now, return success with the run ID
    // The actual implementation will:
    // 1. Load the dataset from HuggingFace
    // 2. Convert instances to autoclaude tasks
    // 3. Execute tasks via the autoclaude pipeline
    // 4. Export predictions to JSONL
    // 5. Run SWE-bench evaluation harness
    // 6. Send progress events via IPC

    return {
      success: true,
      data: { runId }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start benchmark'
    };
  }
}

/**
 * Cancel running benchmark
 *
 * This is a placeholder implementation.
 */
async function cancelBenchmark(): Promise<IPCResult> {
  try {
    console.log('[Benchmark] Canceling benchmark');
    // TODO: Implement actual cancellation logic
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel benchmark'
    };
  }
}

/**
 * Register all benchmark-related IPC handlers
 */
export function registerBenchmarkHandlers(
  _getMainWindow: () => BrowserWindow | null
): () => void {
  // Infrastructure check
  ipcMain.handle(
    IPC_CHANNELS.BENCHMARK_CHECK_INFRASTRUCTURE,
    checkBenchmarkInfrastructure
  );

  // Benchmark operations
  ipcMain.handle(
    IPC_CHANNELS.BENCHMARK_START,
    startBenchmark
  );

  ipcMain.handle(
    IPC_CHANNELS.BENCHMARK_CANCEL,
    cancelBenchmark
  );

  // Return cleanup function
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.BENCHMARK_CHECK_INFRASTRUCTURE);
    ipcMain.removeHandler(IPC_CHANNELS.BENCHMARK_START);
    ipcMain.removeHandler(IPC_CHANNELS.BENCHMARK_CANCEL);
  };
}
