/**
 * Type definitions for SWE-bench benchmark components
 */

/**
 * SWE-bench benchmark variant identifiers
 */
export type BenchmarkVariant = 'lite' | 'verified' | 'full' | 'multimodal' | 'multilingual';

/**
 * Benchmark execution status
 */
export type BenchmarkStatus = 'idle' | 'loading' | 'running' | 'completed' | 'failed';

/**
 * Props for the main Benchmark component
 */
export interface BenchmarkProps {
  projectId: string;
}

/**
 * Props for benchmark selection component
 */
export interface BenchmarkSelectorProps {
  selectedVariant: BenchmarkVariant;
  onVariantChange: (variant: BenchmarkVariant) => void;
  disabled?: boolean;
}

/**
 * Props for benchmark configuration panel
 */
export interface BenchmarkConfigProps {
  maxWorkers: number;
  instanceCount: number;
  onMaxWorkersChange: (value: number) => void;
  onInstanceCountChange: (value: number) => void;
  disabled?: boolean;
}

/**
 * Props for benchmark execution monitor
 */
export interface BenchmarkMonitorProps {
  status: BenchmarkStatus;
  currentInstance: string | null;
  progress: number;
  totalInstances: number;
  elapsedTime: number;
  estimatedRemaining: number | null;
}

/**
 * Props for benchmark results visualization
 */
export interface BenchmarkResultsProps {
  resolveRate: number;
  patchApplicationSuccess: number;
  testResults: {
    passed: number;
    failed: number;
    total: number;
  };
  instanceBreakdown: InstanceResult[];
}

/**
 * Individual instance result
 */
export interface InstanceResult {
  instanceId: string;
  status: 'resolved' | 'unresolved' | 'error';
  patchApplied: boolean;
  testsPassed: number;
  testsFailed: number;
}
