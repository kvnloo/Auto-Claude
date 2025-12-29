import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
import { getVariantInfo } from '../../stores/benchmarkStore';
import type { BenchmarkSelectorProps, BenchmarkVariant } from './types';

/**
 * Variant option configuration for the selector
 */
const VARIANTS: BenchmarkVariant[] = [
  'lite',
  'verified',
  'full',
  'multimodal',
  'multilingual'
];

/**
 * VariantSelector - A component for selecting SWE-bench benchmark variants
 *
 * Displays a Radix RadioGroup with 5 options:
 * - Lite (300 instances)
 * - Verified (500 instances)
 * - Full (2,294 instances)
 * - Multimodal (617 instances)
 * - Multilingual (510 instances)
 */
export function VariantSelector({
  selectedVariant,
  onVariantChange,
  disabled = false
}: BenchmarkSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium leading-none">Benchmark Variant</h3>
        <p className="text-sm text-muted-foreground">
          Select the SWE-bench variant to evaluate against
        </p>
      </div>

      <RadioGroup
        value={selectedVariant}
        onValueChange={(value) => onVariantChange(value as BenchmarkVariant)}
        disabled={disabled}
        className="grid gap-3"
      >
        {VARIANTS.map((variant) => {
          const info = getVariantInfo(variant);
          return (
            <div
              key={variant}
              className={`flex items-start space-x-3 rounded-lg border border-border p-4 transition-colors ${
                selectedVariant === variant
                  ? 'border-primary bg-accent'
                  : 'hover:bg-accent/50'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <RadioGroupItem
                value={variant}
                id={`variant-${variant}`}
                className="mt-1"
              />
              <Label
                htmlFor={`variant-${variant}`}
                className={`flex-1 space-y-1 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{info.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {info.instanceCount.toLocaleString()} instances
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {info.description}
                </p>
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </div>
  );
}
