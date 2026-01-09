/**
 * Token Usage & Cost Dashboard Types
 *
 * TypeScript interfaces for tracking and displaying token usage,
 * cost estimates, and efficiency metrics.
 */

// ============================================
// Enums and Constants
// ============================================

/**
 * Agent types that contribute to token usage
 */
export type AgentType =
  | 'planner'
  | 'coder'
  | 'qa_reviewer'
  | 'qa_fixer'
  | 'spec_gatherer'
  | 'spec_researcher'
  | 'spec_writer'
  | 'spec_critic'
  | 'spec_discovery'
  | 'spec_context'
  | 'spec_validation'
  | 'insights'
  | 'pr_reviewer'
  | 'analysis'
  | 'unknown';

/**
 * Possible outcomes for an agent session
 */
export type SessionOutcome =
  | 'success'
  | 'retry'
  | 'failed'
  | 'abandoned'
  | 'in_progress';

/**
 * Date range preset options
 */
export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'custom';

/**
 * Trend direction indicator
 */
export type TrendDirection = 'up' | 'down' | 'flat' | 'stable';

// ============================================
// Core Usage Types
// ============================================

/**
 * Record of token usage for a single agent session.
 *
 * This is the atomic unit of tracking - one record per agent session.
 * Multiple records may exist for a single spec (planner + coder + qa).
 */
export interface TokenUsageRecord {
  /** Identifier for the spec (e.g., "025-token-usage") */
  specId: string;
  /** Unique identifier for this session */
  sessionId: string;
  /** Type of agent that ran this session */
  agentType: AgentType;
  /** Number of input tokens consumed */
  inputTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
  /** Number of extended thinking tokens (billed as output) */
  thinkingTokens: number;
  /** Number of tokens served from cache (90% cheaper) */
  cacheHitTokens: number;
  /** When the session completed (ISO 8601 format) */
  timestamp: string;
  /** Claude model used (e.g., "claude-sonnet-4-5-20250929") */
  modelName: string;
  /** Session outcome */
  outcome: SessionOutcome;
  /** Session duration in seconds */
  durationSeconds?: number;
  /** Number of files loaded as context */
  contextFilesCount?: number;
  /** Subtask being worked on, if applicable */
  subtaskId?: string;
  /** Total tokens (input + output + thinking) */
  totalTokens?: number;
  /** Calculated cost in USD */
  costUsd?: number;
}

/**
 * Usage breakdown for a specific agent type.
 *
 * Used to show how much each agent type (planner/coder/qa) contributes
 * to total token usage and cost.
 */
export interface AgentUsageBreakdown {
  /** The agent type this breakdown represents */
  agentType: AgentType;
  /** Number of sessions for this agent type */
  sessionCount: number;
  /** Sum of input tokens across all sessions */
  totalInputTokens: number;
  /** Sum of output tokens across all sessions */
  totalOutputTokens: number;
  /** Sum of thinking tokens across all sessions */
  totalThinkingTokens: number;
  /** Sum of cache hit tokens across all sessions */
  totalCacheHitTokens: number;
  /** Total cost in USD for this agent type */
  totalCostUsd: number;
  /** Number of successful sessions */
  successCount: number;
  /** Number of failed/abandoned sessions */
  failureCount: number;
  /** Total tokens for this agent type */
  totalTokens?: number;
  /** Average tokens per session */
  avgTokensPerSession?: number;
  /** Success rate as a percentage (0-100) */
  successRate?: number;
}

/**
 * Aggregated token usage summary over a time period or scope.
 *
 * Used for dashboard display and reporting.
 */
export interface UsageSummary {
  /** Start of the aggregation period (ISO 8601 format) */
  periodStart: string;
  /** End of the aggregation period (ISO 8601 format) */
  periodEnd: string;
  /** Spec ID if scoped to a single spec (null for project-wide) */
  specId?: string | null;
  /** Total number of agent sessions */
  totalSessions: number;
  /** Sum of all input tokens */
  totalInputTokens: number;
  /** Sum of all output tokens */
  totalOutputTokens: number;
  /** Sum of all thinking tokens */
  totalThinkingTokens: number;
  /** Sum of all cache hit tokens */
  totalCacheHitTokens: number;
  /** Total cost in USD */
  totalCostUsd: number;
  /** Number of successful sessions */
  successCount: number;
  /** Number of failed sessions */
  failureCount: number;
  /** Number of unique specs (for project-wide summaries) */
  uniqueSpecs: number;
  /** Total tokens across all types */
  totalTokens?: number;
  /** Average cost per unique spec */
  avgCostPerSpec?: number;
  /** Average tokens per session */
  avgTokensPerSession?: number;
  /** Overall success rate as a percentage (0-100) */
  successRate?: number;
  /** Cache hit rate as a percentage of input tokens (0-100) */
  cacheEfficiency?: number;
  /** Breakdown by agent type */
  agentBreakdown?: Record<string, AgentUsageBreakdown>;
}

/**
 * Token usage for a single day.
 */
export interface DailyUsage {
  /** The date (ISO 8601 format, midnight) */
  date: string;
  /** Total tokens for the day */
  totalTokens: number;
  /** Total cost in USD */
  totalCost: number;
  /** Number of sessions */
  sessionCount: number;
  /** Total input tokens */
  inputTokens: number;
  /** Total output tokens */
  outputTokens: number;
  /** Total thinking tokens */
  thinkingTokens: number;
  /** Total cache hit tokens */
  cacheHitTokens: number;
  /** Number of successful sessions */
  successCount: number;
  /** Number of failed sessions */
  failureCount: number;
}

/**
 * Token usage for a single week.
 */
export interface WeeklyUsage {
  /** Week identifier (YYYY-Www) */
  weekKey: string;
  /** Start date of the week (Monday, ISO 8601) */
  weekStart: string;
  /** End date of the week (Sunday, ISO 8601) */
  weekEnd: string;
  /** Total tokens for the week */
  totalTokens: number;
  /** Total cost in USD */
  totalCost: number;
  /** Number of sessions */
  sessionCount: number;
  /** Total input tokens */
  inputTokens: number;
  /** Total output tokens */
  outputTokens: number;
  /** Total thinking tokens */
  thinkingTokens: number;
  /** Total cache hit tokens */
  cacheHitTokens: number;
  /** Number of successful sessions */
  successCount: number;
  /** Number of failed sessions */
  failureCount: number;
}

/**
 * Token usage for a single month.
 */
export interface MonthlyUsage {
  /** Month identifier (YYYY-MM) */
  month: string;
  /** Human-readable month name (e.g., "January 2024") */
  monthName: string;
  /** Total tokens for the month */
  totalTokens: number;
  /** Total cost in USD */
  totalCost: number;
  /** Number of sessions */
  sessionCount: number;
  /** Total input tokens */
  inputTokens: number;
  /** Total output tokens */
  outputTokens: number;
  /** Total thinking tokens */
  thinkingTokens: number;
  /** Total cache hit tokens */
  cacheHitTokens: number;
  /** Number of successful sessions */
  successCount: number;
  /** Number of failed sessions */
  failureCount: number;
}

/**
 * Token usage for a single spec.
 */
export interface SpecUsageRecord {
  /** The spec identifier */
  specId: string;
  /** Human-readable spec name */
  specName?: string;
  /** Total tokens for the spec */
  totalTokens: number;
  /** Total cost in USD */
  totalCost: number;
  /** Number of sessions */
  sessionCount: number;
  /** Total input tokens */
  inputTokens: number;
  /** Total output tokens */
  outputTokens: number;
  /** Total thinking tokens */
  thinkingTokens: number;
  /** Total cache hit tokens */
  cacheHitTokens: number;
  /** Number of successful sessions */
  successCount: number;
  /** Number of failed sessions */
  failureCount: number;
  /** Timestamp of first session (ISO 8601) */
  firstSession?: string | null;
  /** Timestamp of most recent session (ISO 8601) */
  lastSession?: string | null;
  /** Average tokens per session */
  avgTokensPerSession?: number;
  /** Success rate as percentage (0-100) */
  successRate?: number;
  /** Usage breakdown by agent type (agent_type -> session count) */
  agentBreakdown?: Record<string, number>;
}

// ============================================
// Filter and Options Types
// ============================================

/**
 * Date range filter for usage queries.
 */
export interface DateRangeFilter {
  /** Preset date range option */
  preset: DateRangePreset;
  /** Custom start date (ISO 8601 format) - used when preset is 'custom' */
  startDate?: string;
  /** Custom end date (ISO 8601 format) - used when preset is 'custom' */
  endDate?: string;
}

/**
 * Options for exporting usage reports.
 */
export interface ExportOptions {
  /** Output file path (if not provided, returns CSV content) */
  outputPath?: string;
  /** Start date for filtering (ISO 8601 format) */
  startDate?: string;
  /** End date for filtering (ISO 8601 format) */
  endDate?: string;
  /** Filter by specific spec ID */
  specId?: string;
  /** Include summary row with totals */
  includeSummary?: boolean;
  /** Export format (currently only CSV supported) */
  format?: 'csv';
}

// ============================================
// Efficiency and Metrics Types
// ============================================

/**
 * Trend comparison between two periods.
 */
export interface UsageTrend {
  /** Value for the current period */
  currentValue: number;
  /** Value for the previous period */
  previousValue: number;
  /** Absolute change (current - previous) */
  changeAbsolute: number;
  /** Percentage change ((current - previous) / previous * 100) */
  changePercentage: number;
  /** Direction of the trend */
  trendDirection: TrendDirection;
}

/**
 * Efficiency metrics for usage analysis.
 *
 * The overall efficiency score (0-100) is computed from:
 * - Success rate (weight: 40%)
 * - Cache efficiency (weight: 30%)
 * - Token efficiency (weight: 30%)
 */
export interface EfficiencyMetrics {
  /** Combined efficiency score (0-100) */
  overallScore: number;
  /** Session success rate (0-100) */
  successRate: number;
  /** Cache hit rate (0-100) */
  cacheEfficiency: number;
  /** Tokens per successful spec normalized (0-100, higher is better) */
  tokenEfficiency: number;
  /** Total sessions analyzed */
  totalSessions: number;
  /** Number of specs completed successfully */
  successfulSpecs: number;
  /** Human-readable rating */
  rating?: 'excellent' | 'good' | 'average' | 'needs_improvement' | 'poor';
}

/**
 * Cost breakdown by model type.
 */
export interface ModelCostBreakdown {
  /** Model name */
  modelName: string;
  /** Input cost in USD */
  inputCost: number;
  /** Output cost in USD */
  outputCost: number;
  /** Thinking cost in USD (billed as output) */
  thinkingCost: number;
  /** Cache savings in USD */
  cacheSavings: number;
  /** Total cost in USD */
  totalCost: number;
  /** Session count for this model */
  sessionCount: number;
}

// ============================================
// Dashboard State Types
// ============================================

/**
 * Usage dashboard view tabs.
 */
export type UsageDashboardTab = 'overview' | 'trends' | 'agents' | 'specs';

/**
 * Dashboard loading states.
 */
export interface UsageDashboardState {
  /** Current active tab */
  activeTab: UsageDashboardTab;
  /** Selected date range filter */
  dateRange: DateRangeFilter;
  /** Loading state for different data sections */
  loading: {
    summary: boolean;
    trends: boolean;
    agents: boolean;
    specs: boolean;
  };
  /** Error messages for different sections */
  errors: {
    summary?: string;
    trends?: string;
    agents?: string;
    specs?: string;
  };
}

/**
 * Chart data point for usage visualization.
 */
export interface UsageChartDataPoint {
  /** Date or period label */
  label: string;
  /** Token count */
  tokens: number;
  /** Cost in USD */
  cost: number;
  /** Number of sessions */
  sessions?: number;
}

/**
 * Pie/donut chart data for agent breakdown.
 */
export interface AgentChartDataPoint {
  /** Agent type label */
  name: string;
  /** Value (tokens or cost) */
  value: number;
  /** Percentage of total */
  percentage: number;
  /** Color for the segment */
  color: string;
}
