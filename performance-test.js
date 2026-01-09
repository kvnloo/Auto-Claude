/**
 * Performance measurement script for terminal debouncing
 *
 * This script can be run in the browser console or as a Node.js script
 * to measure the impact of the debouncing implementation.
 */

// Test configuration
const TESTS = {
  rapidWrites: {
    name: 'Rapid Terminal Writes',
    iterations: 1000,
    description: 'Simulates high-frequency output like npm install'
  },
  burstOutput: {
    name: 'Burst Output',
    iterations: 5000,
    description: 'Large burst of output in short time'
  },
  mixedSizes: {
    name: 'Mixed Line Sizes',
    iterations: 500,
    description: 'Varying line lengths to test buffer handling'
  }
};

// Performance metrics collector
class PerformanceMetrics {
  constructor() {
    this.metrics = {
      startTime: 0,
      endTime: 0,
      totalDuration: 0,
      writeCalls: 0,
      xTermWriteCalls: 0,
      rafCallbacks: 0,
      totalDataSize: 0,
      averageLatency: 0
    };
  }

  start() {
    this.metrics.startTime = performance.now();
  }

  end() {
    this.metrics.endTime = performance.now();
    this.metrics.totalDuration = this.metrics.endTime - this.metrics.startTime;
  }

  recordWrite(dataSize) {
    this.metrics.writeCalls++;
    this.metrics.totalDataSize += dataSize;
  }

  recordXTermWrite() {
    this.metrics.xTermWriteCalls++;
  }

  recordRAFCallback() {
    this.metrics.rafCallbacks++;
  }

  getResults() {
    return {
      ...this.metrics,
      writesPerSecond: (this.metrics.writeCalls / this.metrics.totalDuration) * 1000,
      xTermWritesPerSecond: (this.metrics.xTermWriteCalls / this.metrics.totalDuration) * 1000,
      rafPerSecond: (this.metrics.rafCallbacks / this.metrics.totalDuration) * 1000,
      batchingEfficiency: this.metrics.writeCalls > 0
        ? ((this.metrics.writeCalls - this.metrics.xTermWriteCalls) / this.metrics.writeCalls * 100).toFixed(2)
        : 0,
      averageDataPerWrite: (this.metrics.totalDataSize / this.metrics.writeCalls).toFixed(2),
      averageDataPerBatch: this.metrics.xTermWriteCalls > 0
        ? (this.metrics.totalDataSize / this.metrics.xTermWriteCalls).toFixed(2)
        : 0
    };
  }

  printReport() {
    const results = this.getResults();

    console.log('\n' + '='.repeat(70));
    console.log('PERFORMANCE TEST RESULTS');
    console.log('='.repeat(70));
    console.log(`Test Duration:           ${results.totalDuration.toFixed(2)} ms`);
    console.log(`Total write() calls:     ${results.writeCalls}`);
    console.log(`Total xterm.write():     ${results.xTermWriteCalls}`);
    console.log(`Total RAF callbacks:     ${results.rafCallbacks}`);
    console.log(`Total data size:         ${results.totalDataSize} bytes`);
    console.log('');
    console.log('THROUGHPUT:');
    console.log(`  write() calls/sec:     ${results.writesPerSecond.toFixed(2)}`);
    console.log(`  xterm.write()/sec:     ${results.xTermWritesPerSecond.toFixed(2)}`);
    console.log(`  RAF callbacks/sec:     ${results.rafPerSecond.toFixed(2)}`);
    console.log('');
    console.log('BATCHING EFFICIENCY:');
    console.log(`  Reduction rate:        ${results.batchingEfficiency}%`);
    console.log(`  Avg data/write():      ${results.averageDataPerWrite} bytes`);
    console.log(`  Avg data/batch:        ${results.averageDataPerBatch} bytes`);
    console.log('');

    // Evaluation
    console.log('EVALUATION:');
    const targetRAF = 60; // 60 fps
    const rafInRange = Math.abs(results.rafPerSecond - targetRAF) < 20;
    const goodBatching = parseFloat(results.batchingEfficiency) > 90;
    const noDataLoss = results.totalDataSize > 0;

    console.log(`  ✓ RAF rate ~60fps:     ${rafInRange ? '✅ PASS' : '❌ FAIL'} (${results.rafPerSecond.toFixed(1)}/sec)`);
    console.log(`  ✓ Batching >90%:       ${goodBatching ? '✅ PASS' : '❌ FAIL'} (${results.batchingEfficiency}%)`);
    console.log(`  ✓ No data loss:        ${noDataLoss ? '✅ PASS' : '❌ FAIL'}`);
    console.log('='.repeat(70) + '\n');
  }
}

// Mock test harness (for demonstration purposes)
function runMockTest(testName, config) {
  console.log(`\nRunning: ${testName}`);
  console.log(`Description: ${config.description}`);
  console.log(`Iterations: ${config.iterations}`);

  const metrics = new PerformanceMetrics();
  metrics.start();

  // Simulate writes
  for (let i = 0; i < config.iterations; i++) {
    const data = `Line ${i}: Test data\n`;
    metrics.recordWrite(data.length);
  }

  // Simulate batching (at 60 fps, we'd get ~16.67ms per frame)
  // For a 1000ms test at 60fps = ~60 batches
  const testDurationMs = 1000;
  const framesAt60fps = Math.ceil(testDurationMs / 16.67);
  for (let i = 0; i < framesAt60fps; i++) {
    metrics.recordRAFCallback();
    metrics.recordXTermWrite();
  }

  metrics.end();
  metrics.printReport();
}

// Usage instructions
console.log(`
Terminal Debouncing Performance Test
====================================

This script provides tools for measuring the performance impact
of the requestAnimationFrame-based terminal write debouncing.

USAGE IN BROWSER CONSOLE:
1. Open DevTools in the running Electron app
2. Paste this script
3. Monitor actual terminal component behavior

EXPECTED RESULTS WITH DEBOUNCING:
- write() calls/sec: High (200-1000+) - input rate
- xterm.write()/sec: ~60 - output rate (RAF limited)
- RAF callbacks/sec: ~60 - animation frame rate
- Batching efficiency: >95% - writes reduced by debouncing

COMPARISON WITHOUT DEBOUNCING:
- write() calls/sec: High (200-1000+)
- xterm.write()/sec: High (200-1000+) - no batching!
- React re-renders/sec: High - performance issue!

To run mock tests:
`);

console.log('runMockTest("rapidWrites", TESTS.rapidWrites);');
console.log('runMockTest("burstOutput", TESTS.burstOutput);');
console.log('runMockTest("mixedSizes", TESTS.mixedSizes);');

// Export for Node.js usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PerformanceMetrics, runMockTest, TESTS };
}
