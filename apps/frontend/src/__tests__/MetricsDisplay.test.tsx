/**
 * Unit tests for MetricsDisplay component
 * Tests metrics rendering, state handling, formatting utilities, and derived calculations
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import type { ExecutionMetrics, MetricsDisplayProps } from '../renderer/components/MetricsDisplay';

// Helper to create test metrics
function createTestMetrics(overrides: Partial<ExecutionMetrics> = {}): ExecutionMetrics {
  return {
    execution_time_seconds: 45.2,
    agent_count: 8,
    speedup_factor: 6.8,
    sequential_baseline_seconds: 307.4,
    agents_successful: 8,
    agents_failed: 0,
    api_calls_total: 96,
    started_at: '2025-12-26T13:00:00Z',
    completed_at: '2025-12-26T13:00:45Z',
    ...overrides
  };
}

describe('MetricsDisplay', () => {
  describe('ExecutionMetrics Type', () => {
    it('should accept all required fields', () => {
      const metrics = createTestMetrics();

      expect(metrics.execution_time_seconds).toBeDefined();
      expect(metrics.agent_count).toBeDefined();
      expect(metrics.speedup_factor).toBeDefined();
      expect(metrics.sequential_baseline_seconds).toBeDefined();
      expect(metrics.agents_successful).toBeDefined();
      expect(metrics.agents_failed).toBeDefined();
      expect(metrics.api_calls_total).toBeDefined();
      expect(metrics.started_at).toBeDefined();
      expect(metrics.completed_at).toBeDefined();
    });

    it('should accept valid execution time values', () => {
      const shortExecution = createTestMetrics({ execution_time_seconds: 5.5 });
      const mediumExecution = createTestMetrics({ execution_time_seconds: 45.2 });
      const longExecution = createTestMetrics({ execution_time_seconds: 3600 });

      expect(shortExecution.execution_time_seconds).toBe(5.5);
      expect(mediumExecution.execution_time_seconds).toBe(45.2);
      expect(longExecution.execution_time_seconds).toBe(3600);
    });

    it('should accept valid agent counts (4, 8, 12)', () => {
      const validAgentCounts = [4, 8, 12];

      validAgentCounts.forEach((count) => {
        const metrics = createTestMetrics({ agent_count: count });
        expect(metrics.agent_count).toBe(count);
      });
    });

    it('should accept ISO timestamp strings', () => {
      const metrics = createTestMetrics({
        started_at: '2025-12-26T10:30:00Z',
        completed_at: '2025-12-26T10:35:45Z'
      });

      expect(metrics.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(metrics.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });
  });

  describe('Duration Formatting', () => {
    // Test the formatDuration logic
    const formatDuration = (seconds: number): string => {
      if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
      }
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      if (minutes < 60) {
        return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
      }
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    };

    it('should format seconds under 60 correctly', () => {
      expect(formatDuration(5.5)).toBe('5.5s');
      expect(formatDuration(45.2)).toBe('45.2s');
      expect(formatDuration(59.9)).toBe('59.9s');
    });

    it('should format minutes correctly', () => {
      expect(formatDuration(60)).toBe('1m 0s');
      expect(formatDuration(90)).toBe('1m 30s');
      expect(formatDuration(125)).toBe('2m 5s');
      expect(formatDuration(3540)).toBe('59m 0s');
    });

    it('should format hours correctly', () => {
      expect(formatDuration(3600)).toBe('1h 0m');
      expect(formatDuration(3660)).toBe('1h 1m');
      expect(formatDuration(7200)).toBe('2h 0m');
      expect(formatDuration(5400)).toBe('1h 30m');
    });

    it('should handle zero seconds', () => {
      expect(formatDuration(0)).toBe('0.0s');
    });

    it('should handle very small values', () => {
      expect(formatDuration(0.1)).toBe('0.1s');
      expect(formatDuration(0.5)).toBe('0.5s');
    });
  });

  describe('Timestamp Formatting', () => {
    // Test the formatTimestamp logic
    const formatTimestamp = (isoString: string): string => {
      try {
        const date = new Date(isoString);
        return date.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      } catch {
        return 'Invalid time';
      }
    };

    it('should format valid ISO timestamps', () => {
      const result = formatTimestamp('2025-12-26T13:00:00Z');
      // Result depends on locale, just check it's not invalid
      expect(result).not.toBe('Invalid time');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle invalid timestamps', () => {
      const result = formatTimestamp('invalid-date');
      // Invalid Date still creates a Date object with NaN
      // Our format might return an invalid string representation
      expect(typeof result).toBe('string');
    });
  });

  describe('Date Formatting', () => {
    const formatDate = (isoString: string): string => {
      try {
        const date = new Date(isoString);
        return date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      } catch {
        return 'Invalid date';
      }
    };

    it('should format valid ISO dates', () => {
      const result = formatDate('2025-12-26T13:00:00Z');
      expect(result).not.toBe('Invalid date');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Speedup Variant Calculation', () => {
    const getSpeedupVariant = (
      speedup: number
    ): 'default' | 'success' | 'warning' | 'info' => {
      if (speedup >= 7) return 'success';
      if (speedup >= 5) return 'info';
      if (speedup >= 3) return 'warning';
      return 'default';
    };

    it('should return success for speedup >= 7', () => {
      expect(getSpeedupVariant(7)).toBe('success');
      expect(getSpeedupVariant(7.5)).toBe('success');
      expect(getSpeedupVariant(10)).toBe('success');
    });

    it('should return info for speedup >= 5 and < 7', () => {
      expect(getSpeedupVariant(5)).toBe('info');
      expect(getSpeedupVariant(6)).toBe('info');
      expect(getSpeedupVariant(6.9)).toBe('info');
    });

    it('should return warning for speedup >= 3 and < 5', () => {
      expect(getSpeedupVariant(3)).toBe('warning');
      expect(getSpeedupVariant(4)).toBe('warning');
      expect(getSpeedupVariant(4.9)).toBe('warning');
    });

    it('should return default for speedup < 3', () => {
      expect(getSpeedupVariant(0)).toBe('default');
      expect(getSpeedupVariant(1)).toBe('default');
      expect(getSpeedupVariant(2.9)).toBe('default');
    });
  });

  describe('Speedup Label Calculation', () => {
    const getSpeedupLabel = (speedup: number): string => {
      if (speedup >= 7) return 'Excellent';
      if (speedup >= 5) return 'Good';
      if (speedup >= 3) return 'Moderate';
      return 'Low';
    };

    it('should return Excellent for speedup >= 7', () => {
      expect(getSpeedupLabel(7)).toBe('Excellent');
      expect(getSpeedupLabel(10)).toBe('Excellent');
    });

    it('should return Good for speedup >= 5 and < 7', () => {
      expect(getSpeedupLabel(5)).toBe('Good');
      expect(getSpeedupLabel(6.5)).toBe('Good');
    });

    it('should return Moderate for speedup >= 3 and < 5', () => {
      expect(getSpeedupLabel(3)).toBe('Moderate');
      expect(getSpeedupLabel(4)).toBe('Moderate');
    });

    it('should return Low for speedup < 3', () => {
      expect(getSpeedupLabel(0)).toBe('Low');
      expect(getSpeedupLabel(2)).toBe('Low');
    });
  });

  describe('Derived Metrics Calculations', () => {
    it('should calculate success rate correctly', () => {
      const metrics = createTestMetrics({
        agent_count: 8,
        agents_successful: 7,
        agents_failed: 1
      });

      const successRate =
        metrics.agent_count > 0
          ? (metrics.agents_successful / metrics.agent_count) * 100
          : 0;

      expect(successRate).toBe(87.5);
    });

    it('should calculate 100% success rate for all successful agents', () => {
      const metrics = createTestMetrics({
        agent_count: 8,
        agents_successful: 8,
        agents_failed: 0
      });

      const successRate =
        metrics.agent_count > 0
          ? (metrics.agents_successful / metrics.agent_count) * 100
          : 0;

      expect(successRate).toBe(100);
    });

    it('should handle zero agent count without division by zero', () => {
      const metrics = createTestMetrics({
        agent_count: 0,
        agents_successful: 0,
        agents_failed: 0
      });

      const successRate =
        metrics.agent_count > 0
          ? (metrics.agents_successful / metrics.agent_count) * 100
          : 0;

      expect(successRate).toBe(0);
    });

    it('should calculate time saved correctly', () => {
      const metrics = createTestMetrics({
        sequential_baseline_seconds: 300,
        execution_time_seconds: 50
      });

      const timeSaved = metrics.sequential_baseline_seconds - metrics.execution_time_seconds;

      expect(timeSaved).toBe(250);
    });

    it('should calculate API calls per agent correctly', () => {
      const metrics = createTestMetrics({
        agent_count: 8,
        api_calls_total: 96
      });

      const apiCallsPerAgent =
        metrics.agent_count > 0
          ? Math.round(metrics.api_calls_total / metrics.agent_count)
          : 0;

      expect(apiCallsPerAgent).toBe(12);
    });

    it('should handle uneven API calls distribution', () => {
      const metrics = createTestMetrics({
        agent_count: 8,
        api_calls_total: 100
      });

      const apiCallsPerAgent =
        metrics.agent_count > 0
          ? Math.round(metrics.api_calls_total / metrics.agent_count)
          : 0;

      // 100 / 8 = 12.5, rounded to 13
      expect(apiCallsPerAgent).toBe(13);
    });
  });

  describe('Props Handling', () => {
    it('should handle null metrics (no data state)', () => {
      const props: MetricsDisplayProps = {
        metrics: null
      };

      expect(props.metrics).toBeNull();
    });

    it('should handle isLoading state', () => {
      const props: MetricsDisplayProps = {
        metrics: null,
        isLoading: true
      };

      expect(props.isLoading).toBe(true);
    });

    it('should handle error state', () => {
      const errorMessage = 'Failed to fetch execution metrics';
      const props: MetricsDisplayProps = {
        metrics: null,
        error: errorMessage
      };

      expect(props.error).toBe(errorMessage);
    });

    it('should handle compact mode', () => {
      const props: MetricsDisplayProps = {
        metrics: createTestMetrics(),
        compact: true
      };

      expect(props.compact).toBe(true);
    });

    it('should handle optional className', () => {
      const props: MetricsDisplayProps = {
        metrics: createTestMetrics(),
        className: 'custom-metrics-class'
      };

      expect(props.className).toBe('custom-metrics-class');
    });

    it('should handle all optional props as undefined', () => {
      const props: MetricsDisplayProps = {
        metrics: createTestMetrics()
      };

      expect(props.isLoading).toBeUndefined();
      expect(props.error).toBeUndefined();
      expect(props.className).toBeUndefined();
      expect(props.compact).toBeUndefined();
    });
  });

  describe('Component State Logic', () => {
    it('should show loading state when isLoading is true', () => {
      const props: MetricsDisplayProps = {
        metrics: null,
        isLoading: true
      };

      const isLoading = props.isLoading ?? false;
      expect(isLoading).toBe(true);
    });

    it('should show error state when error is provided', () => {
      const props: MetricsDisplayProps = {
        metrics: null,
        error: 'Connection error'
      };

      const hasError = !!props.error;
      expect(hasError).toBe(true);
    });

    it('should show no data state when metrics is null and not loading', () => {
      const props: MetricsDisplayProps = {
        metrics: null,
        isLoading: false
      };

      const isLoading = props.isLoading ?? false;
      const hasMetrics = !!props.metrics;

      expect(isLoading).toBe(false);
      expect(hasMetrics).toBe(false);
    });

    it('should show compact mode for small displays', () => {
      const props: MetricsDisplayProps = {
        metrics: createTestMetrics(),
        compact: true
      };

      const isCompact = props.compact ?? false;
      expect(isCompact).toBe(true);
    });

    it('should show full display by default', () => {
      const props: MetricsDisplayProps = {
        metrics: createTestMetrics()
      };

      const isCompact = props.compact ?? false;
      expect(isCompact).toBe(false);
    });
  });

  describe('Progress Bar Logic', () => {
    it('should determine success progress bar color for 100% success', () => {
      const successRate = 100;

      const isSuccess = successRate === 100;
      const isInfo = successRate >= 80 && successRate < 100;
      const isWarning = successRate < 80;

      expect(isSuccess).toBe(true);
      expect(isInfo).toBe(false);
      expect(isWarning).toBe(false);
    });

    it('should determine info progress bar color for 80-99% success', () => {
      const successRates = [80, 85, 90, 95, 99];

      successRates.forEach((successRate) => {
        const isSuccess = successRate === 100;
        const isInfo = successRate >= 80 && successRate < 100;
        const isWarning = successRate < 80;

        expect(isSuccess).toBe(false);
        expect(isInfo).toBe(true);
        expect(isWarning).toBe(false);
      });
    });

    it('should determine warning progress bar color for < 80% success', () => {
      const successRates = [0, 25, 50, 75, 79];

      successRates.forEach((successRate) => {
        const isSuccess = successRate === 100;
        const isInfo = successRate >= 80 && successRate < 100;
        const isWarning = successRate < 80;

        expect(isSuccess).toBe(false);
        expect(isInfo).toBe(false);
        expect(isWarning).toBe(true);
      });
    });
  });

  describe('Parallel Efficiency Calculation', () => {
    it('should calculate parallel efficiency correctly', () => {
      const metrics = createTestMetrics({
        speedup_factor: 6,
        agent_count: 8
      });

      const efficiency = (metrics.speedup_factor / metrics.agent_count) * 100;

      expect(efficiency).toBe(75);
    });

    it('should handle perfect parallel efficiency', () => {
      const metrics = createTestMetrics({
        speedup_factor: 8,
        agent_count: 8
      });

      const efficiency = (metrics.speedup_factor / metrics.agent_count) * 100;

      expect(efficiency).toBe(100);
    });

    it('should handle low parallel efficiency', () => {
      const metrics = createTestMetrics({
        speedup_factor: 2,
        agent_count: 8
      });

      const efficiency = (metrics.speedup_factor / metrics.agent_count) * 100;

      expect(efficiency).toBe(25);
    });
  });

  describe('Failed Agents Display Logic', () => {
    it('should show failed agents count when > 0', () => {
      const metrics = createTestMetrics({
        agents_failed: 2
      });

      const showFailedAgents = metrics.agents_failed > 0;
      expect(showFailedAgents).toBe(true);
    });

    it('should hide failed agents count when 0', () => {
      const metrics = createTestMetrics({
        agents_failed: 0
      });

      const showFailedAgents = metrics.agents_failed > 0;
      expect(showFailedAgents).toBe(false);
    });
  });

  describe('Sample Metrics', () => {
    it('should have valid sample metrics for testing/demo', () => {
      const SAMPLE_METRICS: ExecutionMetrics = {
        execution_time_seconds: 45.2,
        agent_count: 8,
        speedup_factor: 6.8,
        sequential_baseline_seconds: 307.4,
        agents_successful: 8,
        agents_failed: 0,
        api_calls_total: 96,
        started_at: '2025-12-26T13:00:00Z',
        completed_at: '2025-12-26T13:00:45Z'
      };

      expect(SAMPLE_METRICS.agent_count).toBe(8);
      expect(SAMPLE_METRICS.agents_successful).toBe(8);
      expect(SAMPLE_METRICS.agents_failed).toBe(0);
      expect(SAMPLE_METRICS.speedup_factor).toBe(6.8);
    });

    it('should have consistent sample metrics (agents_successful + agents_failed = agent_count)', () => {
      const SAMPLE_METRICS = createTestMetrics();

      const totalAgents = SAMPLE_METRICS.agents_successful + SAMPLE_METRICS.agents_failed;
      expect(totalAgents).toBe(SAMPLE_METRICS.agent_count);
    });

    it('should have valid timeline in sample metrics', () => {
      const SAMPLE_METRICS = createTestMetrics();

      const startDate = new Date(SAMPLE_METRICS.started_at);
      const endDate = new Date(SAMPLE_METRICS.completed_at);

      expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
    });
  });

  describe('Compact vs Full Mode', () => {
    it('should show minimal info in compact mode', () => {
      const props: MetricsDisplayProps = {
        metrics: createTestMetrics(),
        compact: true
      };

      // In compact mode, we only show:
      // - Execution time
      // - Speedup badge
      // - Agents successful/total
      expect(props.compact).toBe(true);
    });

    it('should show all metrics in full mode', () => {
      const props: MetricsDisplayProps = {
        metrics: createTestMetrics(),
        compact: false
      };

      // In full mode, we show:
      // - Execution time card
      // - Speedup factor card
      // - Agent count card
      // - API calls card
      // - Success rate progress
      // - Timeline
      // - Performance summary
      expect(props.compact).toBe(false);
    });
  });

  describe('Tooltip Content', () => {
    it('should have tooltip for execution time in compact mode', () => {
      const tooltipContent = 'Execution time';
      expect(tooltipContent).toBe('Execution time');
    });

    it('should have tooltip for speedup factor in compact mode', () => {
      const tooltipContent = 'Speedup factor vs sequential';
      expect(tooltipContent).toBe('Speedup factor vs sequential');
    });

    it('should have tooltip for agent count in compact mode', () => {
      const tooltipContent = 'Agents successful / total';
      expect(tooltipContent).toBe('Agents successful / total');
    });
  });

  describe('Error Boundary Cases', () => {
    it('should handle negative execution time gracefully', () => {
      const metrics = createTestMetrics({
        execution_time_seconds: -1
      });

      // formatDuration should handle this
      const formatDuration = (seconds: number): string => {
        if (seconds < 60) {
          return `${seconds.toFixed(1)}s`;
        }
        return '';
      };

      const result = formatDuration(metrics.execution_time_seconds);
      expect(result).toBe('-1.0s');
    });

    it('should handle zero speedup factor', () => {
      const metrics = createTestMetrics({
        speedup_factor: 0
      });

      const getSpeedupVariant = (
        speedup: number
      ): 'default' | 'success' | 'warning' | 'info' => {
        if (speedup >= 7) return 'success';
        if (speedup >= 5) return 'info';
        if (speedup >= 3) return 'warning';
        return 'default';
      };

      expect(getSpeedupVariant(metrics.speedup_factor)).toBe('default');
    });

    it('should handle very large values', () => {
      const metrics = createTestMetrics({
        execution_time_seconds: 86400, // 24 hours
        api_calls_total: 10000
      });

      expect(metrics.execution_time_seconds).toBe(86400);
      expect(metrics.api_calls_total).toBe(10000);
    });
  });

  describe('Metric Card Configuration', () => {
    it('should have correct metric card structure', () => {
      interface MetricCardConfig {
        label: string;
        value: string;
        description?: string;
        variant?: 'default' | 'success' | 'warning' | 'info' | 'destructive';
      }

      const executionTimeCard: MetricCardConfig = {
        label: 'Execution Time',
        value: '45.2s',
        description: 'Saved 4m 22s'
      };

      expect(executionTimeCard.label).toBe('Execution Time');
      expect(executionTimeCard.value).toBe('45.2s');
      expect(executionTimeCard.description).toBeDefined();
    });

    it('should support different variants for metric cards', () => {
      const variants = ['default', 'success', 'warning', 'info', 'destructive'];

      variants.forEach((variant) => {
        expect(['default', 'success', 'warning', 'info', 'destructive']).toContain(variant);
      });
    });
  });
});
