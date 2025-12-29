# SWE-bench Benchmark User Guide

This guide walks you through running SWE-bench evaluations in autoclaude, from selecting a benchmark variant to interpreting your results.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [UI Walkthrough](#ui-walkthrough)
  - [Selection Tab](#selection-tab)
  - [Monitor Tab](#monitor-tab)
  - [Results Tab](#results-tab)
- [Configuration Options](#configuration-options)
  - [Benchmark Variants](#benchmark-variants)
  - [Execution Settings](#execution-settings)
  - [Cache Levels](#cache-levels)
- [Running a Benchmark](#running-a-benchmark)
- [Interpreting Results](#interpreting-results)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)
- [FAQ](#faq)

---

## Overview

SWE-bench is an industry-standard benchmark for evaluating AI systems on real-world software engineering tasks. Autoclaude's SWE-bench integration allows you to:

- **Evaluate** your autoclaude setup against standardized test cases
- **Compare** performance across different benchmark variants
- **Analyze** detailed metrics including resolve rate and test success
- **Track** progress with real-time monitoring

The benchmark works by presenting autoclaude with real GitHub issues and evaluating whether the generated code patches successfully resolve those issues.

---

## Prerequisites

Before running SWE-bench evaluations, ensure you have:

### Required

1. **Docker** - Must be installed and running
   ```bash
   # Verify Docker is running
   docker info
   ```

2. **Disk Space** - At least 10GB free (for Docker images)
   ```bash
   # Check disk space
   df -h
   # Check Docker disk usage
   docker system df
   ```

3. **Backend Setup** - SWE-bench service installed
   ```bash
   cd apps/backend
   pip install -r requirements.txt

   # Install SWE-bench (from GitHub)
   git clone https://github.com/princeton-nlp/SWE-bench.git
   pip install -e ./SWE-bench
   ```

### Recommended

- **8GB+ RAM** for Docker container execution
- **x86_64 architecture** (ARM/Apple Silicon has compatibility caveats)
- **HuggingFace account** for higher rate limits on dataset downloads

---

## Getting Started

1. **Launch the Frontend**
   ```bash
   cd apps/frontend
   npm install
   npm run dev
   ```

2. **Navigate to Benchmarks**
   Open `http://localhost:3000` and navigate to the benchmark dashboard.

3. **Check Infrastructure**
   Click the "Check Infrastructure" button to verify your setup meets all requirements.

---

## UI Walkthrough

The benchmark dashboard consists of three main tabs: **Selection**, **Monitor**, and **Results**.

### Selection Tab

The Selection tab is where you configure your benchmark run.

#### Benchmark Variant Selector

Choose from 5 SWE-bench variants, each displayed as a card showing:
- **Name** - The variant identifier (Lite, Verified, Full, Multimodal, Multilingual)
- **Instance Count** - Number of test cases in the variant
- **Description** - Brief explanation of what the variant covers

Click a variant card to select it. The selected variant will be highlighted with a border.

#### Configuration Panel

Below the variant selector, you'll find configuration options:

- **Max Workers** - Number of parallel evaluation processes
- **Instance Count** - How many instances to evaluate
- **Cache Level** - Docker image caching strategy

See [Configuration Options](#configuration-options) for detailed explanations.

#### Infrastructure Status

At the bottom, the Infrastructure Status panel shows:

| Metric | Good Value | Warning |
|--------|-----------|---------|
| Docker | Available | Not Available (blocking) |
| Disk Space | 10GB+ | <10GB (warning) |
| CPU Cores | Auto-detected | N/A |
| Recommended Workers | ~75% of cores | N/A |
| Architecture | x86_64 | ARM (warning) |

### Monitor Tab

The Monitor tab provides real-time progress tracking during benchmark execution.

#### Status Badge

Shows the current execution state:
- **Ready** (gray) - Waiting to start
- **Loading...** (amber) - Loading dataset
- **Running** (blue) - Executing instances
- **Completed** (green) - Finished successfully
- **Failed** (red) - Execution error

#### Progress Bar

Visual indicator showing completion percentage:
- Shows `X / Y (Z%)` format
- Animated indicator when running
- Pulsing effect when in indeterminate state (just starting)

#### Current Instance

Displays the instance ID currently being processed:
- Shows the full `owner__repo-pr_number` format
- Updates in real-time as execution progresses

#### Time Statistics

Two metrics cards showing:

1. **Elapsed Time** - How long the benchmark has been running
2. **Est. Remaining** - Estimated time to completion with target finish time

#### Instance Progress (for small runs)

For benchmarks with ≤50 instances, individual progress dots are shown:
- Green = completed
- Blue (pulsing) = currently processing
- Gray = pending

### Results Tab

The Results tab visualizes benchmark outcomes after completion.

#### Key Metrics Cards

Three primary metrics displayed at the top:

1. **Resolve Rate** - Percentage of issues successfully resolved
2. **Patch Application Success** - Percentage of patches that applied cleanly
3. **Test Pass Rate** - Percentage of test assertions passed

#### Status Distribution Pie Chart

Visual breakdown of instance outcomes:
- **Resolved** (green) - Successfully fixed the issue
- **Unresolved** (red) - Failed to fix
- **Error** (amber) - Execution or evaluation error

#### Test Metrics Bar Chart

Stacked bar chart showing:
- **Fail-to-Pass** - Tests that should pass after fix
- **Pass-to-Pass** - Existing tests that should continue passing

#### Instance Breakdown Table

Detailed per-instance results with:
- Instance ID
- Status (resolved/unresolved/error)
- Test results summary

Features:
- **Search** - Filter by instance ID
- **Status filter** - Show only specific statuses
- **Expandable rows** - View detailed test results

---

## Configuration Options

### Benchmark Variants

| Variant | Instances | Best For |
|---------|-----------|----------|
| **Lite** | 300 | Development, quick testing, CI/CD |
| **Verified** | 500 | Research, quality-focused evaluation |
| **Full** | 2,294 | Comprehensive assessment, publications |
| **Multimodal** | ~617 | Testing visual/image understanding |
| **Multilingual** | ~510 | Non-English repository evaluation |

#### Choosing a Variant

- **Just testing?** Start with **Lite** - it's fast and representative
- **Want quality data?** Use **Verified** - human-curated instances
- **Need full coverage?** Use **Full** - complete benchmark suite
- **Testing specific capabilities?** Use **Multimodal** or **Multilingual**

### Execution Settings

#### Max Workers

Controls parallel evaluation processes.

| Setting | Effect |
|---------|--------|
| 1 | Sequential processing (safest, slowest) |
| 2-4 | Light parallelism (good for most systems) |
| 4+ | High parallelism (requires more resources) |

**Recommendation**: Use the auto-calculated value (shown as "Recommended Workers" in Infrastructure Status), which is ~75% of your CPU cores.

**Warning**: Setting this too high can:
- Cause system slowdown or freeze
- Trigger out-of-memory errors
- Result in Docker container failures

#### Instance Count

Number of benchmark instances to evaluate.

| Setting | Trade-off |
|---------|----------|
| 10-20 | Quick validation (~5-15 minutes) |
| 50-100 | Reasonable sample (~30-60 minutes) |
| 100+ | Statistically significant (~1-4 hours) |
| All | Full benchmark (hours to days) |

**Tip**: Start with 10 instances to validate your setup works, then increase.

### Cache Levels

Docker image caching strategy affects speed vs. disk usage.

| Level | Description | Speed | Disk Usage |
|-------|-------------|-------|------------|
| **None** | No caching, rebuild everything | Slowest | Lowest |
| **Base** | Cache base OS and runtime | Slow | Low |
| **Environment** (Recommended) | Cache repo setup | Fast | Medium |
| **Instance** | Cache everything | Fastest | Highest |

**Recommendations**:
- Use **Environment** for most runs (balanced)
- Use **None** if you have disk space issues
- Use **Instance** if running repeatedly on same instances

---

## Running a Benchmark

### Step-by-Step

1. **Verify Infrastructure**
   - Click "Check Infrastructure" button
   - Ensure Docker shows "Available"
   - Ensure disk space shows ≥10GB
   - Address any warnings before proceeding

2. **Select Variant**
   - Click on your desired benchmark variant card
   - For first run, we recommend **Lite**

3. **Configure Settings**
   - Set **Max Workers** (or use default)
   - Set **Instance Count** (start with 10-20 for testing)
   - Set **Cache Level** (Environment recommended)

4. **Start Benchmark**
   - Click "Start Benchmark" button
   - Dashboard auto-switches to Monitor tab

5. **Monitor Progress**
   - Watch the progress bar fill
   - Current instance ID updates in real-time
   - Estimated completion time updates as execution progresses

6. **View Results**
   - Dashboard auto-switches to Results tab when complete
   - Review resolve rate and other metrics
   - Explore instance breakdown for details

### Canceling a Run

If you need to stop a benchmark mid-execution:
1. Click the **Cancel** button (red, appears during execution)
2. A checkpoint is saved automatically
3. You can resume from this checkpoint in future runs

---

## Interpreting Results

### Understanding Resolve Rate

The **resolve rate** is the primary success metric:

| Resolve Rate | Interpretation |
|--------------|----------------|
| 0-10% | System struggling with benchmark |
| 10-25% | Below typical LLM baseline |
| 25-40% | Competitive range |
| 40-60% | Strong performance |
| 60%+ | Excellent (verify gold patch validation) |

### Understanding Test Metrics

#### Fail-to-Pass (F2P)
Tests that were failing before the fix and should pass after. High F2P success means the patch correctly addresses the issue.

#### Pass-to-Pass (P2P)
Existing tests that were passing and should continue to pass. High P2P success means the patch doesn't break existing functionality.

### Instance Status Meanings

| Status | Meaning |
|--------|---------|
| **Resolved** | Patch successfully fixed the issue |
| **Unresolved** | Patch applied but tests failed |
| **Error** | Something went wrong during evaluation |
| **Timeout** | Instance exceeded time limit |

---

## Troubleshooting

### Common Issues

#### Docker Not Available

**Symptom**: Red warning "Docker is not available"

**Solutions**:
1. Start Docker Desktop (macOS/Windows) or Docker daemon (Linux)
   ```bash
   # Linux
   sudo systemctl start docker
   ```
2. Wait a few seconds for Docker to initialize
3. Click "Check Infrastructure" to refresh status

#### Insufficient Disk Space

**Symptom**: Warning showing <10GB available

**Solutions**:
1. Free up disk space:
   ```bash
   # Clean unused Docker resources
   docker system prune -a
   ```
2. Move Docker data directory to a larger drive
3. Delete old benchmark results/checkpoints

#### ARM Architecture Warning

**Symptom**: Warning "ARM Architecture Detected"

**This means**: You're running on Apple Silicon (M1/M2/M3) or another ARM processor. Some evaluation containers may not work correctly.

**Solutions**:
1. Some containers work with Rosetta 2 emulation
2. Use `cache_level="none"` if encountering issues
3. For best results, use an x86_64 machine

#### Evaluation Failures

**Symptom**: High error rate in results

**Common causes**:
1. **Insufficient memory** - Close other applications, increase Docker memory
2. **Network issues** - Check internet connectivity for HuggingFace dataset access
3. **Container conflicts** - Run `docker system prune` and retry

#### Slow Performance

**Symptom**: Benchmark taking longer than expected

**Solutions**:
1. Reduce `max_workers` to lower resource contention
2. Use higher cache level (Environment or Instance)
3. Close resource-intensive applications
4. Pre-pull base Docker images

### Getting Help

If issues persist:
1. Check Docker logs: `docker logs <container_id>`
2. Review backend logs in terminal
3. Verify SWE-bench installation: `python -c "import swebench; print('OK')"`

---

## Known Limitations

### Architecture

| Limitation | Impact | Workaround |
|------------|--------|------------|
| x86_64 only | ARM systems may have container compatibility issues | Use x86_64 machine or accept potential failures |

### Execution

| Limitation | Impact | Future Plans |
|------------|--------|--------------|
| Sequential execution | One instance at a time per worker | Parallel instance execution planned |
| Local only | No cloud execution (Modal/AWS) | Cloud support planned for v2 |
| No historical comparison | Can't compare runs over time | Results persistence planned |

### Resources

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| 10GB+ disk required | Docker images are large | Use lower cache levels or prune regularly |
| 8GB+ RAM recommended | Containers need memory | Close other applications |
| Network required | Dataset download from HuggingFace | Cache datasets for offline use |

### Datasets

| Limitation | Impact | Notes |
|------------|--------|-------|
| Multimodal test assets | Test split images are private | Use dev split for development |
| Rate limiting | HuggingFace may throttle downloads | Set HF_TOKEN for higher limits |

---

## FAQ

### Q: How long does a full benchmark run take?

**A**: Depends on your hardware and variant:
- Lite (300 instances): 2-6 hours
- Verified (500 instances): 4-10 hours
- Full (2,294 instances): 12-48 hours

### Q: Can I run benchmarks in the background?

**A**: Yes! Once started, the benchmark continues running even if you navigate away. The Monitor tab will show progress when you return.

### Q: What happens if my computer sleeps or restarts?

**A**: The benchmark will be interrupted, but:
- A checkpoint is saved automatically
- You can resume from where you left off
- Set your computer to prevent sleep during long runs

### Q: How do I compare different runs?

**A**: Currently, results are displayed for the most recent run. For comparisons:
1. Export results manually (from predictions.jsonl)
2. Keep notes of key metrics
3. Historical comparison feature is planned for a future release

### Q: Can I evaluate on specific instances only?

**A**: Not through the UI currently. For specific instance evaluation:
1. Use the Python API directly
2. Filter instances when loading the dataset
3. Set `instance_count` to limit total instances

### Q: Why is my resolve rate different from published benchmarks?

**A**: Several factors can affect resolve rate:
1. Different model configurations
2. Infrastructure differences
3. Random seed variations
4. Different evaluation harness versions

For comparable results, use identical settings and verify with gold patches first.

### Q: How do I validate my infrastructure works correctly?

**A**: Run a "gold patch" evaluation first:
```python
from apps.backend.services.swebench import execute_gold_evaluation

result = execute_gold_evaluation(variant='lite', max_instances=5)
print(f"Gold patch resolve rate: {result['resolve_rate']}%")
# Should be >90% if infrastructure is working correctly
```

---

## Quick Reference

### Keyboard Shortcuts

*(Currently no keyboard shortcuts implemented)*

### Status Colors

| Color | Meaning |
|-------|---------|
| Green | Success/Available/Resolved |
| Blue | Running/In Progress |
| Amber | Warning/Loading |
| Red | Error/Failed/Unavailable |
| Gray | Idle/Pending |

### Recommended First Run Settings

| Setting | Value |
|---------|-------|
| Variant | Lite |
| Max Workers | (Use default) |
| Instance Count | 10 |
| Cache Level | Environment |

This gives you a quick validation run that should complete in 5-15 minutes.

---

## Additional Resources

- [Backend API Documentation](../apps/backend/services/swebench/API.md)
- [Backend Service README](../apps/backend/services/swebench/README.md)
- [SWE-bench Paper](https://arxiv.org/abs/2310.06770)
- [SWE-bench GitHub](https://github.com/princeton-nlp/SWE-bench)
- [HuggingFace Datasets](https://huggingface.co/princeton-nlp)
