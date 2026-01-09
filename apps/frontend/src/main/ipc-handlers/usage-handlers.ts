/**
 * Usage Data IPC Handlers
 *
 * Provides token usage and cost data for the Usage Dashboard.
 * Calls backend usage_runner.py via subprocess to retrieve usage metrics.
 */

import { ipcMain, app } from 'electron';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import { projectStore } from '../project-store';
import { parsePythonCommand } from '../python-detector';
import { pythonEnvManager, getConfiguredPythonPath } from '../python-env-manager';

/**
 * Usage Summary Data returned from backend
 */
interface UsageSummary {
  summary: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_thinking_tokens: number;
    total_cache_hit_tokens: number;
    total_cost_usd: number;
    session_count: number;
    success_count: number;
    failure_count: number;
  };
  efficiency: {
    success_rate: number;
    avg_tokens_per_session: number;
    avg_cost_per_session: number;
    cache_hit_rate: number;
    score: number;
    rating: string;
  };
  trends: {
    cost: {
      period: string;
      change_percent: number;
      direction: 'up' | 'down' | 'stable';
    };
    tokens: {
      period: string;
      change_percent: number;
      direction: 'up' | 'down' | 'stable';
    };
  };
}

/**
 * Date Range Usage Data
 */
interface DateRangeUsage {
  date_range: {
    start: string;
    end: string;
  };
  daily: Array<{
    date: string;
    total_tokens: number;
    total_cost_usd: number;
    session_count: number;
  }>;
  weekly: Record<string, unknown>;
  monthly: Record<string, unknown>;
  by_spec: Array<{
    spec_id: string;
    spec_name: string;
    total_tokens: number;
    total_cost_usd: number;
    session_count: number;
  }>;
  total_cost: number;
}

/**
 * Agent Breakdown Data
 */
interface AgentBreakdown {
  breakdown: Record<string, {
    agent_type: string;
    total_tokens: number;
    total_cost_usd: number;
    session_count: number;
    success_count: number;
    failure_count: number;
  }>;
  totals: {
    tokens: number;
    cost_usd: number;
    sessions: number;
  };
  date_range?: {
    start: string;
    end: string;
  };
}

/**
 * Spec Usage Data
 */
interface SpecUsage {
  specs: Array<{
    spec_id: string;
    spec_name: string;
    total_tokens: number;
    total_cost_usd: number;
    session_count: number;
    success_count: number;
    failure_count: number;
    last_session_at: string;
  }>;
  total_specs: number;
}

/**
 * Export Report Result
 */
interface ExportResult {
  file_path?: string;
  csv_content?: string;
  record_count: number;
  message?: string;
}

/**
 * Get the path to the usage_runner.py script
 */
function getUsageRunnerPath(): string | null {
  const possiblePaths = [
    // Packaged app paths (check FIRST for packaged builds)
    ...(app.isPackaged
      ? [path.join(process.resourcesPath, 'backend', 'usage_runner.py')]
      : []),
    // Development paths
    path.resolve(__dirname, '..', '..', '..', 'backend', 'usage_runner.py'),
    path.resolve(process.cwd(), 'apps', 'backend', 'usage_runner.py'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Execute usage_runner.py with the given command and arguments
 */
async function executeUsageRunner(
  projectDir: string,
  command: string,
  args: string[] = []
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const runnerPath = getUsageRunnerPath();

  if (!runnerPath) {
    return { success: false, error: 'usage_runner.py script not found' };
  }

  // Use configured Python path (venv if ready, otherwise bundled/system)
  const pythonCmd = getConfiguredPythonPath();
  const [pythonExe, baseArgs] = parsePythonCommand(pythonCmd);

  const fullArgs = [
    ...baseArgs,
    runnerPath,
    command,
    '--project-dir',
    projectDir,
    ...args,
  ];

  return new Promise((resolve) => {
    let resolved = false;

    const proc = spawn(pythonExe, fullArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: pythonEnvManager.getPythonEnv(),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Timeout after 30 seconds
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve({ success: false, error: 'Request timed out' });
      }
    }, 30000);

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);

      if (code === 0 && stdout) {
        try {
          const result = JSON.parse(stdout);
          if (result.success) {
            resolve({ success: true, data: result.data });
          } else {
            resolve({
              success: false,
              error: result.error?.message || 'Unknown error from usage runner',
            });
          }
        } catch {
          resolve({ success: false, error: `Invalid JSON response: ${stdout.substring(0, 200)}` });
        }
      } else {
        resolve({
          success: false,
          error: stderr || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Register all usage-related IPC handlers
 */
export function registerUsageHandlers(): void {
  // ============================================
  // Usage Summary
  // ============================================

  /**
   * Get usage summary for a project
   * Returns aggregated usage statistics including totals, efficiency scores, and trends
   */
  ipcMain.handle(
    IPC_CHANNELS.USAGE_GET_SUMMARY,
    async (_, projectId: string, startDate?: string, endDate?: string): Promise<IPCResult<UsageSummary>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const args: string[] = [];
      if (startDate) {
        args.push('--start', startDate);
      }
      if (endDate) {
        args.push('--end', endDate);
      }

      const result = await executeUsageRunner(project.path, 'get_summary', args);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, data: result.data as UsageSummary };
    }
  );

  // ============================================
  // Usage by Date Range
  // ============================================

  /**
   * Get usage data for a specific date range
   * Returns daily, weekly, and monthly breakdowns
   */
  ipcMain.handle(
    IPC_CHANNELS.USAGE_GET_BY_DATE_RANGE,
    async (
      _,
      projectId: string,
      startDate: string,
      endDate: string
    ): Promise<IPCResult<DateRangeUsage>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      if (!startDate || !endDate) {
        return { success: false, error: 'Start date and end date are required' };
      }

      const args = ['--start', startDate, '--end', endDate];
      const result = await executeUsageRunner(project.path, 'get_by_date_range', args);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, data: result.data as DateRangeUsage };
    }
  );

  // ============================================
  // Usage by Agent Type
  // ============================================

  /**
   * Get usage breakdown by agent type (planner, coder, qa)
   */
  ipcMain.handle(
    IPC_CHANNELS.USAGE_GET_BY_AGENT,
    async (
      _,
      projectId: string,
      startDate?: string,
      endDate?: string
    ): Promise<IPCResult<AgentBreakdown>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const args: string[] = [];
      if (startDate) {
        args.push('--start', startDate);
      }
      if (endDate) {
        args.push('--end', endDate);
      }

      const result = await executeUsageRunner(project.path, 'get_by_agent', args);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, data: result.data as AgentBreakdown };
    }
  );

  // ============================================
  // Usage by Spec
  // ============================================

  /**
   * Get list of specs with usage data
   */
  ipcMain.handle(
    IPC_CHANNELS.USAGE_GET_BY_SPEC,
    async (_, projectId: string): Promise<IPCResult<SpecUsage>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const result = await executeUsageRunner(project.path, 'get_specs');

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, data: result.data as SpecUsage };
    }
  );

  // ============================================
  // Export Usage Report
  // ============================================

  /**
   * Export usage data to CSV format
   * Can either return CSV content or write to a file
   */
  ipcMain.handle(
    IPC_CHANNELS.USAGE_EXPORT_REPORT,
    async (
      _,
      projectId: string,
      options: {
        outputPath?: string;
        startDate?: string;
        endDate?: string;
        specId?: string;
        includeSummary?: boolean;
      } = {}
    ): Promise<IPCResult<ExportResult>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const args: string[] = [];

      if (options.outputPath) {
        args.push('--output', options.outputPath);
      }
      if (options.startDate) {
        args.push('--start', options.startDate);
      }
      if (options.endDate) {
        args.push('--end', options.endDate);
      }
      if (options.specId) {
        args.push('--spec', options.specId);
      }
      if (options.includeSummary === false) {
        args.push('--no-summary');
      }

      const result = await executeUsageRunner(project.path, 'export_csv', args);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, data: result.data as ExportResult };
    }
  );
}
