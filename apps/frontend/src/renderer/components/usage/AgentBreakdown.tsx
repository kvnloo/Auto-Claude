/**
 * Agent Breakdown Component
 *
 * Displays a donut/pie chart and breakdown cards showing token usage
 * distribution by agent type (Planner, Coder, QA, etc.).
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend
} from 'recharts';
import { Loader2, PieChart as PieChartIcon, Bot, Cpu, CheckCircle2, Wrench } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../../lib/utils';
import {
  formatUSD,
  formatTokenCount,
  formatPercentage
} from '../../../shared/utils/format-currency';
import type { AgentUsageBreakdown, AgentType } from '../../../shared/types/usage';

// ============================================
// Types
// ============================================

interface AgentBreakdownProps {
  /** Agent breakdown data to display */
  data: AgentUsageBreakdown[];
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Chart height in pixels (default: 280) */
  chartHeight?: number;
  /** Whether to show breakdown cards (default: true) */
  showCards?: boolean;
}

interface ChartDataPoint {
  /** Agent type display name */
  name: string;
  /** Agent type key */
  agentType: AgentType;
  /** Token count */
  tokens: number;
  /** Cost in USD */
  cost: number;
  /** Number of sessions */
  sessions: number;
  /** Percentage of total */
  percentage: number;
  /** Color for the segment */
  color: string;
  /** Index signature for recharts compatibility */
  [key: string]: string | number | AgentType;
}

// ============================================
// Constants
// ============================================

/** Color mapping for each agent type */
const AGENT_COLORS: Record<string, string> = {
  planner: 'hsl(221, 83%, 53%)',      // blue-500
  coder: 'hsl(142, 71%, 45%)',        // green-500
  qa_reviewer: 'hsl(45, 93%, 47%)',   // amber-500
  qa_fixer: 'hsl(24, 95%, 53%)',      // orange-500
  spec_gatherer: 'hsl(262, 83%, 58%)', // purple-500
  spec_researcher: 'hsl(330, 81%, 60%)', // pink-500
  spec_writer: 'hsl(174, 84%, 40%)',  // teal-500
  spec_critic: 'hsl(14, 100%, 57%)',  // red-500
  spec_discovery: 'hsl(199, 89%, 48%)', // cyan-500
  spec_context: 'hsl(250, 65%, 60%)', // indigo-500
  spec_validation: 'hsl(160, 60%, 45%)', // emerald-500
  insights: 'hsl(280, 65%, 55%)',     // violet-500
  pr_reviewer: 'hsl(210, 80%, 50%)',  // sky-500
  analysis: 'hsl(35, 92%, 50%)',      // yellow-600
  unknown: 'hsl(var(--muted-foreground))' // gray
};

/** Icon mapping for each agent type */
const AGENT_ICONS: Record<string, typeof Bot> = {
  planner: Bot,
  coder: Cpu,
  qa_reviewer: CheckCircle2,
  qa_fixer: Wrench,
  // Default to Bot for other types
};

/** Chart tooltip/legend colors */
const CHART_COLORS = {
  tooltip: {
    background: 'hsl(var(--card))',
    border: 'hsl(var(--border))',
    text: 'hsl(var(--foreground))',
    label: 'hsl(var(--muted-foreground))'
  }
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get display name for an agent type
 */
function getAgentDisplayName(agentType: string, t: (key: string) => string): string {
  const key = `agentBreakdown.agentNames.${agentType}`;
  const translated = t(key);
  // If translation is the same as the key, it wasn't found - use formatted fallback
  if (translated === key) {
    return agentType
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  return translated;
}

/**
 * Get color for an agent type
 */
function getAgentColor(agentType: string): string {
  return AGENT_COLORS[agentType] || AGENT_COLORS.unknown;
}

/**
 * Get icon for an agent type
 */
function getAgentIcon(agentType: string): typeof Bot {
  return AGENT_ICONS[agentType] || Bot;
}

/**
 * Transform agent breakdown data for chart display
 */
function transformData(
  data: AgentUsageBreakdown[],
  t: (key: string) => string
): ChartDataPoint[] {
  const totalTokens = data.reduce((sum, agent) => sum + (agent.totalTokens || 0), 0);

  return data
    .filter((agent) => (agent.totalTokens || 0) > 0)
    .map((agent) => ({
      name: getAgentDisplayName(agent.agentType, t),
      agentType: agent.agentType,
      tokens: agent.totalTokens || 0,
      cost: agent.totalCostUsd,
      sessions: agent.sessionCount,
      percentage: totalTokens > 0 ? ((agent.totalTokens || 0) / totalTokens) * 100 : 0,
      color: getAgentColor(agent.agentType)
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

// ============================================
// Custom Tooltip Component
// ============================================

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    dataKey: string;
    payload: ChartDataPoint;
  }>;
  t: (key: string) => string;
}

function CustomTooltip({ active, payload, t }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0]?.payload;
  if (!data) {
    return null;
  }

  return (
    <div
      className="rounded-lg border bg-card p-3 shadow-lg"
      style={{
        backgroundColor: CHART_COLORS.tooltip.background,
        borderColor: CHART_COLORS.tooltip.border
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: data.color }}
        />
        <span className="text-sm font-medium text-foreground">{data.name}</span>
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t('agentBreakdown.tooltip.tokens')}</span>
          <span className="font-medium text-foreground">{formatTokenCount(data.tokens)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t('agentBreakdown.tooltip.cost')}</span>
          <span className="font-medium text-foreground">{formatUSD(data.cost)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t('agentBreakdown.tooltip.sessions')}</span>
          <span className="font-medium text-foreground">{data.sessions}</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-1">
          <span className="text-muted-foreground">{t('agentBreakdown.tooltip.percentage')}</span>
          <span className="font-medium text-foreground">
            {formatPercentage(data.percentage / 100)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Custom Legend Component
// ============================================

interface CustomLegendProps {
  data: ChartDataPoint[];
}

function CustomLegend({ data }: CustomLegendProps) {
  if (data.length === 0) return null;

  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2">
      {data.map((item) => (
        <div key={item.agentType} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span>{item.name}</span>
          <span className="text-muted-foreground/60">({formatPercentage(item.percentage / 100, { precision: 0 })})</span>
        </div>
      ))}
    </div>
  );
}

// ============================================
// Agent Card Component
// ============================================

interface AgentCardProps {
  data: ChartDataPoint;
  t: (key: string) => string;
}

function AgentCard({ data, t }: AgentCardProps) {
  const Icon = getAgentIcon(data.agentType);

  return (
    <div
      className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
      style={{ borderLeftColor: data.color, borderLeftWidth: 3 }}
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${data.color}20` }}
      >
        <Icon className="h-5 w-5" style={{ color: data.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">{data.name}</span>
          <span
            className="shrink-0 text-xs font-medium"
            style={{ color: data.color }}
          >
            {formatPercentage(data.percentage / 100, { precision: 1 })}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatTokenCount(data.tokens)} {t('agentBreakdown.card.tokens')}</span>
          <span className="text-muted-foreground/40">•</span>
          <span>{formatUSD(data.cost)}</span>
          <span className="text-muted-foreground/40">•</span>
          <span>{data.sessions} {t('agentBreakdown.card.sessions')}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function AgentBreakdown({
  data,
  isLoading = false,
  className,
  chartHeight = 280,
  showCards = true
}: AgentBreakdownProps) {
  const { t } = useTranslation('usage');

  // Transform data for chart
  const chartData = useMemo(() => transformData(data, t), [data, t]);

  // Calculate totals
  const totals = useMemo(() => {
    const totalTokens = chartData.reduce((sum, d) => sum + d.tokens, 0);
    const totalCost = chartData.reduce((sum, d) => sum + d.cost, 0);
    const totalSessions = chartData.reduce((sum, d) => sum + d.sessions, 0);
    return { totalTokens, totalCost, totalSessions };
  }, [chartData]);

  // Empty state
  if (!isLoading && chartData.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <PieChartIcon className="h-4 w-4 text-muted-foreground" />
            {t('agentBreakdown.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ height: chartHeight }}
          >
            <PieChartIcon className="mb-2 h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t('agentBreakdown.noData')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <PieChartIcon className="h-4 w-4 text-muted-foreground" />
            {t('agentBreakdown.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex items-center justify-center"
            style={{ height: chartHeight }}
          >
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <PieChartIcon className="h-4 w-4 text-muted-foreground" />
          {t('agentBreakdown.title')}
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          {formatTokenCount(totals.totalTokens)} {t('agentBreakdown.totalTokens')}
        </div>
      </CardHeader>
      <CardContent>
        {/* Donut Chart */}
        <ResponsiveContainer width="100%" height={chartHeight}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey="tokens"
              nameKey="name"
              animationDuration={500}
              animationEasing="ease-out"
            >
              {chartData.map((entry) => (
                <Cell
                  key={`cell-${entry.agentType}`}
                  fill={entry.color}
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip t={t} />} />
            <Legend content={<CustomLegend data={chartData} />} />
            {/* Center label */}
            <text
              x="50%"
              y="46%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-foreground text-xl font-semibold"
            >
              {formatUSD(totals.totalCost, { precision: 2 })}
            </text>
            <text
              x="50%"
              y="56%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground text-xs"
            >
              {t('agentBreakdown.totalCost')}
            </text>
          </PieChart>
        </ResponsiveContainer>

        {/* Breakdown Cards */}
        {showCards && chartData.length > 0 && (
          <div className="mt-4 space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              {t('agentBreakdown.detailsTitle')}
            </h4>
            <div className="grid gap-2">
              {chartData.map((agent) => (
                <AgentCard key={agent.agentType} data={agent} t={t} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AgentBreakdown;
