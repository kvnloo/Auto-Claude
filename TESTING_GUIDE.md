# Terminal Debouncing - Manual Testing Guide

## Overview

This guide provides step-by-step instructions for manually testing the terminal output debouncing implementation. The goal is to verify that the requestAnimationFrame-based batching reduces React re-renders without causing visual glitches or data loss.

## Prerequisites

1. **Build and run the Electron app:**
   ```bash
   npm run dev
   ```

2. **Open Browser DevTools:**
   - Press `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Windows/Linux)
   - Navigate to the **Performance** tab
   - Enable "Screenshots" option for visual timeline

## Test Scenarios

### Test 1: Automated Test Script

Run the provided test script that generates various high-frequency output patterns:

```bash
chmod +x ./test-terminal-debounce.sh
./test-terminal-debounce.sh
```

**What to observe:**
- [ ] Output renders smoothly without lag
- [ ] Colors and formatting are preserved
- [ ] Unicode and emoji display correctly
- [ ] No visible data loss or corruption
- [ ] Terminal remains responsive

### Test 2: Real npm install

Test with actual npm operations:

```bash
# Navigate to a large project (e.g., frontend)
cd apps/frontend

# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

**What to observe:**
- [ ] Package installation output is smooth
- [ ] Progress indicators animate correctly
- [ ] No freezing or UI blocking
- [ ] All package names visible
- [ ] Terminal scrollback works properly

### Test 3: Build Commands

Run build processes that generate lots of output:

```bash
# Frontend build
cd apps/frontend
npm run build

# Or backend operations
cd apps/backend
python -m pytest tests/ -v
```

**What to observe:**
- [ ] Build output renders without delays
- [ ] Error messages (if any) display immediately
- [ ] Compilation progress visible
- [ ] No missed output

### Test 4: Rapid Command Execution

Test with loops that generate burst output:

```bash
# Large loop (1000 iterations)
for i in {1..1000}; do echo "Line $i: Testing debouncing with rapid output"; done

# With colors
for i in {1..500}; do echo -e "\033[3$((i % 8))mColored line $i\033[0m"; done

# With progress simulation
for i in {1..100}; do printf "\rProgress: %d%%" $i; sleep 0.01; done; echo
```

**What to observe:**
- [ ] All lines render (count should match)
- [ ] Colors preserved throughout
- [ ] Progress bars update smoothly
- [ ] No tearing or corruption

### Test 5: Python Backend Operations

Test with Python script output:

```bash
cd apps/backend

# Run with verbose output
python -c "for i in range(1000): print(f'Python line {i}')"

# Or run tests
python -m pytest tests/ -v -s
```

**What to observe:**
- [ ] Python output renders correctly
- [ ] Test results visible
- [ ] No data loss

### Test 6: Mixed Write/Writeln

Test the immediate writeln() behavior:

```bash
# This should show immediate error-like messages
(for i in {1..50}; do echo "Regular write $i"; done) &
sleep 0.5 && echo "IMPORTANT MESSAGE" &&
(for i in {51..100}; do echo "Regular write $i"; done)
```

**What to observe:**
- [ ] "IMPORTANT MESSAGE" appears immediately
- [ ] No buffering delays for critical output

## Performance Measurement

### Using Chrome DevTools Performance Tab

1. **Start Recording:**
   - Open Performance tab
   - Click the record button (⚫)

2. **Run Test Scenario:**
   - Execute one of the high-output tests above
   - Let it run for 5-10 seconds

3. **Stop Recording:**
   - Click stop button (⏹)

4. **Analyze Results:**
   - Look for "Scripting" time (should be reduced)
   - Check "Rendering" events (should be fewer)
   - Examine flame chart for React component updates
   - Count number of layout/paint operations

5. **Key Metrics to Compare:**
   - **Before debouncing:** Hundreds of updates per second
   - **After debouncing:** ~60 updates per second (matches RAF at 60fps)

### Using React DevTools Profiler

1. **Install React DevTools** (if not already installed)

2. **Start Profiling:**
   - Open React DevTools
   - Go to Profiler tab
   - Click "Start Profiling"

3. **Run Test:**
   - Execute terminal output test
   - Let it run for a few seconds

4. **Stop and Analyze:**
   - Look at component render count
   - Check render duration
   - Verify Terminal/useXterm renders are reduced

## Expected Results

### Performance Improvements

| Metric | Before Debouncing | After Debouncing |
|--------|------------------|------------------|
| Terminal writes/sec | 200-1000+ | ~60 (RAF limited) |
| React re-renders/sec | 200-1000+ | ~60 |
| Max output latency | Immediate | ~16ms (imperceptible) |
| UI responsiveness | Can lag | Smooth |

### Visual Quality

- ✅ No visual glitches or artifacts
- ✅ Colors and ANSI codes preserved
- ✅ Unicode and emoji render correctly
- ✅ Scrollback history intact
- ✅ No data loss or truncation

### Edge Cases

- ✅ Component unmount flushes buffer (no data loss)
- ✅ Rapid mount/unmount cycles handled
- ✅ writeln() provides immediate output for errors
- ✅ Empty writes don't cause issues
- ✅ Very large writes (10KB+) handled correctly

## Troubleshooting

### Issue: Output seems delayed

**Possible causes:**
- Debouncing working as designed (max 16ms delay)
- Check if delay is actually perceptible
- Verify RAF is scheduling correctly

**Debug steps:**
1. Add console timing logs to flushWriteBuffer
2. Check rafIdRef state
3. Verify requestAnimationFrame is being called

### Issue: Data loss or corruption

**Possible causes:**
- Buffer not flushing on unmount
- RAF canceled prematurely
- Unicode/ANSI handling issue

**Debug steps:**
1. Check dispose() logic
2. Verify writeBufferRef is being cleared
3. Test with simplified ASCII-only output

### Issue: Performance not improved

**Possible causes:**
- RAF not batching correctly
- Multiple RAF frames being scheduled
- Other performance bottlenecks

**Debug steps:**
1. Profile with DevTools to identify bottleneck
2. Check RAF scheduling logic
3. Verify only one RAF is scheduled at a time

## Test Results Documentation

Use this template to document your test results:

```markdown
## Test Results - [Date]

### Environment
- OS: [macOS/Windows/Linux]
- Browser: [Electron/Chrome version]
- Node: [version]

### Test 1: Automated Script
- Status: ✅ Pass / ❌ Fail
- Notes:

### Test 2: npm install
- Status: ✅ Pass / ❌ Fail
- Notes:

### Test 3: Build Commands
- Status: ✅ Pass / ❌ Fail
- Notes:

### Test 4: Rapid Execution
- Status: ✅ Pass / ❌ Fail
- Notes:

### Performance Metrics
- React re-renders/sec: [before] → [after]
- Scripting time: [before] → [after]
- Visual smoothness: [1-10 rating]

### Issues Found
1. [Issue description]
   - Severity: High/Medium/Low
   - Reproduction: [steps]

### Conclusion
- Overall result: ✅ Pass / ❌ Fail
- Ready for merge: Yes / No
- Additional work needed: [description]
```

## Sign-off Checklist

Before marking this subtask as complete, verify:

- [ ] Automated test script runs successfully
- [ ] npm install output is smooth in large projects
- [ ] Build commands work without visual issues
- [ ] Rapid command execution shows no data loss
- [ ] Claude interactions still work correctly
- [ ] Terminal scrolling performance maintained/improved
- [ ] DevTools shows reduced React re-renders
- [ ] No console errors or warnings
- [ ] All test scenarios documented
- [ ] Performance improvement is measurable

## Next Steps

After all tests pass:
1. Document results in build-progress.txt
2. Update subtask 2.1 status to "completed" in implementation_plan.json
3. Commit test scripts and documentation
4. Proceed to QA review
