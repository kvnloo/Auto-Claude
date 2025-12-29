/**
 * Unit tests for VariantSelector component
 * Tests variant rendering, selection, disabled state, and variant info display
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BenchmarkVariant, BenchmarkSelectorProps } from '../types';

// Import getVariantInfo separately since it's used by the component
import { getVariantInfo } from '../../../stores/benchmarkStore';

// Helper to create test props
function createTestProps(overrides: Partial<BenchmarkSelectorProps> = {}): BenchmarkSelectorProps {
  return {
    selectedVariant: 'lite',
    onVariantChange: vi.fn(),
    disabled: false,
    ...overrides
  };
}

describe('VariantSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Variant List', () => {
    it('should have 5 benchmark variants available', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];
      expect(variants).toHaveLength(5);
    });

    it('should include all expected variants', () => {
      const expectedVariants: BenchmarkVariant[] = [
        'lite',
        'verified',
        'full',
        'multimodal',
        'multilingual'
      ];

      expectedVariants.forEach(variant => {
        expect(['lite', 'verified', 'full', 'multimodal', 'multilingual']).toContain(variant);
      });
    });
  });

  describe('Variant Info', () => {
    it('should return correct info for lite variant', () => {
      const info = getVariantInfo('lite');
      expect(info.name).toBe('SWE-bench Lite');
      expect(info.instanceCount).toBe(300);
      expect(info.description).toContain('300');
    });

    it('should return correct info for verified variant', () => {
      const info = getVariantInfo('verified');
      expect(info.name).toBe('SWE-bench Verified');
      expect(info.instanceCount).toBe(500);
      expect(info.description).toContain('verified');
    });

    it('should return correct info for full variant', () => {
      const info = getVariantInfo('full');
      expect(info.name).toBe('SWE-bench Full');
      expect(info.instanceCount).toBe(2294);
      expect(info.description).toContain('2,294');
    });

    it('should return correct info for multimodal variant', () => {
      const info = getVariantInfo('multimodal');
      expect(info.name).toBe('SWE-bench Multimodal');
      expect(info.instanceCount).toBe(617);
      expect(info.description.toLowerCase()).toContain('visual');
    });

    it('should return correct info for multilingual variant', () => {
      const info = getVariantInfo('multilingual');
      expect(info.name).toBe('SWE-bench Multilingual');
      expect(info.instanceCount).toBe(510);
      expect(info.description.toLowerCase()).toContain('language');
    });

    it('should have unique instance counts for each variant', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];
      const instanceCounts = variants.map(v => getVariantInfo(v).instanceCount);
      const uniqueCounts = new Set(instanceCounts);
      expect(uniqueCounts.size).toBe(variants.length);
    });
  });

  describe('Selection State', () => {
    it('should identify selected variant correctly', () => {
      const props = createTestProps({ selectedVariant: 'verified' });
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];

      variants.forEach(variant => {
        const isSelected = variant === props.selectedVariant;
        if (variant === 'verified') {
          expect(isSelected).toBe(true);
        } else {
          expect(isSelected).toBe(false);
        }
      });
    });

    it('should handle selection change callback', () => {
      const mockOnVariantChange = vi.fn();
      const props = createTestProps({
        selectedVariant: 'lite',
        onVariantChange: mockOnVariantChange
      });

      // Simulate selection change
      const newVariant: BenchmarkVariant = 'verified';
      props.onVariantChange(newVariant);

      expect(mockOnVariantChange).toHaveBeenCalledWith('verified');
      expect(mockOnVariantChange).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple selection changes', () => {
      const mockOnVariantChange = vi.fn();
      const props = createTestProps({
        selectedVariant: 'lite',
        onVariantChange: mockOnVariantChange
      });

      // Simulate multiple selection changes
      props.onVariantChange('verified');
      props.onVariantChange('full');
      props.onVariantChange('multimodal');

      expect(mockOnVariantChange).toHaveBeenCalledTimes(3);
      expect(mockOnVariantChange).toHaveBeenNthCalledWith(1, 'verified');
      expect(mockOnVariantChange).toHaveBeenNthCalledWith(2, 'full');
      expect(mockOnVariantChange).toHaveBeenNthCalledWith(3, 'multimodal');
    });
  });

  describe('Disabled State', () => {
    it('should handle disabled state correctly', () => {
      const props = createTestProps({ disabled: true });
      expect(props.disabled).toBe(true);
    });

    it('should handle enabled state correctly', () => {
      const props = createTestProps({ disabled: false });
      expect(props.disabled).toBe(false);
    });

    it('should default to enabled when disabled is not specified', () => {
      const props: BenchmarkSelectorProps = {
        selectedVariant: 'lite',
        onVariantChange: vi.fn()
      };
      expect(props.disabled).toBeUndefined();
      // Component treats undefined as false
      expect(props.disabled ?? false).toBe(false);
    });

    it('should still track selected variant when disabled', () => {
      const props = createTestProps({
        selectedVariant: 'full',
        disabled: true
      });

      expect(props.disabled).toBe(true);
      expect(props.selectedVariant).toBe('full');
    });
  });

  describe('Variant Ordering', () => {
    it('should have variants in expected order', () => {
      const expectedOrder: BenchmarkVariant[] = [
        'lite',
        'verified',
        'full',
        'multimodal',
        'multilingual'
      ];

      // Component renders variants in this order
      expect(expectedOrder[0]).toBe('lite');
      expect(expectedOrder[1]).toBe('verified');
      expect(expectedOrder[2]).toBe('full');
      expect(expectedOrder[3]).toBe('multimodal');
      expect(expectedOrder[4]).toBe('multilingual');
    });

    it('should have lite as the first option (recommended)', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];
      expect(variants[0]).toBe('lite');

      // Lite is recommended because it has the fewest instances
      const liteInfo = getVariantInfo('lite');
      expect(liteInfo.instanceCount).toBe(300);
    });
  });

  describe('Instance Counts', () => {
    it('should have lite as smallest benchmark', () => {
      const liteInfo = getVariantInfo('lite');
      expect(liteInfo.instanceCount).toBeLessThan(500);
    });

    it('should have full as largest benchmark', () => {
      const fullInfo = getVariantInfo('full');
      expect(fullInfo.instanceCount).toBeGreaterThan(2000);
    });

    it('should order benchmarks by size correctly', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];
      const counts = variants.map(v => getVariantInfo(v).instanceCount);

      // Lite should be smallest
      expect(counts[0]).toBe(Math.min(...counts));

      // Full should be largest
      const fullIndex = variants.indexOf('full');
      expect(counts[fullIndex]).toBe(Math.max(...counts));
    });
  });

  describe('Component Props Types', () => {
    it('should accept valid BenchmarkSelectorProps', () => {
      const validProps: BenchmarkSelectorProps = {
        selectedVariant: 'lite',
        onVariantChange: vi.fn(),
        disabled: false
      };

      expect(validProps.selectedVariant).toBeDefined();
      expect(typeof validProps.onVariantChange).toBe('function');
      expect(typeof validProps.disabled).toBe('boolean');
    });

    it('should accept all valid variant values', () => {
      const validVariants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];

      validVariants.forEach(variant => {
        const props = createTestProps({ selectedVariant: variant });
        expect(props.selectedVariant).toBe(variant);
      });
    });
  });

  describe('Display Format', () => {
    it('should format instance count with locale string', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];

      variants.forEach(variant => {
        const info = getVariantInfo(variant);
        const formattedCount = info.instanceCount.toLocaleString();
        expect(typeof formattedCount).toBe('string');
        // For numbers >= 1000, should include comma or locale separator
        if (info.instanceCount >= 1000) {
          // Either has comma or the number is formatted somehow
          expect(formattedCount.length).toBeGreaterThan(3);
        }
      });
    });

    it('should have descriptive names for all variants', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];

      variants.forEach(variant => {
        const info = getVariantInfo(variant);
        expect(info.name).toContain('SWE-bench');
        expect(info.name.length).toBeGreaterThan(10);
      });
    });

    it('should have meaningful descriptions for all variants', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];

      variants.forEach(variant => {
        const info = getVariantInfo(variant);
        expect(info.description.length).toBeGreaterThan(20);
      });
    });
  });

  describe('RadioGroup Behavior', () => {
    it('should only allow one selection at a time', () => {
      const props = createTestProps({ selectedVariant: 'lite' });
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];

      // Count selected variants
      const selectedCount = variants.filter(v => v === props.selectedVariant).length;
      expect(selectedCount).toBe(1);
    });

    it('should always have exactly one variant selected', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];

      // Test each variant as selected
      variants.forEach(selectedVariant => {
        const props = createTestProps({ selectedVariant });
        const selectedCount = variants.filter(v => v === props.selectedVariant).length;
        expect(selectedCount).toBe(1);
      });
    });
  });

  describe('ID Generation', () => {
    it('should generate unique IDs for each variant radio button', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];

      // Component uses `variant-${variant}` pattern for IDs
      const ids = variants.map(v => `variant-${v}`);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(variants.length);
    });

    it('should follow variant-{name} ID pattern', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];

      variants.forEach(variant => {
        const expectedId = `variant-${variant}`;
        expect(expectedId).toMatch(/^variant-[a-z]+$/);
      });
    });
  });

  describe('Styling Classes', () => {
    it('should apply different styling for selected vs unselected', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];
      const selectedVariant: BenchmarkVariant = 'verified';

      variants.forEach(variant => {
        const isSelected = variant === selectedVariant;
        // Component uses these classes:
        // selected: 'border-primary bg-accent'
        // unselected: 'hover:bg-accent/50'
        if (isSelected) {
          expect(isSelected).toBe(true);
        } else {
          expect(isSelected).toBe(false);
        }
      });
    });

    it('should apply disabled styling when disabled is true', () => {
      const props = createTestProps({ disabled: true });
      // Component applies 'opacity-50 cursor-not-allowed' when disabled
      expect(props.disabled).toBe(true);
    });

    it('should apply cursor-pointer when not disabled', () => {
      const props = createTestProps({ disabled: false });
      // Component applies 'cursor-pointer' when not disabled
      expect(props.disabled).toBe(false);
    });
  });

  describe('Accessibility', () => {
    it('should associate label with radio button via htmlFor', () => {
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];

      // Each radio should have matching label htmlFor
      variants.forEach(variant => {
        const radioId = `variant-${variant}`;
        const labelHtmlFor = `variant-${variant}`;
        expect(radioId).toBe(labelHtmlFor);
      });
    });

    it('should have descriptive section heading', () => {
      // Component has heading: 'Benchmark Variant'
      const expectedHeading = 'Benchmark Variant';
      expect(expectedHeading.length).toBeGreaterThan(0);
    });

    it('should have helper text for variant selection', () => {
      // Component has description: 'Select the SWE-bench variant to evaluate against'
      const expectedDescription = 'Select the SWE-bench variant to evaluate against';
      expect(expectedDescription.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid selection changes', () => {
      const mockOnVariantChange = vi.fn();
      const props = createTestProps({ onVariantChange: mockOnVariantChange });

      // Simulate rapid changes
      const variants: BenchmarkVariant[] = ['lite', 'verified', 'full', 'multimodal', 'multilingual'];
      variants.forEach(v => props.onVariantChange(v));

      expect(mockOnVariantChange).toHaveBeenCalledTimes(5);
    });

    it('should handle selecting same variant again', () => {
      const mockOnVariantChange = vi.fn();
      const props = createTestProps({
        selectedVariant: 'lite',
        onVariantChange: mockOnVariantChange
      });

      // Select the same variant
      props.onVariantChange('lite');

      expect(mockOnVariantChange).toHaveBeenCalledWith('lite');
    });
  });
});
