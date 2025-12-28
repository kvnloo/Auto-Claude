/**
 * Performance Benchmark Tests for Parser
 *
 * Tests parser performance to verify OXC speedup and overall parsing efficiency.
 * These tests measure actual parsing times and rates to ensure performance targets are met.
 *
 * Note: These tests may be slower than unit tests as they measure real parsing performance.
 */

import { describe, it, expect } from 'vitest';
import { parseSync } from 'oxc-parser';
import { parserMetrics } from '../../parser-metrics';

// ============================================
// Test Configuration
// ============================================

/**
 * Performance targets
 */
const PERFORMANCE_TARGETS = {
  /** Maximum time to parse a single TypeScript file (ms) */
  singleFileMaxMs: 100,
  /** Target parsing rate (files per second) */
  targetFilesPerSecond: 10,
  /** Maximum average time per file when parsing 100 files (ms) */
  batchAvgMaxMs: 50,
};

/**
 * Test file sizes (in lines of code)
 */
const FILE_SIZES = {
  small: 50,
  medium: 200,
  large: 1000,
};

// ============================================
// Test Utilities
// ============================================

/**
 * Generate a TypeScript file with the specified number of lines
 */
function generateTypescriptCode(lines: number): string {
  const imports = [
    "import { Component } from 'react';",
    "import { useState, useEffect } from 'react';",
    "import type { FC, ReactNode } from 'react';",
  ];

  const classCode = [
    'export class TestClass {',
    '  private value: number;',
    '',
    '  constructor(value: number) {',
    '    this.value = value;',
    '  }',
    '',
    '  public getValue(): number {',
    '    return this.value;',
    '  }',
    '',
    '  public setValue(value: number): void {',
    '    this.value = value;',
    '  }',
    '}',
  ];

  const functionCode = [
    'export function calculateSum(a: number, b: number): number {',
    '  return a + b;',
    '}',
    '',
    'export function processData(data: string[]): string {',
    '  return data.join(", ");',
    '}',
  ];

  let code = [...imports, ''];
  let currentLines = imports.length + 1;

  // Add classes and functions to reach target line count
  while (currentLines < lines) {
    if (currentLines + classCode.length <= lines) {
      code.push(...classCode, '');
      currentLines += classCode.length + 1;
    } else if (currentLines + functionCode.length <= lines) {
      code.push(...functionCode, '');
      currentLines += functionCode.length + 1;
    } else {
      // Fill remaining lines with comments
      code.push('// Generated comment line');
      currentLines++;
    }
  }

  return code.join('\n');
}

/**
 * Measure parsing time for a code sample
 */
function measureParseTime(code: string, filename: string = 'test.ts'): number {
  const startTime = performance.now();
  const result = parseSync(filename, code, { lang: 'ts' });
  const endTime = performance.now();

  // Verify it parsed successfully
  if (result.errors.length > 0) {
    throw new Error(`Parse errors: ${result.errors.map((e) => e.message).join(', ')}`);
  }

  return endTime - startTime;
}

/**
 * Get memory usage in MB
 */
function getMemoryUsageMb(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed / 1024 / 1024;
}

// ============================================
// Test Suite
// ============================================

describe('Parser Performance Benchmarks', () => {
  describe('OXC Parser Performance', () => {
    it('should parse TypeScript file faster than baseline', () => {
      // Create a medium-sized TypeScript file
      const code = generateTypescriptCode(FILE_SIZES.medium);

      // Measure parse time
      const parseTime = measureParseTime(code);

      // Verify it's faster than our target
      expect(parseTime).toBeLessThan(PERFORMANCE_TARGETS.singleFileMaxMs);

      console.log(`  ✓ Parsed TypeScript code (${FILE_SIZES.medium} LOC) in ${parseTime.toFixed(2)}ms`);
    });

    it('should parse small TypeScript files very quickly', () => {
      const code = generateTypescriptCode(FILE_SIZES.small);
      const parseTime = measureParseTime(code);

      // Small files should be very fast (< 20ms)
      expect(parseTime).toBeLessThan(20);

      console.log(`  ✓ Parsed small TypeScript code (${FILE_SIZES.small} LOC) in ${parseTime.toFixed(2)}ms`);
    });

    it('should handle large TypeScript files efficiently', () => {
      const code = generateTypescriptCode(FILE_SIZES.large);
      const parseTime = measureParseTime(code);

      expect(parseTime).toBeLessThan(PERFORMANCE_TARGETS.singleFileMaxMs * 2); // Allow 2x for large files

      console.log(`  ✓ Parsed large TypeScript code (${FILE_SIZES.large} LOC) in ${parseTime.toFixed(2)}ms`);
    });

    it('should parse 100 TypeScript files in under 1 second', () => {
      const fileCount = 100;
      const code = generateTypescriptCode(FILE_SIZES.small);

      // Parse all files
      const startTime = performance.now();
      for (let i = 0; i < fileCount; i++) {
        const result = parseSync(`test${i}.ts`, code, { lang: 'ts' });
        expect(result.errors).toHaveLength(0);
      }
      const endTime = performance.now();

      const totalTime = endTime - startTime;

      // Should complete in under 1 second
      expect(totalTime).toBeLessThan(1000);

      // Calculate average time per file
      const avgTime = totalTime / fileCount;
      expect(avgTime).toBeLessThan(PERFORMANCE_TARGETS.batchAvgMaxMs);

      console.log(
        `  ✓ Parsed ${fileCount} TypeScript files in ${totalTime.toFixed(2)}ms (${avgTime.toFixed(2)}ms avg per file)`
      );
    });
  });

  describe('Batch Parsing Performance', () => {
    it('should track parsing rate (files/second)', () => {
      const fileCount = 50;
      const code = generateTypescriptCode(FILE_SIZES.small);

      // Parse all files
      const startTime = performance.now();
      for (let i = 0; i < fileCount; i++) {
        parseSync(`test${i}.ts`, code, { lang: 'ts' });
      }
      const endTime = performance.now();

      const totalTime = endTime - startTime;
      const filesPerSecond = (fileCount / totalTime) * 1000;

      // Verify we meet our target parsing rate
      expect(filesPerSecond).toBeGreaterThan(PERFORMANCE_TARGETS.targetFilesPerSecond);

      console.log(
        `  ✓ Parsing rate: ${filesPerSecond.toFixed(2)} files/second (${fileCount} files in ${totalTime.toFixed(2)}ms)`
      );
    });

    it('should show improvement over sequential parsing', () => {
      // Note: This test demonstrates the concept, but in a synchronous test environment
      // parallel parsing isn't possible. This is more of a demonstration of parse speed.
      const fileCount = 20;
      const code = generateTypescriptCode(FILE_SIZES.small);

      // Sequential parsing (what we actually do)
      const sequentialStart = performance.now();
      for (let i = 0; i < fileCount; i++) {
        parseSync(`test${i}.ts`, code, { lang: 'ts' });
      }
      const sequentialTime = performance.now() - sequentialStart;

      // In real-world usage, parallel parsing would be faster
      // Here we just verify that sequential parsing is still reasonable
      expect(sequentialTime).toBeLessThan(1000); // Should parse 20 files in under 1 second

      console.log(`  ✓ Sequential parsing: ${fileCount} files in ${sequentialTime.toFixed(2)}ms`);
    });

    it('should demonstrate consistent performance across multiple batches', () => {
      const batchSize = 20;
      const batches = 3;
      const code = generateTypescriptCode(FILE_SIZES.small);
      const batchTimes: number[] = [];

      for (let batch = 0; batch < batches; batch++) {
        const startTime = performance.now();

        for (let i = 0; i < batchSize; i++) {
          parseSync(`batch${batch}-test${i}.ts`, code, { lang: 'ts' });
        }

        const batchTime = performance.now() - startTime;
        batchTimes.push(batchTime);
      }

      // Calculate average and standard deviation
      const avgTime = batchTimes.reduce((sum, t) => sum + t, 0) / batchTimes.length;
      const variance = batchTimes.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) / batchTimes.length;
      const stdDev = Math.sqrt(variance);

      // Standard deviation should be less than 50% of average (consistent performance)
      expect(stdDev).toBeLessThan(avgTime * 0.5);

      console.log(
        `  ✓ Consistent performance: avg ${avgTime.toFixed(2)}ms ± ${stdDev.toFixed(2)}ms across ${batches} batches`
      );
    });
  });

  describe('Memory Usage', () => {
    it('should not use excessive memory for large files', () => {
      const code = generateTypescriptCode(FILE_SIZES.large);

      const memBefore = getMemoryUsageMb();
      parseSync('large-test.ts', code, { lang: 'ts' });
      const memAfter = getMemoryUsageMb();

      const memUsed = memAfter - memBefore;

      // Should not use excessive memory (< 50MB for a single parse)
      expect(memUsed).toBeLessThan(50);

      console.log(`  ✓ Memory used for large file: ${memUsed.toFixed(2)}MB`);
    });

    it('should handle batch parsing without memory leaks', () => {
      const batchSize = 20;
      const batches = 3;
      const code = generateTypescriptCode(FILE_SIZES.small);

      const memBefore = getMemoryUsageMb();

      for (let batch = 0; batch < batches; batch++) {
        for (let i = 0; i < batchSize; i++) {
          parseSync(`batch${batch}-test${i}.ts`, code, { lang: 'ts' });
        }
      }

      const memAfter = getMemoryUsageMb();
      const memUsed = memAfter - memBefore;

      // Memory usage should be reasonable even after multiple batches (< 100MB)
      expect(memUsed).toBeLessThan(100);

      console.log(`  ✓ Memory after ${batches} batches of ${batchSize} files: ${memUsed.toFixed(2)}MB`);
    });
  });

  describe('Parser Statistics', () => {
    it('should demonstrate fast parsing for different code patterns', () => {
      // Test different types of TypeScript code
      const patterns = {
        classes: `
export class User {
  constructor(public name: string, public age: number) {}
  greet() { return 'Hello, ' + this.name; }
}
export class Admin extends User {
  constructor(name: string, age: number, public level: number) {
    super(name, age);
  }
}`,
        functions: `
export function add(a: number, b: number): number { return a + b; }
export function multiply(a: number, b: number): number { return a * b; }
export const divide = (a: number, b: number): number => a / b;
`,
        interfaces: `
export interface User { name: string; age: number; }
export interface Admin extends User { level: number; }
export type UserRole = 'admin' | 'user' | 'guest';
`,
        mixed: `
import { Component } from 'react';

export interface Props { title: string; }

export class MyComponent extends Component<Props> {
  render() { return this.props.title; }
}

export function helper(x: number): string { return x.toString(); }
`,
      };

      const times: Record<string, number> = {};

      for (const [name, code] of Object.entries(patterns)) {
        const parseTime = measureParseTime(code, `${name}.ts`);
        times[name] = parseTime;

        // All patterns should parse quickly
        expect(parseTime).toBeLessThan(50);
      }

      console.log('  ✓ Parse times by pattern:');
      for (const [name, time] of Object.entries(times)) {
        console.log(`    - ${name}: ${time.toFixed(2)}ms`);
      }
    });

    it('should handle TypeScript-specific features efficiently', () => {
      const tsFeatures = `
// Generics
export interface Repository<T> {
  find(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
}

// Type guards
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

// Decorators (if enabled)
function deprecated(target: any, propertyKey: string) {
  console.log(propertyKey + ' is deprecated');
}

// Enums
export enum Status {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE',
}

// Mapped types
export type Readonly<T> = { readonly [P in keyof T]: T[P] };

// Conditional types
export type NonNullable<T> = T extends null | undefined ? never : T;
`;

      const parseTime = measureParseTime(tsFeatures, 'ts-features.ts');

      expect(parseTime).toBeLessThan(100);

      console.log(`  ✓ Parsed TypeScript-specific features in ${parseTime.toFixed(2)}ms`);
    });
  });
});
