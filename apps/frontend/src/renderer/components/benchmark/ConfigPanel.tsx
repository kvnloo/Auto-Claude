import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { AlertCircle } from 'lucide-react';
import type { BenchmarkConfigProps, CacheLevel } from './types';

/**
 * Cache level options with descriptions
 */
const CACHE_LEVELS: Array<{ value: CacheLevel; label: string; description: string }> = [
  {
    value: 'none',
    label: 'No caching',
    description: 'Rebuild all Docker images for each instance'
  },
  {
    value: 'base',
    label: 'Base images only',
    description: 'Cache base OS and runtime images'
  },
  {
    value: 'env',
    label: 'Environment (Recommended)',
    description: 'Cache repository environment setup'
  },
  {
    value: 'instance',
    label: 'Full caching',
    description: 'Cache everything including test dependencies'
  }
];

/**
 * ConfigPanel - Configuration panel for SWE-bench benchmark execution
 *
 * Provides inputs for:
 * - max_workers: Number of parallel workers (capped at 75% of CPU cores)
 * - instance_count: Number of instances to evaluate
 * - cache_level: Docker image caching strategy
 */
export function ConfigPanel({
  maxWorkers,
  instanceCount,
  cacheLevel,
  onMaxWorkersChange,
  onInstanceCountChange,
  onCacheLevelChange,
  disabled = false,
  recommendedMaxWorkers,
  maxInstanceCount
}: BenchmarkConfigProps) {
  const handleMaxWorkersChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 1) {
      // Cap at recommended max workers if provided
      const cappedValue = recommendedMaxWorkers
        ? Math.min(value, recommendedMaxWorkers)
        : value;
      onMaxWorkersChange(cappedValue);
    }
  };

  const handleInstanceCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 1) {
      // Cap at max instance count if provided
      const cappedValue = maxInstanceCount
        ? Math.min(value, maxInstanceCount)
        : value;
      onInstanceCountChange(cappedValue);
    }
  };

  const isMaxWorkersAtLimit = recommendedMaxWorkers && maxWorkers >= recommendedMaxWorkers;
  const isInstanceCountAtLimit = maxInstanceCount && instanceCount >= maxInstanceCount;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-sm font-medium leading-none">Configuration</h3>
        <p className="text-sm text-muted-foreground">
          Configure benchmark execution settings
        </p>
      </div>

      <div className="space-y-4">
        {/* Max Workers */}
        <div className="space-y-2">
          <Label htmlFor="maxWorkers" className="text-sm font-medium text-foreground">
            Max Workers
          </Label>
          <p className="text-sm text-muted-foreground">
            Number of parallel workers for evaluation (recommended: &lt;75% of CPU cores)
          </p>
          <div className="flex items-center gap-3">
            <Input
              id="maxWorkers"
              type="number"
              min={1}
              max={recommendedMaxWorkers}
              value={maxWorkers}
              onChange={handleMaxWorkersChange}
              disabled={disabled}
              className="w-32"
            />
            {recommendedMaxWorkers && (
              <span className="text-xs text-muted-foreground">
                Max: {recommendedMaxWorkers}
              </span>
            )}
          </div>
          {isMaxWorkersAtLimit && (
            <div className="flex items-center gap-2 text-xs text-warning">
              <AlertCircle className="h-3 w-3" />
              <span>At recommended maximum to prevent system overload</span>
            </div>
          )}
        </div>

        {/* Instance Count */}
        <div className="space-y-2">
          <Label htmlFor="instanceCount" className="text-sm font-medium text-foreground">
            Instance Count
          </Label>
          <p className="text-sm text-muted-foreground">
            Number of benchmark instances to evaluate
          </p>
          <div className="flex items-center gap-3">
            <Input
              id="instanceCount"
              type="number"
              min={1}
              max={maxInstanceCount}
              value={instanceCount}
              onChange={handleInstanceCountChange}
              disabled={disabled}
              className="w-32"
            />
            {maxInstanceCount && (
              <span className="text-xs text-muted-foreground">
                Max: {maxInstanceCount.toLocaleString()}
              </span>
            )}
          </div>
          {isInstanceCountAtLimit && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3 w-3" />
              <span>At dataset maximum</span>
            </div>
          )}
        </div>

        {/* Cache Level */}
        <div className="space-y-2">
          <Label htmlFor="cacheLevel" className="text-sm font-medium text-foreground">
            Cache Level
          </Label>
          <p className="text-sm text-muted-foreground">
            Docker image caching strategy for evaluation
          </p>
          <Select
            value={cacheLevel}
            onValueChange={(value) => onCacheLevelChange(value as CacheLevel)}
            disabled={disabled}
          >
            <SelectTrigger id="cacheLevel" className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CACHE_LEVELS.map((level) => (
                <SelectItem key={level.value} value={level.value}>
                  <div className="flex flex-col">
                    <span>{level.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {CACHE_LEVELS.find((l) => l.value === cacheLevel)?.description}
          </p>
        </div>
      </div>
    </div>
  );
}
