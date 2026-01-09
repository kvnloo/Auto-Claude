/**
 * Token Usage & Cost Dashboard Store
 *
 * Zustand store for managing token usage data state.
 * Provides state and actions for the usage dashboard.
 */

import { create } from 'zustand';
import type {
  UsageSummary,
  AgentUsageBreakdown,
  DailyUsage,
  DateRangeFilter,
  DateRangePreset,
  SpecUsageRecord,
  EfficiencyMetrics,
  UsageTrend,
  TrendDirection
} from '../../shared/types/usage';
import type {
  UsageSummary as APIUsageSummary,
  DateRangeUsage as APIDateRangeUsage,
  AgentBreakdown as APIAgentBreakdown,
  SpecUsage as APISpecUsage,
  ExportResult
} from '../../preload/api/modules/usage-api';

// ============================================
// Store State Interface
// ============================================

interface UsageState {
  // Usage data
  currentUsage: UsageSummary | null;
  historicalUsage: DailyUsage[];
  agentBreakdown: AgentUsageBreakdown[];
  specUsage: SpecUsageRecord[];

  // Efficiency and trends
  efficiency: EfficiencyMetrics | null;
  costTrend: UsageTrend | null;
  tokenTrend: UsageTrend | null;

  // Loading states (per-section for independent loading)
  loading: {
    summary: boolean;
    historical: boolean;
    agents: boolean;
    specs: boolean;
    export: boolean;
  };

  // Error states (per-section)
  errors: {
    summary: string | null;
    historical: string | null;
    agents: string | null;
    specs: string | null;
    export: string | null;
  };

  // Date range selection
  dateRange: DateRangeFilter;

  // Export state
  lastExportResult: ExportResult | null;

  // Actions - setters
  setCurrentUsage: (usage: UsageSummary | null) => void;
  setHistoricalUsage: (usage: DailyUsage[]) => void;
  setAgentBreakdown: (breakdown: AgentUsageBreakdown[]) => void;
  setSpecUsage: (specs: SpecUsageRecord[]) => void;
  setEfficiency: (efficiency: EfficiencyMetrics | null) => void;
  setCostTrend: (trend: UsageTrend | null) => void;
  setTokenTrend: (trend: UsageTrend | null) => void;
  setLoading: (section: keyof UsageState['loading'], isLoading: boolean) => void;
  setError: (section: keyof UsageState['errors'], error: string | null) => void;
  setDateRange: (dateRange: DateRangeFilter) => void;
  setLastExportResult: (result: ExportResult | null) => void;

  // Actions - reset
  reset: () => void;
  clearErrors: () => void;
}

// ============================================
// Initial State
// ============================================

const initialLoading = {
  summary: false,
  historical: false,
  agents: false,
  specs: false,
  export: false
};

const initialErrors = {
  summary: null,
  historical: null,
  agents: null,
  specs: null,
  export: null
};

const initialDateRange: DateRangeFilter = {
  preset: 'last30days' as DateRangePreset
};

const initialState = {
  currentUsage: null,
  historicalUsage: [],
  agentBreakdown: [],
  specUsage: [],
  efficiency: null,
  costTrend: null,
  tokenTrend: null,
  loading: initialLoading,
  errors: initialErrors,
  dateRange: initialDateRange,
  lastExportResult: null
};

// ============================================
// Store Creation
// ============================================

export const useUsageStore = create<UsageState>((set) => ({
  ...initialState,

  setCurrentUsage: (usage) => set({ currentUsage: usage }),
  setHistoricalUsage: (usage) => set({ historicalUsage: usage }),
  setAgentBreakdown: (breakdown) => set({ agentBreakdown: breakdown }),
  setSpecUsage: (specs) => set({ specUsage: specs }),
  setEfficiency: (efficiency) => set({ efficiency }),
  setCostTrend: (trend) => set({ costTrend: trend }),
  setTokenTrend: (trend) => set({ tokenTrend: trend }),

  setLoading: (section, isLoading) =>
    set((state) => ({
      loading: { ...state.loading, [section]: isLoading }
    })),

  setError: (section, error) =>
    set((state) => ({
      errors: { ...state.errors, [section]: error }
    })),

  setDateRange: (dateRange) => set({ dateRange }),
  setLastExportResult: (result) => set({ lastExportResult: result }),

  reset: () => set(initialState),

  clearErrors: () => set({ errors: initialErrors })
}));

// ============================================
// Helper Functions - Data Transformation
// ============================================

/**
 * Convert API date range preset to start/end dates
 */
export function getDateRangeForPreset(preset: DateRangePreset): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = now.toISOString().split('T')[0];
  let startDate: string;

  switch (preset) {
    case 'today':
      startDate = endDate;
      break;
    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = yesterday.toISOString().split('T')[0];
      break;
    }
    case 'last7days': {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      startDate = weekAgo.toISOString().split('T')[0];
      break;
    }
    case 'last30days': {
      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 30);
      startDate = monthAgo.toISOString().split('T')[0];
      break;
    }
    case 'thisMonth': {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate = firstOfMonth.toISOString().split('T')[0];
      break;
    }
    case 'lastMonth': {
      const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      startDate = firstOfLastMonth.toISOString().split('T')[0];
      return { startDate, endDate: lastOfLastMonth.toISOString().split('T')[0] };
    }
    case 'thisYear': {
      const firstOfYear = new Date(now.getFullYear(), 0, 1);
      startDate = firstOfYear.toISOString().split('T')[0];
      break;
    }
    case 'custom':
    default:
      // For custom, return last 30 days as fallback
      const fallbackAgo = new Date(now);
      fallbackAgo.setDate(fallbackAgo.getDate() - 30);
      startDate = fallbackAgo.toISOString().split('T')[0];
  }

  return { startDate, endDate };
}

/**
 * Transform API usage summary to store format
 */
function transformUsageSummary(api: APIUsageSummary): UsageSummary {
  const now = new Date();
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);

  return {
    periodStart: monthAgo.toISOString(),
    periodEnd: now.toISOString(),
    totalSessions: api.summary.session_count,
    totalInputTokens: api.summary.total_input_tokens,
    totalOutputTokens: api.summary.total_output_tokens,
    totalThinkingTokens: api.summary.total_thinking_tokens,
    totalCacheHitTokens: api.summary.total_cache_hit_tokens,
    totalCostUsd: api.summary.total_cost_usd,
    successCount: api.summary.success_count,
    failureCount: api.summary.failure_count,
    uniqueSpecs: 0, // Will be updated from spec data
    totalTokens:
      api.summary.total_input_tokens +
      api.summary.total_output_tokens +
      api.summary.total_thinking_tokens,
    avgCostPerSpec: api.efficiency.avg_cost_per_session,
    avgTokensPerSession: api.efficiency.avg_tokens_per_session,
    successRate: api.efficiency.success_rate,
    cacheEfficiency: api.efficiency.cache_hit_rate
  };
}

/**
 * Transform API efficiency data to store format
 */
function transformEfficiency(api: APIUsageSummary): EfficiencyMetrics {
  return {
    overallScore: api.efficiency.score,
    successRate: api.efficiency.success_rate,
    cacheEfficiency: api.efficiency.cache_hit_rate,
    tokenEfficiency: 100 - (api.efficiency.avg_tokens_per_session / 100000) * 100, // Normalize
    totalSessions: api.summary.session_count,
    successfulSpecs: api.summary.success_count,
    rating: api.efficiency.rating as EfficiencyMetrics['rating']
  };
}

/**
 * Transform API trend data
 */
function transformTrend(trend: { period: string; change_percent: number; direction: 'up' | 'down' | 'stable' }): UsageTrend {
  const direction: TrendDirection = trend.direction === 'stable' ? 'flat' : trend.direction;
  return {
    currentValue: 0, // Will be filled from summary
    previousValue: 0,
    changeAbsolute: 0,
    changePercentage: trend.change_percent,
    trendDirection: direction
  };
}

/**
 * Transform API daily usage data
 */
function transformDailyUsage(daily: APIDateRangeUsage['daily']): DailyUsage[] {
  return daily.map((d) => ({
    date: d.date,
    totalTokens: d.total_tokens,
    totalCost: d.total_cost_usd,
    sessionCount: d.session_count,
    inputTokens: 0, // API doesn't break this down in daily
    outputTokens: 0,
    thinkingTokens: 0,
    cacheHitTokens: 0,
    successCount: 0,
    failureCount: 0
  }));
}

/**
 * Transform API agent breakdown
 */
function transformAgentBreakdown(api: APIAgentBreakdown): AgentUsageBreakdown[] {
  return Object.values(api.breakdown).map((agent) => ({
    agentType: agent.agent_type as AgentUsageBreakdown['agentType'],
    sessionCount: agent.session_count,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalThinkingTokens: 0,
    totalCacheHitTokens: 0,
    totalCostUsd: agent.total_cost_usd,
    successCount: agent.success_count,
    failureCount: agent.failure_count,
    totalTokens: agent.total_tokens,
    avgTokensPerSession: agent.session_count > 0 ? agent.total_tokens / agent.session_count : 0,
    successRate:
      agent.session_count > 0
        ? (agent.success_count / agent.session_count) * 100
        : 0
  }));
}

/**
 * Transform API spec usage
 */
function transformSpecUsage(api: APISpecUsage): SpecUsageRecord[] {
  return api.specs.map((spec) => ({
    specId: spec.spec_id,
    specName: spec.spec_name,
    totalTokens: spec.total_tokens,
    totalCost: spec.total_cost_usd,
    sessionCount: spec.session_count,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheHitTokens: 0,
    successCount: spec.success_count,
    failureCount: spec.failure_count,
    lastSession: spec.last_session_at,
    avgTokensPerSession: spec.session_count > 0 ? spec.total_tokens / spec.session_count : 0,
    successRate:
      spec.session_count > 0 ? (spec.success_count / spec.session_count) * 100 : 0
  }));
}

// ============================================
// Helper Functions - Data Loading
// ============================================

/**
 * Load usage summary for a project
 */
export async function loadUsageSummary(projectId: string): Promise<void> {
  const store = useUsageStore.getState();
  store.setLoading('summary', true);
  store.setError('summary', null);

  try {
    const { dateRange } = store;
    let startDate: string | undefined;
    let endDate: string | undefined;

    if (dateRange.preset === 'custom' && dateRange.startDate && dateRange.endDate) {
      startDate = dateRange.startDate;
      endDate = dateRange.endDate;
    } else if (dateRange.preset !== 'custom') {
      const dates = getDateRangeForPreset(dateRange.preset);
      startDate = dates.startDate;
      endDate = dates.endDate;
    }

    const result = await window.electronAPI.getUsageSummary(projectId, startDate, endDate);

    if (result.success && result.data) {
      const summary = transformUsageSummary(result.data);
      const efficiency = transformEfficiency(result.data);
      const costTrend = transformTrend(result.data.trends.cost);
      const tokenTrend = transformTrend(result.data.trends.tokens);

      // Update trends with current values
      costTrend.currentValue = summary.totalCostUsd;
      tokenTrend.currentValue = summary.totalTokens || 0;

      store.setCurrentUsage(summary);
      store.setEfficiency(efficiency);
      store.setCostTrend(costTrend);
      store.setTokenTrend(tokenTrend);
    } else {
      store.setError('summary', result.error || 'Failed to load usage summary');
    }
  } catch (error) {
    store.setError(
      'summary',
      error instanceof Error ? error.message : 'Failed to load usage summary'
    );
  } finally {
    store.setLoading('summary', false);
  }
}

/**
 * Load historical usage data by date range
 */
export async function loadUsageByDateRange(projectId: string): Promise<void> {
  const store = useUsageStore.getState();
  store.setLoading('historical', true);
  store.setError('historical', null);

  try {
    const { dateRange } = store;
    let startDate: string;
    let endDate: string;

    if (dateRange.preset === 'custom' && dateRange.startDate && dateRange.endDate) {
      startDate = dateRange.startDate;
      endDate = dateRange.endDate;
    } else {
      const dates = getDateRangeForPreset(dateRange.preset);
      startDate = dates.startDate;
      endDate = dates.endDate;
    }

    const result = await window.electronAPI.getUsageByDateRange(projectId, startDate, endDate);

    if (result.success && result.data) {
      const dailyUsage = transformDailyUsage(result.data.daily);
      store.setHistoricalUsage(dailyUsage);
    } else {
      store.setError('historical', result.error || 'Failed to load historical usage');
    }
  } catch (error) {
    store.setError(
      'historical',
      error instanceof Error ? error.message : 'Failed to load historical usage'
    );
  } finally {
    store.setLoading('historical', false);
  }
}

/**
 * Load agent breakdown data
 */
export async function loadAgentBreakdown(projectId: string): Promise<void> {
  const store = useUsageStore.getState();
  store.setLoading('agents', true);
  store.setError('agents', null);

  try {
    const { dateRange } = store;
    let startDate: string | undefined;
    let endDate: string | undefined;

    if (dateRange.preset === 'custom' && dateRange.startDate && dateRange.endDate) {
      startDate = dateRange.startDate;
      endDate = dateRange.endDate;
    } else if (dateRange.preset !== 'custom') {
      const dates = getDateRangeForPreset(dateRange.preset);
      startDate = dates.startDate;
      endDate = dates.endDate;
    }

    const result = await window.electronAPI.getUsageByAgent(projectId, startDate, endDate);

    if (result.success && result.data) {
      const breakdown = transformAgentBreakdown(result.data);
      store.setAgentBreakdown(breakdown);
    } else {
      store.setError('agents', result.error || 'Failed to load agent breakdown');
    }
  } catch (error) {
    store.setError(
      'agents',
      error instanceof Error ? error.message : 'Failed to load agent breakdown'
    );
  } finally {
    store.setLoading('agents', false);
  }
}

/**
 * Load spec usage data
 */
export async function loadSpecUsage(projectId: string): Promise<void> {
  const store = useUsageStore.getState();
  store.setLoading('specs', true);
  store.setError('specs', null);

  try {
    const result = await window.electronAPI.getUsageBySpec(projectId);

    if (result.success && result.data) {
      const specs = transformSpecUsage(result.data);
      store.setSpecUsage(specs);

      // Update unique specs count in summary
      const currentUsage = store.currentUsage;
      if (currentUsage) {
        store.setCurrentUsage({
          ...currentUsage,
          uniqueSpecs: result.data.total_specs
        });
      }
    } else {
      store.setError('specs', result.error || 'Failed to load spec usage');
    }
  } catch (error) {
    store.setError(
      'specs',
      error instanceof Error ? error.message : 'Failed to load spec usage'
    );
  } finally {
    store.setLoading('specs', false);
  }
}

/**
 * Load all usage data at once
 */
export async function loadAllUsageData(projectId: string): Promise<void> {
  // Run all loads in parallel
  await Promise.all([
    loadUsageSummary(projectId),
    loadUsageByDateRange(projectId),
    loadAgentBreakdown(projectId),
    loadSpecUsage(projectId)
  ]);
}

/**
 * Set date range and reload data
 */
export async function setDateRangeAndReload(
  projectId: string,
  dateRange: DateRangeFilter
): Promise<void> {
  const store = useUsageStore.getState();
  store.setDateRange(dateRange);
  await loadAllUsageData(projectId);
}

/**
 * Export usage report to CSV
 */
export async function exportReport(
  projectId: string,
  options?: {
    outputPath?: string;
    specId?: string;
    includeSummary?: boolean;
  }
): Promise<ExportResult | null> {
  const store = useUsageStore.getState();
  store.setLoading('export', true);
  store.setError('export', null);

  try {
    const { dateRange } = store;
    let startDate: string | undefined;
    let endDate: string | undefined;

    if (dateRange.preset === 'custom' && dateRange.startDate && dateRange.endDate) {
      startDate = dateRange.startDate;
      endDate = dateRange.endDate;
    } else if (dateRange.preset !== 'custom') {
      const dates = getDateRangeForPreset(dateRange.preset);
      startDate = dates.startDate;
      endDate = dates.endDate;
    }

    const result = await window.electronAPI.exportUsageReport(projectId, {
      ...options,
      startDate,
      endDate
    });

    if (result.success && result.data) {
      store.setLastExportResult(result.data);
      return result.data;
    } else {
      store.setError('export', result.error || 'Failed to export report');
      return null;
    }
  } catch (error) {
    store.setError(
      'export',
      error instanceof Error ? error.message : 'Failed to export report'
    );
    return null;
  } finally {
    store.setLoading('export', false);
  }
}

// ============================================
// Selectors
// ============================================

/**
 * Check if any data is currently loading
 */
export function isAnyLoading(): boolean {
  const { loading } = useUsageStore.getState();
  return Object.values(loading).some(Boolean);
}

/**
 * Check if there are any errors
 */
export function hasAnyError(): boolean {
  const { errors } = useUsageStore.getState();
  return Object.values(errors).some((e) => e !== null);
}

/**
 * Get total tokens across all usage
 */
export function getTotalTokens(): number {
  const { currentUsage } = useUsageStore.getState();
  return currentUsage?.totalTokens || 0;
}

/**
 * Get total cost in USD
 */
export function getTotalCost(): number {
  const { currentUsage } = useUsageStore.getState();
  return currentUsage?.totalCostUsd || 0;
}

/**
 * Get efficiency score (0-100)
 */
export function getEfficiencyScore(): number {
  const { efficiency } = useUsageStore.getState();
  return efficiency?.overallScore || 0;
}

/**
 * Get agent with highest usage
 */
export function getHighestUsageAgent(): AgentUsageBreakdown | null {
  const { agentBreakdown } = useUsageStore.getState();
  if (agentBreakdown.length === 0) return null;
  return agentBreakdown.reduce((max, agent) =>
    agent.totalTokens && max.totalTokens && agent.totalTokens > max.totalTokens ? agent : max
  );
}
