/**
 * Performance Benchmark Tests for Parser
 *
 * Tests parser performance to verify OXC speedup and overall parsing efficiency.
 * These tests measure actual parsing times and rates to ensure performance targets are met.
 *
 * Note: These tests may be slower than unit tests as they measure real parsing performance.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { parseFile, parseFiles, initializeParsers } from '../../parser-router';
import { parserMetrics } from '../../parser-metrics';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
  /** Maximum memory per large file (MB) */
  maxMemoryMb: 100,
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
function generateTypescriptFile(lines: number): string {
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
 * Generate a Python file with the specified number of lines
 */
function generatePythonFile(lines: number): string {
  const imports = ['from typing import List, Optional', 'import os', 'import sys', ''];

  const classCode = [
    'class TestClass:',
    '    """A test class for benchmarking."""',
    '',
    '    def __init__(self, value: int):',
    '        self.value = value',
    '',
    '    def get_value(self) -> int:',
    '        """Get the current value."""',
    '        return self.value',
    '',
    '    def set_value(self, value: int) -> None:',
    '        """Set a new value."""',
    '        self.value = value',
    '',
  ];

  const functionCode = [
    'def calculate_sum(a: int, b: int) -> int:',
    '    """Calculate the sum of two numbers."""',
    '    return a + b',
    '',
    'def process_data(data: List[str]) -> str:',
    '    """Process a list of strings."""',
    '    return ", ".join(data)',
    '',
  ];

  let code = [...imports];
  let currentLines = imports.length;

  while (currentLines < lines) {
    if (currentLines + classCode.length <= lines) {
      code.push(...classCode);
      currentLines += classCode.length;
    } else if (currentLines + functionCode.length <= lines) {
      code.push(...functionCode);
      currentLines += functionCode.length;
    } else {
      code.push('# Generated comment line');
      currentLines++;
    }
  }

  return code.join('\n');
}

/**
 * Create a temporary file for testing
 */
async function createTempFile(extension: string, content: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const fileName = `parser-benchmark-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
  const filePath = path.join(tmpDir, fileName);

  await fs.promises.writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Delete a temporary file
 */
async function deleteTempFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignore errors if file doesn't exist
  }
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
  let tempFiles: string[] = [];
  let parsersInitialized = false;

  beforeAll(async () => {
    // Try to initialize parsers, but don't fail if WASM files aren't available
    try {
      await initializeParsers();
      parsersInitialized = true;
    } catch (error) {
      console.warn('Parser initialization failed, some tests will be skipped:', error);
      parsersInitialized = false;
    }
  });

  afterEach(async () => {
    // Clean up temporary files
    for (const file of tempFiles) {
      await deleteTempFile(file);
    }
    tempFiles = [];

    // Clear metrics after each test
    parserMetrics.clear();
  });

  describe('OXC Parser Performance', () => {
    it('should parse TypeScript file faster than baseline', async () => {
      // Create a medium-sized TypeScript file
      const content = generateTypescriptFile(FILE_SIZES.medium);
      const filePath = await createTempFile('.ts', content);
      tempFiles.push(filePath);

      // Measure parse time
      const startTime = performance.now();
      const result = await parseFile(filePath);
      const endTime = performance.now();

      const parseTime = endTime - startTime;

      // Verify it parsed successfully
      expect(result).toBeDefined();
      expect(result?.parser).toBe('oxc');

      // Verify it's faster than our target
      expect(parseTime).toBeLessThan(PERFORMANCE_TARGETS.singleFileMaxMs);

      console.log(`  ✓ Parsed TypeScript file (${FILE_SIZES.medium} LOC) in ${parseTime.toFixed(2)}ms`);
    });

    it('should parse small TypeScript files very quickly', async () => {
      const content = generateTypescriptFile(FILE_SIZES.small);
      const filePath = await createTempFile('.ts', content);
      tempFiles.push(filePath);

      const startTime = performance.now();
      await parseFile(filePath);
      const endTime = performance.now();

      const parseTime = endTime - startTime;

      // Small files should be very fast (< 20ms)
      expect(parseTime).toBeLessThan(20);

      console.log(`  ✓ Parsed small TypeScript file (${FILE_SIZES.small} LOC) in ${parseTime.toFixed(2)}ms`);
    });

    it('should handle large TypeScript files efficiently', async () => {
      const content = generateTypescriptFile(FILE_SIZES.large);
      const filePath = await createTempFile('.ts', content);
      tempFiles.push(filePath);

      const startTime = performance.now();
      const result = await parseFile(filePath);
      const endTime = performance.now();

      const parseTime = endTime - startTime;

      expect(result).toBeDefined();
      expect(parseTime).toBeLessThan(PERFORMANCE_TARGETS.singleFileMaxMs * 2); // Allow 2x for large files

      console.log(`  ✓ Parsed large TypeScript file (${FILE_SIZES.large} LOC) in ${parseTime.toFixed(2)}ms`);
    });

    it('should parse 100 TypeScript files in under 1 second', async () => {
      // Create 100 small TypeScript files
      const fileCount = 100;
      const files: string[] = [];

      for (let i = 0; i < fileCount; i++) {
        const content = generateTypescriptFile(FILE_SIZES.small);
        const filePath = await createTempFile('.ts', content);
        files.push(filePath);
        tempFiles.push(filePath);
      }

      // Parse all files
      const startTime = performance.now();
      const result = await parseFiles(files);
      const endTime = performance.now();

      const totalTime = endTime - startTime;

      // Verify all files were parsed
      expect(result.results).toHaveLength(fileCount);
      expect(result.errors).toHaveLength(0);

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

  describe('Tree-sitter Parser Performance', () => {
    it('should parse Python files efficiently', async () => {
      if (!parsersInitialized) {
        console.log('  ⊘ Skipping Python test - Tree-sitter not initialized');
        return;
      }

      const content = generatePythonFile(FILE_SIZES.medium);
      const filePath = await createTempFile('.py', content);
      tempFiles.push(filePath);

      const startTime = performance.now();
      const result = await parseFile(filePath);
      const endTime = performance.now();

      const parseTime = endTime - startTime;

      expect(result).toBeDefined();
      expect(result?.parser).toBe('tree-sitter');

      // Tree-sitter may be slower than OXC but should still be reasonable
      expect(parseTime).toBeLessThan(PERFORMANCE_TARGETS.singleFileMaxMs * 2);

      console.log(`  ✓ Parsed Python file (${FILE_SIZES.medium} LOC) in ${parseTime.toFixed(2)}ms`);
    });
  });

  describe('Batch Parsing Performance', () => {
    it('should track parsing rate (files/second)', async () => {
      // Create TypeScript files (always available)
      const files: string[] = [];

      // Add 50 TypeScript files
      for (let i = 0; i < 50; i++) {
        const content = generateTypescriptFile(FILE_SIZES.small);
        const filePath = await createTempFile('.ts', content);
        files.push(filePath);
        tempFiles.push(filePath);
      }

      // Add 10 Python files if tree-sitter is available
      if (parsersInitialized) {
        for (let i = 0; i < 10; i++) {
          const content = generatePythonFile(FILE_SIZES.small);
          const filePath = await createTempFile('.py', content);
          files.push(filePath);
          tempFiles.push(filePath);
        }
      }

      // Parse all files and track metrics
      const startTime = performance.now();
      await parseFiles(files);
      const endTime = performance.now();

      const totalTime = endTime - startTime;
      const filesPerSecond = (files.length / totalTime) * 1000;

      // Verify we meet our target parsing rate
      expect(filesPerSecond).toBeGreaterThan(PERFORMANCE_TARGETS.targetFilesPerSecond);

      console.log(
        `  ✓ Parsing rate: ${filesPerSecond.toFixed(2)} files/second (${files.length} files in ${totalTime.toFixed(2)}ms)`
      );
    });

    it('should show improvement over sequential parsing', async () => {
      // Create 20 files for testing
      const files: string[] = [];
      for (let i = 0; i < 20; i++) {
        const content = generateTypescriptFile(FILE_SIZES.small);
        const filePath = await createTempFile('.ts', content);
        files.push(filePath);
        tempFiles.push(filePath);
      }

      // Sequential parsing (one at a time)
      const sequentialStart = performance.now();
      for (const file of files) {
        await parseFile(file);
      }
      const sequentialTime = performance.now() - sequentialStart;

      // Parallel parsing (batch)
      const parallelStart = performance.now();
      await parseFiles(files);
      const parallelTime = performance.now() - parallelStart;

      // Parallel should be faster than sequential
      expect(parallelTime).toBeLessThan(sequentialTime);

      const speedup = sequentialTime / parallelTime;
      console.log(
        `  ✓ Parallel parsing ${speedup.toFixed(2)}x faster (sequential: ${sequentialTime.toFixed(2)}ms, parallel: ${parallelTime.toFixed(2)}ms)`
      );
    });

    it('should use parser metrics to track performance', async () => {
      // Create test files
      const files: string[] = [];
      for (let i = 0; i < 10; i++) {
        const content = generateTypescriptFile(FILE_SIZES.small);
        const filePath = await createTempFile('.ts', content);
        files.push(filePath);
        tempFiles.push(filePath);
      }

      // Clear metrics before test
      parserMetrics.clear();

      // Parse files
      await parseFiles(files);

      // Get stats from metrics
      const stats = parserMetrics.getStats();

      // Verify metrics were tracked
      expect(stats.totalFiles).toBe(10);
      expect(stats.totalTimeMs).toBeGreaterThan(0);
      expect(stats.filesPerSecond).toBeGreaterThan(0);

      // Verify OXC was used for TypeScript files
      expect(stats.byParser.oxc.files).toBe(10);

      console.log(`  ✓ Parser metrics tracked: ${stats.filesPerSecond.toFixed(2)} files/second`);
    });
  });

  describe('Memory Usage', () => {
    it('should not exceed memory limit for large files', async () => {
      const content = generateTypescriptFile(FILE_SIZES.large);
      const filePath = await createTempFile('.ts', content);
      tempFiles.push(filePath);

      const memBefore = getMemoryUsageMb();
      await parseFile(filePath);
      const memAfter = getMemoryUsageMb();

      const memUsed = memAfter - memBefore;

      // Should not use excessive memory
      expect(memUsed).toBeLessThan(PERFORMANCE_TARGETS.maxMemoryMb);

      console.log(`  ✓ Memory used for large file: ${memUsed.toFixed(2)}MB`);
    });

    it('should handle batch parsing without memory leaks', async () => {
      // Parse multiple batches to check for memory leaks
      const batchSize = 20;
      const batches = 3;

      const memBefore = getMemoryUsageMb();

      for (let batch = 0; batch < batches; batch++) {
        const files: string[] = [];

        // Create batch of files
        for (let i = 0; i < batchSize; i++) {
          const content = generateTypescriptFile(FILE_SIZES.small);
          const filePath = await createTempFile('.ts', content);
          files.push(filePath);
          tempFiles.push(filePath);
        }

        // Parse batch
        await parseFiles(files);
      }

      const memAfter = getMemoryUsageMb();
      const memUsed = memAfter - memBefore;

      // Memory usage should be reasonable even after multiple batches
      expect(memUsed).toBeLessThan(PERFORMANCE_TARGETS.maxMemoryMb * 2);

      console.log(
        `  ✓ Memory after ${batches} batches of ${batchSize} files: ${memUsed.toFixed(2)}MB`
      );
    });
  });

  describe('Parser Statistics', () => {
    it('should track detailed statistics per parser backend', async () => {
      // Create TypeScript files (always available)
      const tsFiles: string[] = [];
      for (let i = 0; i < 10; i++) {
        const tsContent = generateTypescriptFile(FILE_SIZES.small);
        const tsPath = await createTempFile('.ts', tsContent);
        tsFiles.push(tsPath);
        tempFiles.push(tsPath);
      }

      // Create Python files if tree-sitter is available
      const pyFiles: string[] = [];
      if (parsersInitialized) {
        for (let i = 0; i < 10; i++) {
          const pyContent = generatePythonFile(FILE_SIZES.small);
          const pyPath = await createTempFile('.py', pyContent);
          pyFiles.push(pyPath);
          tempFiles.push(pyPath);
        }
      }

      // Clear metrics
      parserMetrics.clear();

      // Parse all files
      await parseFiles([...tsFiles, ...pyFiles]);

      // Get stats
      const stats = parserMetrics.getStats();

      // Verify statistics
      const expectedTotal = parsersInitialized ? 20 : 10;
      expect(stats.totalFiles).toBe(expectedTotal);
      expect(stats.byParser.oxc.files).toBe(10);
      expect(stats.byParser.oxc.avgTimeMs).toBeGreaterThan(0);

      console.log(`  ✓ OXC: ${stats.byParser.oxc.files} files, avg ${stats.byParser.oxc.avgTimeMs.toFixed(2)}ms`);

      if (parsersInitialized) {
        expect(stats.byParser.treeSitter.files).toBe(10);
        expect(stats.byParser.treeSitter.avgTimeMs).toBeGreaterThan(0);
        console.log(
          `  ✓ Tree-sitter: ${stats.byParser.treeSitter.files} files, avg ${stats.byParser.treeSitter.avgTimeMs.toFixed(2)}ms`
        );
      }
    });
  });
});
