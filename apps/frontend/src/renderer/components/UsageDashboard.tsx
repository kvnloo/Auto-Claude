/**
 * Token Usage & Cost Dashboard
 *
 * Main dashboard component for viewing token usage, cost estimates,
 * and efficiency metrics across specs and agent sessions.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Download,
  Coins,
  Zap,
  BarChart3,
  Calendar,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { cn } from '../lib/utils';
import {
  useUsageStore,
  loadAllUsageData,
  setDateRangeAndReload,
  exportReport
} from '../stores/usage-store';
import {
  formatUSD,
  formatTokenCount,
  formatPercentage
} from '../../shared/utils/format-currency';
import type {
  UsageDashboardTab,
  DateRangePreset,
  TrendDirection
} from '../../shared/types/usage';

// ============================================
// Types
// ============================================

interface UsageDashboardProps {
  projectId: string;
}

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: {
    direction: TrendDirection;
    value: string;
  };
  icon: React.ReactNode;
  iconBgColor: string;
  isLoading?: boolean;
}

// ============================================
// Helper Components
// ============================================

/**
 * Trend indicator component
 */
function TrendIndicator({
  direction,
  value
}: {
  direction: TrendDirection;
  value: string;
}) {
  const getDirectionStyles = () => {
    switch (direction) {
      case 'up':
        return {
          icon: TrendingUp,
          color: 'text-green-500',
          bgColor: 'bg-green-500/10'
        };
      case 'down':
        return {
          icon: TrendingDown,
          color: 'text-red-500',
          bgColor: 'bg-red-500/10'
        };
      default:
        return {
          icon: Minus,
          color: 'text-muted-foreground',
          bgColor: 'bg-muted'
        };
    }
  };

  const { icon: Icon, color, bgColor } = getDirectionStyles();

  return (
    <div className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', bgColor)}>
      <Icon className={cn('h-3 w-3', color)} />
      <span className={color}>{value}</span>
    </div>
  );
}

/**
 * Metric card for displaying key stats
 */
function MetricCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  iconBgColor,
  isLoading
}: MetricCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {isLoading ? (
              <div className="flex h-8 items-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold tracking-tight">{value}</p>
                {subtitle && (
                  <p className="text-xs text-muted-foreground">{subtitle}</p>
                )}
                {trend && (
                  <TrendIndicator direction={trend.direction} value={trend.value} />
                )}
              </>
            )}
          </div>
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              iconBgColor
            )}
          >
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Date range preset selector
 */
function DateRangeSelector({
  currentPreset,
  onSelectPreset,
  disabled
}: {
  currentPreset: DateRangePreset;
  onSelectPreset: (preset: DateRangePreset) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('usage');

  const presets: { value: DateRangePreset; label: string }[] = [
    { value: 'today', label: t('dateRange.today') },
    { value: 'last7days', label: t('dateRange.last7days') },
    { value: 'last30days', label: t('dateRange.last30days') },
    { value: 'thisMonth', label: t('dateRange.thisMonth') }
  ];

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <div className="flex gap-1">
        {presets.map((preset) => (
          <Button
            key={preset.value}
            variant={currentPreset === preset.value ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 text-xs"
            onClick={() => onSelectPreset(preset.value)}
            disabled={disabled}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function UsageDashboard({ projectId }: UsageDashboardProps) {
  const { t } = useTranslation(['usage', 'common']);
  const [activeTab, setActiveTab] = useState<UsageDashboardTab>('overview');
  const [isExporting, setIsExporting] = useState(false);

  // Store state
  const currentUsage = useUsageStore((state) => state.currentUsage);
  const efficiency = useUsageStore((state) => state.efficiency);
  const costTrend = useUsageStore((state) => state.costTrend);
  const tokenTrend = useUsageStore((state) => state.tokenTrend);
  const loading = useUsageStore((state) => state.loading);
  const errors = useUsageStore((state) => state.errors);
  const dateRange = useUsageStore((state) => state.dateRange);

  // Load data on mount
  useEffect(() => {
    loadAllUsageData(projectId);
  }, [projectId]);

  // Handle date range change
  const handleDateRangeChange = async (preset: DateRangePreset) => {
    await setDateRangeAndReload(projectId, { preset });
  };

  // Handle export
  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportReport(projectId, { includeSummary: true });
      // The export result is stored in the store
    } finally {
      setIsExporting(false);
    }
  };

  // Handle refresh
  const handleRefresh = () => {
    loadAllUsageData(projectId);
  };

  // Compute display values
  const totalCost = currentUsage?.totalCostUsd ?? 0;
  const avgCostPerSpec =
    currentUsage && currentUsage.uniqueSpecs > 0
      ? totalCost / currentUsage.uniqueSpecs
      : 0;
  const totalTokens = currentUsage?.totalTokens ?? 0;
  const efficiencyScore = efficiency?.overallScore ?? 0;

  // Format trend values
  const formatTrendValue = (trend: typeof costTrend, type: 'cost' | 'tokens') => {
    if (!trend || trend.changePercentage === 0) {
      return null;
    }
    const direction: TrendDirection =
      trend.trendDirection === 'flat' ? 'stable' : trend.trendDirection;
    const value =
      type === 'cost'
        ? `${trend.changePercentage > 0 ? '+' : ''}${trend.changePercentage.toFixed(1)}%`
        : `${trend.changePercentage > 0 ? '+' : ''}${formatTokenCount(trend.changeAbsolute)}`;
    return { direction, value };
  };

  const isAnyLoading = Object.values(loading).some(Boolean);
  const hasError = errors.summary !== null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">
                {t('usage:title')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('usage:subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <DateRangeSelector
              currentPreset={dateRange.preset}
              onSelectPreset={handleDateRangeChange}
              disabled={isAnyLoading}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isAnyLoading}
            >
              <RefreshCw
                className={cn('mr-2 h-4 w-4', isAnyLoading && 'animate-spin')}
              />
              {t('common:buttons.refresh')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={isExporting || isAnyLoading}
            >
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {t('usage:actions.export')}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {/* Error Banner */}
          {hasError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errors.summary}</span>
            </div>
          )}

          {/* Hero Metrics Row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title={t('usage:metrics.totalCost')}
              value={formatUSD(totalCost)}
              subtitle={t('usage:metrics.inPeriod')}
              trend={formatTrendValue(costTrend, 'cost') ?? undefined}
              icon={<DollarSign className="h-5 w-5 text-green-500" />}
              iconBgColor="bg-green-500/10"
              isLoading={loading.summary}
            />
            <MetricCard
              title={t('usage:metrics.avgCostPerSpec')}
              value={formatUSD(avgCostPerSpec)}
              subtitle={
                currentUsage?.uniqueSpecs
                  ? t('usage:metrics.specsCount', { count: currentUsage.uniqueSpecs })
                  : undefined
              }
              icon={<Coins className="h-5 w-5 text-amber-500" />}
              iconBgColor="bg-amber-500/10"
              isLoading={loading.summary}
            />
            <MetricCard
              title={t('usage:metrics.totalTokens')}
              value={formatTokenCount(totalTokens)}
              subtitle={t('usage:metrics.sessionsCount', {
                count: currentUsage?.totalSessions ?? 0
              })}
              trend={formatTrendValue(tokenTrend, 'tokens') ?? undefined}
              icon={<BarChart3 className="h-5 w-5 text-blue-500" />}
              iconBgColor="bg-blue-500/10"
              isLoading={loading.summary}
            />
            <MetricCard
              title={t('usage:metrics.efficiencyScore')}
              value={formatPercentage(efficiencyScore / 100, { precision: 0 })}
              subtitle={
                efficiency?.rating
                  ? t(`usage:efficiency.rating.${efficiency.rating}`)
                  : undefined
              }
              icon={<Zap className="h-5 w-5 text-purple-500" />}
              iconBgColor="bg-purple-500/10"
              isLoading={loading.summary}
            />
          </div>

          {/* Tabs for Detailed Views */}
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as UsageDashboardTab)}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
              <TabsTrigger value="overview">
                {t('usage:tabs.overview')}
              </TabsTrigger>
              <TabsTrigger value="trends">
                {t('usage:tabs.trends')}
              </TabsTrigger>
              <TabsTrigger value="agents">
                {t('usage:tabs.agents')}
              </TabsTrigger>
              <TabsTrigger value="specs">
                {t('usage:tabs.specs')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('usage:overview.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading.summary ? (
                    <div className="flex h-48 items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : currentUsage ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium text-muted-foreground">
                            {t('usage:overview.tokenBreakdown')}
                          </h4>
                          <div className="rounded-lg bg-muted p-4">
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span>{t('usage:overview.inputTokens')}</span>
                                <span className="font-medium">
                                  {formatTokenCount(currentUsage.totalInputTokens)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>{t('usage:overview.outputTokens')}</span>
                                <span className="font-medium">
                                  {formatTokenCount(currentUsage.totalOutputTokens)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>{t('usage:overview.thinkingTokens')}</span>
                                <span className="font-medium">
                                  {formatTokenCount(currentUsage.totalThinkingTokens)}
                                </span>
                              </div>
                              <div className="flex justify-between border-t border-border pt-2">
                                <span>{t('usage:overview.cacheHits')}</span>
                                <span className="font-medium text-green-500">
                                  {formatTokenCount(currentUsage.totalCacheHitTokens)} saved
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium text-muted-foreground">
                            {t('usage:overview.sessionStats')}
                          </h4>
                          <div className="rounded-lg bg-muted p-4">
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span>{t('usage:overview.totalSessions')}</span>
                                <span className="font-medium">
                                  {currentUsage.totalSessions}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>{t('usage:overview.successfulSessions')}</span>
                                <span className="font-medium text-green-500">
                                  {currentUsage.successCount}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>{t('usage:overview.failedSessions')}</span>
                                <span className="font-medium text-red-500">
                                  {currentUsage.failureCount}
                                </span>
                              </div>
                              <div className="flex justify-between border-t border-border pt-2">
                                <span>{t('usage:overview.successRate')}</span>
                                <span className="font-medium">
                                  {formatPercentage(
                                    (currentUsage.successRate ?? 0) / 100,
                                    { precision: 1 }
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-48 flex-col items-center justify-center text-center">
                      <BarChart3 className="mb-2 h-12 w-12 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">
                        {t('usage:overview.noData')}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="trends" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('usage:trends.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex h-48 flex-col items-center justify-center text-center">
                    <TrendingUp className="mb-2 h-12 w-12 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      {t('usage:trends.chartPlaceholder')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="agents" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('usage:agents.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex h-48 flex-col items-center justify-center text-center">
                    <Zap className="mb-2 h-12 w-12 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      {t('usage:agents.chartPlaceholder')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="specs" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('usage:specs.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex h-48 flex-col items-center justify-center text-center">
                    <BarChart3 className="mb-2 h-12 w-12 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      {t('usage:specs.tablePlaceholder')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
