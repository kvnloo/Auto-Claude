import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import { TerminalManager } from '../terminal-manager';
import { projectStore } from '../project-store';
import path from 'path';
import { debugLog, debugError } from '../../shared/utils/debug-logger';

/**
 * Configuration for starting a SWE-bench evaluation
 */
interface SWEBenchEvaluationConfig {
  dataset: string;
  maxInstances?: number;
  maxWorkers?: number;
  runId?: string;
  timeout?: number;
  model?: string;
}

/**
 * Register SWE-bench IPC handlers
 */
export function registerSWEBenchHandlers(
  terminalManager: TerminalManager,
  getMainWindow: () => BrowserWindow | null
): void {
  /**
   * Start a SWE-bench evaluation by creating a terminal and running the CLI
   */
  ipcMain.handle(
    IPC_CHANNELS.SWEBENCH_START_EVALUATION,
    async (_, config: SWEBenchEvaluationConfig): Promise<IPCResult<{ terminalId: string; runId: string }>> => {
      debugLog('[swebench-handlers] Starting evaluation with config:', config);

      try {
        // Get the active project to find the backend directory
        const tabState = projectStore.getTabState();
        if (!tabState.activeProjectId) {
          return { success: false, error: 'No active project. Please open a project first.' };
        }

        const activeProject = projectStore.getProject(tabState.activeProjectId);
        if (!activeProject) {
          return { success: false, error: 'Active project not found. Please select a project.' };
        }

        // Determine the backend directory path
        // The backend is at apps/backend relative to the project root
        const backendDir = path.join(activeProject.path, 'apps', 'backend');

        // Generate a run ID if not provided
        const runId = config.runId || `swebench-${Date.now()}`;

        // Create a unique terminal ID
        const terminalId = `swebench-eval-${runId}`;

        debugLog('[swebench-handlers] Creating terminal:', { terminalId, backendDir });

        // Create a new terminal for the evaluation
        const createResult = await terminalManager.create({
          id: terminalId,
          cwd: backendDir
        });

        if (!createResult.success) {
          debugError('[swebench-handlers] Failed to create terminal:', createResult.error);
          return { success: false, error: createResult.error || 'Failed to create terminal' };
        }

        // Wait a moment for the terminal to initialize
        await new Promise(resolve => setTimeout(resolve, 500));

        // Build the CLI command
        const cmdParts = ['python', '-m', 'cli.swebench_eval'];
        cmdParts.push('--dataset', config.dataset);

        if (config.maxInstances !== undefined) {
          cmdParts.push('--max-instances', String(config.maxInstances));
        }

        if (config.maxWorkers !== undefined) {
          cmdParts.push('--max-workers', String(config.maxWorkers));
        }

        cmdParts.push('--run-id', runId);

        if (config.timeout !== undefined) {
          cmdParts.push('--timeout', String(config.timeout));
        }

        if (config.model) {
          cmdParts.push('--model', config.model);
        }

        const command = cmdParts.join(' ');
        debugLog('[swebench-handlers] Running command:', command);

        // Write the command to the terminal
        terminalManager.write(terminalId, `${command}\r`);

        // Notify the renderer that an evaluation terminal was created
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('swebench-evaluation-started', {
            terminalId,
            runId,
            dataset: config.dataset,
            maxInstances: config.maxInstances
          });
        }

        return {
          success: true,
          data: {
            terminalId,
            runId
          }
        };
      } catch (error) {
        debugError('[swebench-handlers] Error starting evaluation:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start SWE-bench evaluation'
        };
      }
    }
  );

  /**
   * Stop a running SWE-bench evaluation
   */
  ipcMain.handle(
    IPC_CHANNELS.SWEBENCH_STOP_EVALUATION,
    async (_, runId: string): Promise<IPCResult<void>> => {
      debugLog('[swebench-handlers] Stopping evaluation:', runId);

      try {
        const terminalId = `swebench-eval-${runId}`;

        // Send Ctrl+C to the terminal to stop the evaluation
        terminalManager.write(terminalId, '\x03');

        // Wait a moment then destroy the terminal
        await new Promise(resolve => setTimeout(resolve, 1000));
        await terminalManager.destroy(terminalId);

        return { success: true };
      } catch (error) {
        debugError('[swebench-handlers] Error stopping evaluation:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to stop evaluation'
        };
      }
    }
  );

  /**
   * Get all SWE-bench evaluation runs
   * This reads from the checkpoint/results files in the .auto-claude/swebench directory
   */
  ipcMain.handle(
    IPC_CHANNELS.SWEBENCH_GET_RUNS,
    async (): Promise<IPCResult<unknown[]>> => {
      try {
        // TODO: Implement reading from checkpoint files
        // For now, return empty array
        return { success: true, data: [] };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get runs'
        };
      }
    }
  );

  /**
   * Get a specific SWE-bench evaluation run by ID
   */
  ipcMain.handle(
    IPC_CHANNELS.SWEBENCH_GET_RUN,
    async (_, _runId: string): Promise<IPCResult<unknown>> => {
      try {
        // TODO: Implement reading from checkpoint/report files
        return { success: true, data: null };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get run'
        };
      }
    }
  );

  /**
   * Get progress of a running evaluation
   */
  ipcMain.handle(
    IPC_CHANNELS.SWEBENCH_GET_PROGRESS,
    async (_, _runId: string): Promise<IPCResult<unknown>> => {
      try {
        // TODO: Implement reading progress from checkpoint files
        return { success: true, data: null };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get progress'
        };
      }
    }
  );

  debugLog('[swebench-handlers] SWE-bench IPC handlers registered');
}
