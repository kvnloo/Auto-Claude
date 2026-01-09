/**
 * Usage Data API Module
 *
 * Provides preload bindings for the Token Usage & Cost Dashboard.
 * Exposes methods to retrieve and export usage data from the backend.
 */

import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult } from '../../../shared/types';
import { invokeIpc } from './ipc-utils';

/**
 * Usage Summary Data
 */
export interface UsageSummary {
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
export interface DateRangeUsage {
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
export interface AgentBreakdown {
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
export interface SpecUsage {
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
 * Export Result Data
 */
export interface ExportResult {
  file_path?: string;
  csv_content?: string;
  record_count: number;
  message?: string;
}

/**
 * Export Options for usage reports
 */
export interface UsageExportOptions {
  outputPath?: string;
  startDate?: string;
  endDate?: string;
  specId?: string;
  includeSummary?: boolean;
}

/**
 * Usage API Interface
 */
export interface UsageAPI {
  /**
   * Get aggregated usage summary with efficiency scores and trends
   */
  getUsageSummary: (
    projectId: string,
    startDate?: string,
    endDate?: string
  ) => Promise<IPCResult<UsageSummary>>;

  /**
   * Get usage data for a specific date range with daily/weekly/monthly breakdowns
   */
  getUsageByDateRange: (
    projectId: string,
    startDate: string,
    endDate: string
  ) => Promise<IPCResult<DateRangeUsage>>;

  /**
   * Get usage breakdown by agent type (planner, coder, qa)
   */
  getUsageByAgent: (
    projectId: string,
    startDate?: string,
    endDate?: string
  ) => Promise<IPCResult<AgentBreakdown>>;

  /**
   * Get usage breakdown by spec
   */
  getUsageBySpec: (projectId: string) => Promise<IPCResult<SpecUsage>>;

  /**
   * Export usage data to CSV format
   */
  exportUsageReport: (
    projectId: string,
    options?: UsageExportOptions
  ) => Promise<IPCResult<ExportResult>>;
}

/**
 * Creates the Usage API implementation
 */
export const createUsageAPI = (): UsageAPI => ({
  getUsageSummary: (
    projectId: string,
    startDate?: string,
    endDate?: string
  ): Promise<IPCResult<UsageSummary>> =>
    invokeIpc(IPC_CHANNELS.USAGE_GET_SUMMARY, projectId, startDate, endDate),

  getUsageByDateRange: (
    projectId: string,
    startDate: string,
    endDate: string
  ): Promise<IPCResult<DateRangeUsage>> =>
    invokeIpc(IPC_CHANNELS.USAGE_GET_BY_DATE_RANGE, projectId, startDate, endDate),

  getUsageByAgent: (
    projectId: string,
    startDate?: string,
    endDate?: string
  ): Promise<IPCResult<AgentBreakdown>> =>
    invokeIpc(IPC_CHANNELS.USAGE_GET_BY_AGENT, projectId, startDate, endDate),

  getUsageBySpec: (projectId: string): Promise<IPCResult<SpecUsage>> =>
    invokeIpc(IPC_CHANNELS.USAGE_GET_BY_SPEC, projectId),

  exportUsageReport: (
    projectId: string,
    options: UsageExportOptions = {}
  ): Promise<IPCResult<ExportResult>> =>
    invokeIpc(IPC_CHANNELS.USAGE_EXPORT_REPORT, projectId, options)
});
