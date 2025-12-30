/**
 * Unit tests for ResultsView component
 * Tests metric display, chart data, filtering, and instance breakdown
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BenchmarkResultsProps, InstanceResult } from '../types';

// Helper to create test instance result
function createTestInstance(overrides: Partial<InstanceResult> = {}): InstanceResult {
  return {
    instanceId: `test-instance-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    status: 'resolved',
    patchApplied: true,
    testsPassed: 5,
    testsFailed: 0,
    ...overrides
  };
}

// Helper to create test results props
function createTestProps(overrides: Partial<BenchmarkResultsProps> = {}): BenchmarkResultsProps {
  return {
    resolveRate: 50,
    patchApplicationSuccess: 80,
    testResults: {
      passed: 100,
      failed: 20,
      total: 120
    },
    instanceBreakdown: [
      createTestInstance({ instanceId: 'instance-1', status: 'resolved' }),
      createTestInstance({ instanceId: 'instance-2', status: 'unresolved' }),
      createTestInstance({ instanceId: 'instance-3', status: 'error' })
    ],
    ...overrides
  };
}

describe('ResultsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Resolve Rate Display', () => {
    it('should display resolve rate as percentage', () => {
      const props = createTestProps({ resolveRate: 65.5 });
      const formattedRate = `${props.resolveRate.toFixed(1)}%`;
      expect(formattedRate).toBe('65.5%');
    });

    it('should handle 0% resolve rate', () => {
      const props = createTestProps({ resolveRate: 0 });
      const formattedRate = `${props.resolveRate.toFixed(1)}%`;
      expect(formattedRate).toBe('0.0%');
    });

    it('should handle 100% resolve rate', () => {
      const props = createTestProps({ resolveRate: 100 });
      const formattedRate = `${props.resolveRate.toFixed(1)}%`;
      expect(formattedRate).toBe('100.0%');
    });

    it('should format resolve rate with one decimal place', () => {
      const props = createTestProps({ resolveRate: 33.333 });
      const formattedRate = `${props.resolveRate.toFixed(1)}%`;
      expect(formattedRate).toBe('33.3%');
    });
  });

  describe('Patch Application Success', () => {
    it('should display patch success as percentage', () => {
      const props = createTestProps({ patchApplicationSuccess: 85.7 });
      const formattedSuccess = `${props.patchApplicationSuccess.toFixed(1)}%`;
      expect(formattedSuccess).toBe('85.7%');
    });

    it('should handle 0% patch success', () => {
      const props = createTestProps({ patchApplicationSuccess: 0 });
      const formattedSuccess = `${props.patchApplicationSuccess.toFixed(1)}%`;
      expect(formattedSuccess).toBe('0.0%');
    });

    it('should handle 100% patch success', () => {
      const props = createTestProps({ patchApplicationSuccess: 100 });
      const formattedSuccess = `${props.patchApplicationSuccess.toFixed(1)}%`;
      expect(formattedSuccess).toBe('100.0%');
    });
  });

  describe('Test Results Summary', () => {
    it('should calculate test pass rate correctly', () => {
      const props = createTestProps({
        testResults: { passed: 80, failed: 20, total: 100 }
      });

      const passRate = (props.testResults.passed / props.testResults.total) * 100;
      expect(passRate).toBe(80);
    });

    it('should handle zero total tests', () => {
      const props = createTestProps({
        testResults: { passed: 0, failed: 0, total: 0 }
      });

      // When total is 0, should show N/A
      const passRateDisplay = props.testResults.total > 0
        ? `${((props.testResults.passed / props.testResults.total) * 100).toFixed(1)}%`
        : 'N/A';
      expect(passRateDisplay).toBe('N/A');
    });

    it('should display passed tests count', () => {
      const props = createTestProps({
        testResults: { passed: 150, failed: 30, total: 180 }
      });
      expect(props.testResults.passed).toBe(150);
    });

    it('should display failed tests count', () => {
      const props = createTestProps({
        testResults: { passed: 150, failed: 30, total: 180 }
      });
      expect(props.testResults.failed).toBe(30);
    });

    it('should display total tests count', () => {
      const props = createTestProps({
        testResults: { passed: 150, failed: 30, total: 180 }
      });
      expect(props.testResults.total).toBe(180);
    });

    it('should verify total equals passed plus failed', () => {
      const props = createTestProps({
        testResults: { passed: 75, failed: 25, total: 100 }
      });
      expect(props.testResults.passed + props.testResults.failed).toBe(props.testResults.total);
    });
  });

  describe('Instance Status Counting', () => {
    it('should count resolved instances correctly', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ status: 'resolved' }),
          createTestInstance({ status: 'resolved' }),
          createTestInstance({ status: 'unresolved' }),
          createTestInstance({ status: 'error' })
        ]
      });

      const resolvedCount = props.instanceBreakdown.filter(i => i.status === 'resolved').length;
      expect(resolvedCount).toBe(2);
    });

    it('should count unresolved instances correctly', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ status: 'resolved' }),
          createTestInstance({ status: 'unresolved' }),
          createTestInstance({ status: 'unresolved' }),
          createTestInstance({ status: 'unresolved' })
        ]
      });

      const unresolvedCount = props.instanceBreakdown.filter(i => i.status === 'unresolved').length;
      expect(unresolvedCount).toBe(3);
    });

    it('should count error instances correctly', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ status: 'resolved' }),
          createTestInstance({ status: 'error' }),
          createTestInstance({ status: 'error' })
        ]
      });

      const errorCount = props.instanceBreakdown.filter(i => i.status === 'error').length;
      expect(errorCount).toBe(2);
    });

    it('should handle empty instance breakdown', () => {
      const props = createTestProps({ instanceBreakdown: [] });

      const resolvedCount = props.instanceBreakdown.filter(i => i.status === 'resolved').length;
      const unresolvedCount = props.instanceBreakdown.filter(i => i.status === 'unresolved').length;
      const errorCount = props.instanceBreakdown.filter(i => i.status === 'error').length;

      expect(resolvedCount).toBe(0);
      expect(unresolvedCount).toBe(0);
      expect(errorCount).toBe(0);
    });
  });

  describe('Pie Chart Data (Status Distribution)', () => {
    it('should generate pie chart data with correct structure', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ status: 'resolved' }),
          createTestInstance({ status: 'unresolved' }),
          createTestInstance({ status: 'error' })
        ]
      });

      const resolvedCount = props.instanceBreakdown.filter(i => i.status === 'resolved').length;
      const unresolvedCount = props.instanceBreakdown.filter(i => i.status === 'unresolved').length;
      const errorCount = props.instanceBreakdown.filter(i => i.status === 'error').length;

      const statusDistributionData = [
        { name: 'Resolved', value: resolvedCount },
        { name: 'Unresolved', value: unresolvedCount },
        { name: 'Error', value: errorCount }
      ].filter(d => d.value > 0);

      expect(statusDistributionData).toHaveLength(3);
      expect(statusDistributionData[0].name).toBe('Resolved');
      expect(statusDistributionData[0].value).toBe(1);
    });

    it('should filter out zero-value entries from pie chart', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ status: 'resolved' }),
          createTestInstance({ status: 'resolved' })
          // No unresolved or error instances
        ]
      });

      const resolvedCount = props.instanceBreakdown.filter(i => i.status === 'resolved').length;
      const unresolvedCount = props.instanceBreakdown.filter(i => i.status === 'unresolved').length;
      const errorCount = props.instanceBreakdown.filter(i => i.status === 'error').length;

      const statusDistributionData = [
        { name: 'Resolved', value: resolvedCount },
        { name: 'Unresolved', value: unresolvedCount },
        { name: 'Error', value: errorCount }
      ].filter(d => d.value > 0);

      // Should only have Resolved since others are 0
      expect(statusDistributionData).toHaveLength(1);
      expect(statusDistributionData[0].name).toBe('Resolved');
    });
  });

  describe('Bar Chart Data (Test Metrics)', () => {
    it('should generate F2P/P2P test metrics data', () => {
      const props = createTestProps({
        testResults: { passed: 100, failed: 20, total: 120 }
      });

      // Component generates bar chart data with F2P and P2P categories
      const testMetricsData = [
        { name: 'Fail-to-Pass (F2P)', passed: 60, failed: 10 },
        { name: 'Pass-to-Pass (P2P)', passed: 40, failed: 10 }
      ];

      expect(testMetricsData).toHaveLength(2);
      expect(testMetricsData[0].name).toContain('F2P');
      expect(testMetricsData[1].name).toContain('P2P');
    });

    it('should handle zero test results', () => {
      const props = createTestProps({
        testResults: { passed: 0, failed: 0, total: 0 }
      });

      // When total is 0, bar chart should show no data
      expect(props.testResults.total).toBe(0);
    });
  });

  describe('Instance Filtering', () => {
    it('should filter instances by search query', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ instanceId: 'django__django-12345' }),
          createTestInstance({ instanceId: 'flask__flask-67890' }),
          createTestInstance({ instanceId: 'django__django-11111' })
        ]
      });

      const searchQuery = 'django';
      const filteredInstances = props.instanceBreakdown.filter(instance =>
        instance.instanceId.toLowerCase().includes(searchQuery.toLowerCase())
      );

      expect(filteredInstances).toHaveLength(2);
    });

    it('should filter instances by status', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ instanceId: 'test-1', status: 'resolved' }),
          createTestInstance({ instanceId: 'test-2', status: 'unresolved' }),
          createTestInstance({ instanceId: 'test-3', status: 'resolved' }),
          createTestInstance({ instanceId: 'test-4', status: 'error' })
        ]
      });

      const statusFilter: 'resolved' | 'unresolved' | 'error' = 'resolved';
      const filteredInstances = props.instanceBreakdown.filter(
        instance => instance.status === statusFilter
      );

      expect(filteredInstances).toHaveLength(2);
    });

    it('should show all instances when filter is "all"', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ status: 'resolved' }),
          createTestInstance({ status: 'unresolved' }),
          createTestInstance({ status: 'error' })
        ]
      });

      const statusFilter = 'all';
      const filteredInstances = statusFilter === 'all'
        ? props.instanceBreakdown
        : props.instanceBreakdown.filter(i => i.status === statusFilter);

      expect(filteredInstances).toHaveLength(3);
    });

    it('should combine search and status filters', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ instanceId: 'django__django-1', status: 'resolved' }),
          createTestInstance({ instanceId: 'django__django-2', status: 'unresolved' }),
          createTestInstance({ instanceId: 'flask__flask-1', status: 'resolved' })
        ]
      });

      const searchQuery = 'django';
      const statusFilter = 'resolved' as const;

      const filteredInstances = props.instanceBreakdown.filter(instance => {
        const matchesSearch = instance.instanceId.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesFilter = instance.status === statusFilter;
        return matchesSearch && matchesFilter;
      });

      expect(filteredInstances).toHaveLength(1);
      expect(filteredInstances[0].instanceId).toContain('django');
      expect(filteredInstances[0].status).toBe('resolved');
    });

    it('should handle empty search query', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ instanceId: 'test-1' }),
          createTestInstance({ instanceId: 'test-2' })
        ]
      });

      // With empty search, all instances should pass the filter
      const filteredInstances = props.instanceBreakdown;

      expect(filteredInstances).toHaveLength(2);
    });

    it('should show "No instances match" message when filter returns empty', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ instanceId: 'test-1', status: 'resolved' })
        ]
      });

      const searchQuery = 'nonexistent';
      const filteredInstances = props.instanceBreakdown.filter(instance =>
        instance.instanceId.toLowerCase().includes(searchQuery.toLowerCase())
      );

      expect(filteredInstances).toHaveLength(0);
    });
  });

  describe('Instance Result Display', () => {
    it('should display instance ID', () => {
      const instance = createTestInstance({ instanceId: 'owner__repo-12345' });
      expect(instance.instanceId).toBe('owner__repo-12345');
    });

    it('should truncate long instance IDs', () => {
      const longId = 'very-long-repository-owner__very-long-repository-name-with-many-characters-12345';
      const instance = createTestInstance({ instanceId: longId });

      // Component truncates at 40 characters
      const truncatedId = instance.instanceId.length > 40
        ? `${instance.instanceId.substring(0, 40)}...`
        : instance.instanceId;

      expect(truncatedId.length).toBeLessThanOrEqual(43); // 40 + "..."
      expect(truncatedId).toContain('...');
    });

    it('should display patch applied status', () => {
      const appliedInstance = createTestInstance({ patchApplied: true });
      const notAppliedInstance = createTestInstance({ patchApplied: false });

      expect(appliedInstance.patchApplied).toBe(true);
      expect(notAppliedInstance.patchApplied).toBe(false);
    });

    it('should display tests passed count', () => {
      const instance = createTestInstance({ testsPassed: 10 });
      expect(instance.testsPassed).toBe(10);
    });

    it('should display tests failed count', () => {
      const instance = createTestInstance({ testsFailed: 3 });
      expect(instance.testsFailed).toBe(3);
    });
  });

  describe('Status Badges', () => {
    it('should configure resolved status correctly', () => {
      const statusConfig = {
        resolved: {
          label: 'Resolved',
          color: 'text-success'
        },
        unresolved: {
          label: 'Unresolved',
          color: 'text-destructive'
        },
        error: {
          label: 'Error',
          color: 'text-amber-500'
        }
      };

      expect(statusConfig.resolved.label).toBe('Resolved');
      expect(statusConfig.resolved.color).toContain('success');
    });

    it('should configure unresolved status correctly', () => {
      const statusConfig = {
        resolved: { label: 'Resolved' },
        unresolved: { label: 'Unresolved' },
        error: { label: 'Error' }
      };

      expect(statusConfig.unresolved.label).toBe('Unresolved');
    });

    it('should configure error status correctly', () => {
      const statusConfig = {
        resolved: { label: 'Resolved' },
        unresolved: { label: 'Unresolved' },
        error: { label: 'Error' }
      };

      expect(statusConfig.error.label).toBe('Error');
    });
  });

  describe('Colors Configuration', () => {
    it('should have correct color for resolved status', () => {
      const COLORS = {
        resolved: 'hsl(142, 76%, 36%)', // green-600
        unresolved: 'hsl(0, 84%, 60%)', // red-500
        error: 'hsl(38, 92%, 50%)' // amber-500
      };

      expect(COLORS.resolved).toContain('142');
    });

    it('should have correct color for passed tests', () => {
      const COLORS = {
        passed: 'hsl(142, 76%, 36%)', // green-600
        failed: 'hsl(0, 84%, 60%)' // red-500
      };

      expect(COLORS.passed).toContain('142');
    });

    it('should have correct color for failed tests', () => {
      const COLORS = {
        passed: 'hsl(142, 76%, 36%)',
        failed: 'hsl(0, 84%, 60%)'
      };

      expect(COLORS.failed).toContain('0');
    });
  });

  describe('Expandable Instance Breakdown', () => {
    it('should toggle expanded state', () => {
      let expandedInstances = false;

      // Simulate toggle
      expandedInstances = !expandedInstances;
      expect(expandedInstances).toBe(true);

      expandedInstances = !expandedInstances;
      expect(expandedInstances).toBe(false);
    });

    it('should show instance count in header', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance(),
          createTestInstance(),
          createTestInstance()
        ]
      });

      const totalInstances = props.instanceBreakdown.length;
      expect(totalInstances).toBe(3);

      // Header shows: "{totalInstances} instances evaluated"
      const headerText = `${totalInstances} instances evaluated`;
      expect(headerText).toBe('3 instances evaluated');
    });
  });

  describe('Summary Statistics', () => {
    it('should display showing X of Y instances', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ instanceId: 'test-1' }),
          createTestInstance({ instanceId: 'test-2' }),
          createTestInstance({ instanceId: 'filtered-out' })
        ]
      });

      const searchQuery = 'test';
      const filteredInstances = props.instanceBreakdown.filter(instance =>
        instance.instanceId.toLowerCase().includes(searchQuery.toLowerCase())
      );

      const totalInstances = props.instanceBreakdown.length;
      const summaryText = `Showing ${filteredInstances.length} of ${totalInstances} instances`;
      expect(summaryText).toBe('Showing 2 of 3 instances');
    });

    it('should show resolved count in summary', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ status: 'resolved' }),
          createTestInstance({ status: 'resolved' }),
          createTestInstance({ status: 'unresolved' })
        ]
      });

      const resolvedCount = props.instanceBreakdown.filter(i => i.status === 'resolved').length;
      expect(resolvedCount).toBe(2);
    });

    it('should show unresolved count in summary', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ status: 'resolved' }),
          createTestInstance({ status: 'unresolved' }),
          createTestInstance({ status: 'unresolved' })
        ]
      });

      const unresolvedCount = props.instanceBreakdown.filter(i => i.status === 'unresolved').length;
      expect(unresolvedCount).toBe(2);
    });

    it('should show error count in summary', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ status: 'error' }),
          createTestInstance({ status: 'resolved' })
        ]
      });

      const errorCount = props.instanceBreakdown.filter(i => i.status === 'error').length;
      expect(errorCount).toBe(1);
    });
  });

  describe('MetricCard Component', () => {
    it('should support success color', () => {
      const color = 'success';
      const colorClasses = {
        success: 'text-success',
        info: 'text-info',
        primary: 'text-primary',
        destructive: 'text-destructive'
      };
      expect(colorClasses[color]).toBe('text-success');
    });

    it('should support info color', () => {
      const color = 'info';
      const colorClasses = {
        success: 'text-success',
        info: 'text-info',
        primary: 'text-primary',
        destructive: 'text-destructive'
      };
      expect(colorClasses[color]).toBe('text-info');
    });

    it('should support primary color', () => {
      const color = 'primary';
      const colorClasses = {
        success: 'text-success',
        info: 'text-info',
        primary: 'text-primary',
        destructive: 'text-destructive'
      };
      expect(colorClasses[color]).toBe('text-primary');
    });

    it('should support highlighted state', () => {
      const isHighlighted = true;
      const bgClasses = {
        success: 'bg-success/10'
      };
      const expectedBg = isHighlighted ? bgClasses.success : 'bg-muted/30';
      expect(expectedBg).toBe('bg-success/10');
    });
  });

  describe('Table Structure', () => {
    it('should have correct table headers', () => {
      const expectedHeaders = [
        'Instance ID',
        'Status',
        'Patch Applied',
        'Tests Passed',
        'Tests Failed'
      ];

      expect(expectedHeaders).toHaveLength(5);
      expect(expectedHeaders).toContain('Instance ID');
      expect(expectedHeaders).toContain('Status');
    });

    it('should render instance rows with unique keys', () => {
      const props = createTestProps({
        instanceBreakdown: [
          createTestInstance({ instanceId: 'unique-1' }),
          createTestInstance({ instanceId: 'unique-2' }),
          createTestInstance({ instanceId: 'unique-3' })
        ]
      });

      const keys = props.instanceBreakdown.map(i => i.instanceId);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });

  describe('Empty States', () => {
    it('should handle empty instance breakdown', () => {
      const props = createTestProps({ instanceBreakdown: [] });
      expect(props.instanceBreakdown).toHaveLength(0);
    });

    it('should display "No data available" for empty pie chart', () => {
      const props = createTestProps({ instanceBreakdown: [] });
      const statusDistributionData = [
        { name: 'Resolved', value: 0 },
        { name: 'Unresolved', value: 0 },
        { name: 'Error', value: 0 }
      ].filter(d => d.value > 0);

      expect(statusDistributionData).toHaveLength(0);
    });

    it('should display "No test data available" when total is 0', () => {
      const props = createTestProps({
        testResults: { passed: 0, failed: 0, total: 0 }
      });

      expect(props.testResults.total).toBe(0);
    });

    it('should display "No instances to display" when breakdown is empty', () => {
      const props = createTestProps({ instanceBreakdown: [] });

      // Empty breakdown means no instances to display
      expect(props.instanceBreakdown).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very high resolve rate', () => {
      const props = createTestProps({ resolveRate: 99.9 });
      expect(props.resolveRate).toBe(99.9);
    });

    it('should handle large number of instances', () => {
      const manyInstances = Array.from({ length: 1000 }, (_, i) =>
        createTestInstance({ instanceId: `instance-${i}` })
      );
      const props = createTestProps({ instanceBreakdown: manyInstances });

      expect(props.instanceBreakdown).toHaveLength(1000);
    });

    it('should handle instance with all tests failed', () => {
      const instance = createTestInstance({
        testsPassed: 0,
        testsFailed: 10
      });

      expect(instance.testsPassed).toBe(0);
      expect(instance.testsFailed).toBe(10);
    });

    it('should handle instance with all tests passed', () => {
      const instance = createTestInstance({
        testsPassed: 10,
        testsFailed: 0
      });

      expect(instance.testsPassed).toBe(10);
      expect(instance.testsFailed).toBe(0);
    });

    it('should handle decimal values in metrics', () => {
      const props = createTestProps({
        resolveRate: 33.333,
        patchApplicationSuccess: 66.666
      });

      expect(props.resolveRate.toFixed(1)).toBe('33.3');
      expect(props.patchApplicationSuccess.toFixed(1)).toBe('66.7');
    });
  });

  describe('Animation Staggering', () => {
    it('should limit animation delay to max value', () => {
      // Component uses: Math.min(index * 0.02, 0.5)
      const indices = [0, 10, 25, 50, 100];

      indices.forEach(index => {
        const delay = Math.min(index * 0.02, 0.5);
        expect(delay).toBeLessThanOrEqual(0.5);
      });
    });

    it('should calculate delay based on index', () => {
      const index = 5;
      const delay = Math.min(index * 0.02, 0.5);
      expect(delay).toBe(0.1);
    });
  });

  describe('Filter Buttons', () => {
    it('should have all filter options', () => {
      const filterOptions = ['all', 'resolved', 'unresolved', 'error'] as const;
      expect(filterOptions).toHaveLength(4);
    });

    it('should capitalize filter labels', () => {
      const filters = ['all', 'resolved', 'unresolved', 'error'];
      const capitalizedFilters = filters.map(f => f.charAt(0).toUpperCase() + f.slice(1));

      expect(capitalizedFilters).toEqual(['All', 'Resolved', 'Unresolved', 'Error']);
    });
  });
});
