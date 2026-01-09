/**
 * Usage Chart Component
 *
 * Area/line chart displaying daily token usage and cost trends.
 * Supports toggling between tokens and cost views with detailed tooltips.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { Loader2, BarChart3, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import {
  formatUSD,
  formatTokenCount,
  formatCompactUSD,
  formatCompactTokens
} from '../../../shared/utils/format-currency';
import type { DailyUsage } from '../../../shared/types/usage';

// ============================================
// Types
// ============================================

export type ChartViewMode = 'tokens' | 'cost' | 'both';

interface UsageChartProps {
  /** Daily usage data to display */
  data: DailyUsage[];
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Chart height in pixels (default: 300) */
  height?: number;
  /** Whether to show the view toggle (default: true) */
  showToggle?: boolean;
  /** Initial view mode (default: 'both') */
  initialViewMode?: ChartViewMode;
  /** Callback when view mode changes */
  onViewModeChange?: (mode: ChartViewMode) => void;
}

interface ChartDataPoint {
  /** Display label for the date */
  label: string;
  /** Full date string for tooltip */
  fullDate: string;
  /** Token count */
  tokens: number;
  /** Cost in USD */
  cost: number;
  /** Number of sessions */
  sessions: number;
  /** Original date for sorting */
  date: string;
}

// ============================================
// Constants
// ============================================

/** Chart colors for light and dark themes */
const CHART_COLORS = {
  tokens: {
    stroke: 'hsl(221, 83%, 53%)', // blue-500
    fill: 'hsl(221, 83%, 53%)',
    fillOpacity: 0.3
  },
  cost: {
    stroke: 'hsl(142, 71%, 45%)', // green-500
    fill: 'hsl(142, 71%, 45%)',
    fillOpacity: 0.3
  },
  grid: 'hsl(var(--border))',
  axis: 'hsl(var(--muted-foreground))',
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
 * Format date for display on X-axis
 */
function formatDateLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

/**
 * Format date for tooltip display
 */
function formatFullDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

/**
 * Transform daily usage data for chart display
 */
function transformData(data: DailyUsage[]): ChartDataPoint[] {
  return data
    .map((day) => ({
      label: formatDateLabel(day.date),
      fullDate: formatFullDate(day.date),
      tokens: day.totalTokens,
      cost: day.totalCost,
      sessions: day.sessionCount,
      date: day.date
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ============================================
// Custom Tooltip Component
// ============================================

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    dataKey: string;
    color: string;
    payload: ChartDataPoint;
  }>;
  label?: string;
  viewMode: ChartViewMode;
  t: (key: string) => string;
}

function CustomTooltip({
  active,
  payload,
  viewMode,
  t
}: CustomTooltipProps) {
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
      <p className="mb-2 text-sm font-medium text-foreground">{data.fullDate}</p>
      <div className="space-y-1 text-sm">
        {(viewMode === 'tokens' || viewMode === 'both') && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: CHART_COLORS.tokens.stroke }}
              />
              {t('chart.tokens')}
            </span>
            <span className="font-medium text-foreground">
              {formatTokenCount(data.tokens)}
            </span>
          </div>
        )}
        {(viewMode === 'cost' || viewMode === 'both') && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: CHART_COLORS.cost.stroke }}
              />
              {t('chart.cost')}
            </span>
            <span className="font-medium text-foreground">{formatUSD(data.cost)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t border-border pt-1">
          <span className="text-muted-foreground">{t('chart.sessions')}</span>
          <span className="font-medium text-foreground">{data.sessions}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// View Mode Toggle Component
// ============================================

interface ViewModeToggleProps {
  viewMode: ChartViewMode;
  onViewModeChange: (mode: ChartViewMode) => void;
  t: (key: string) => string;
}

function ViewModeToggle({ viewMode, onViewModeChange, t }: ViewModeToggleProps) {
  const modes: { value: ChartViewMode; label: string }[] = [
    { value: 'both', label: t('chart.viewModes.both') },
    { value: 'tokens', label: t('chart.viewModes.tokens') },
    { value: 'cost', label: t('chart.viewModes.cost') }
  ];

  return (
    <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
      {modes.map((mode) => (
        <Button
          key={mode.value}
          variant={viewMode === mode.value ? 'secondary' : 'ghost'}
          size="sm"
          className={cn(
            'h-7 px-3 text-xs',
            viewMode === mode.value && 'bg-background shadow-sm'
          )}
          onClick={() => onViewModeChange(mode.value)}
        >
          {mode.label}
        </Button>
      ))}
    </div>
  );
}

// ============================================
// Custom Legend Component
// ============================================

interface CustomLegendProps {
  viewMode: ChartViewMode;
  t: (key: string) => string;
}

function CustomLegend({ viewMode, t }: CustomLegendProps) {
  return (
    <div className="flex justify-center gap-6 pt-2">
      {(viewMode === 'tokens' || viewMode === 'both') && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: CHART_COLORS.tokens.stroke }}
          />
          <span>{t('chart.legendTokens')}</span>
        </div>
      )}
      {(viewMode === 'cost' || viewMode === 'both') && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: CHART_COLORS.cost.stroke }}
          />
          <span>{t('chart.legendCost')}</span>
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function UsageChart({
  data,
  isLoading = false,
  className,
  height = 300,
  showToggle = true,
  initialViewMode = 'both',
  onViewModeChange
}: UsageChartProps) {
  const { t } = useTranslation('usage');
  const [viewMode, setViewMode] = useState<ChartViewMode>(initialViewMode);

  // Transform data for chart
  const chartData = useMemo(() => transformData(data), [data]);

  // Calculate max values for dual Y-axis scaling
  const maxTokens = useMemo(
    () => Math.max(...chartData.map((d) => d.tokens), 0),
    [chartData]
  );
  const maxCost = useMemo(
    () => Math.max(...chartData.map((d) => d.cost), 0),
    [chartData]
  );

  // Handle view mode change
  const handleViewModeChange = (mode: ChartViewMode) => {
    setViewMode(mode);
    onViewModeChange?.(mode);
  };

  // Empty state
  if (!isLoading && chartData.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            {t('chart.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ height }}
          >
            <BarChart3 className="mb-2 h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t('chart.noData')}</p>
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
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            {t('chart.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex items-center justify-center"
            style={{ height }}
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
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          {t('chart.title')}
        </CardTitle>
        {showToggle && (
          <ViewModeToggle
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            t={t}
          />
        )}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={CHART_COLORS.tokens.fill}
                  stopOpacity={0.4}
                />
                <stop
                  offset="95%"
                  stopColor={CHART_COLORS.tokens.fill}
                  stopOpacity={0}
                />
              </linearGradient>
              <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={CHART_COLORS.cost.fill}
                  stopOpacity={0.4}
                />
                <stop
                  offset="95%"
                  stopColor={CHART_COLORS.cost.fill}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={CHART_COLORS.grid}
              strokeOpacity={0.5}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              stroke={CHART_COLORS.axis}
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: CHART_COLORS.grid }}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            {/* Tokens Y-axis (left) */}
            {(viewMode === 'tokens' || viewMode === 'both') && (
              <YAxis
                yAxisId="tokens"
                stroke={CHART_COLORS.axis}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatCompactTokens(value)}
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                domain={[0, maxTokens * 1.1 || 'auto']}
                width={60}
              />
            )}
            {/* Cost Y-axis (right) */}
            {(viewMode === 'cost' || viewMode === 'both') && (
              <YAxis
                yAxisId="cost"
                orientation="right"
                stroke={CHART_COLORS.axis}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatCompactUSD(value)}
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                domain={[0, maxCost * 1.1 || 'auto']}
                width={60}
              />
            )}
            <Tooltip
              content={
                <CustomTooltip
                  viewMode={viewMode}
                  t={t}
                />
              }
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.3 }}
            />
            <Legend content={<CustomLegend viewMode={viewMode} t={t} />} />
            {/* Tokens Area */}
            {(viewMode === 'tokens' || viewMode === 'both') && (
              <Area
                type="monotone"
                dataKey="tokens"
                yAxisId="tokens"
                stroke={CHART_COLORS.tokens.stroke}
                strokeWidth={2}
                fill="url(#tokenGradient)"
                name={t('chart.legendTokens')}
                animationDuration={500}
                animationEasing="ease-out"
              />
            )}
            {/* Cost Area */}
            {(viewMode === 'cost' || viewMode === 'both') && (
              <Area
                type="monotone"
                dataKey="cost"
                yAxisId="cost"
                stroke={CHART_COLORS.cost.stroke}
                strokeWidth={2}
                fill="url(#costGradient)"
                name={t('chart.legendCost')}
                animationDuration={500}
                animationEasing="ease-out"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default UsageChart;
