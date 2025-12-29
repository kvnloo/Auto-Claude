"""
SWE-bench Evaluation CLI
========================

Command-line interface for running SWE-bench benchmark evaluations.
Orchestrates the evaluation of autoclaude's coding capabilities against
the SWE-bench dataset using the adapter pattern.
"""

import argparse
import sys
from pathlib import Path

# Ensure parent directory is in path for imports (before other imports)
_PARENT_DIR = Path(__file__).parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))


def parse_args() -> argparse.Namespace:
    """Parse command line arguments for SWE-bench evaluation."""
    parser = argparse.ArgumentParser(
        description="SWE-bench Evaluation - Benchmark autoclaude against SWE-bench dataset",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run evaluation on SWE-bench_Lite (recommended starting point)
  python -m cli.swebench_eval --dataset princeton-nlp/SWE-bench_Lite

  # Run with limited instances for testing
  python -m cli.swebench_eval --dataset princeton-nlp/SWE-bench_Lite --max-instances 10

  # Run with parallel workers
  python -m cli.swebench_eval --dataset princeton-nlp/SWE-bench_Lite --max-workers 4

  # Resume an interrupted evaluation
  python -m cli.swebench_eval --resume --run-id my-evaluation-run

  # Full evaluation with all options
  python -m cli.swebench_eval \\
    --dataset princeton-nlp/SWE-bench_Lite \\
    --max-workers 4 \\
    --max-instances 100 \\
    --run-id my-run-001 \\
    --output-dir ./results

Dataset Options:
  princeton-nlp/SWE-bench        Full dataset (2,294 instances)
  princeton-nlp/SWE-bench_Lite   Lite dataset (300 instances) - recommended
  princeton-nlp/SWE-bench_Verified  Verified subset

Output Files:
  predictions.jsonl   SWE-bench compatible predictions
  report.json         Evaluation metrics and statistics
  checkpoint.json     Progress checkpoint for resume capability

Prerequisites:
  1. Docker daemon running (required for SWE-bench harness)
  2. HuggingFace datasets library installed (pip install datasets)
  3. Sufficient disk space for Docker images (multi-GB)
        """,
    )

    # Required arguments
    parser.add_argument(
        "--dataset",
        type=str,
        default="princeton-nlp/SWE-bench_Lite",
        help="HuggingFace dataset to evaluate (default: princeton-nlp/SWE-bench_Lite)",
    )

    # Instance control
    parser.add_argument(
        "--max-instances",
        type=int,
        default=None,
        help="Maximum number of instances to process (default: all)",
    )

    # Parallelization
    parser.add_argument(
        "--max-workers",
        type=int,
        default=1,
        help="Number of parallel workers for evaluation (default: 1)",
    )

    # Run identification
    parser.add_argument(
        "--run-id",
        type=str,
        default=None,
        help="Unique identifier for this evaluation run (auto-generated if not provided)",
    )

    # Resume capability
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume an interrupted evaluation from checkpoint",
    )

    # Output configuration
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory for output files (default: .auto-claude/swebench/)",
    )

    # Timeout configuration
    parser.add_argument(
        "--timeout",
        type=int,
        default=1800,
        help="Timeout per instance in seconds (default: 1800 = 30 minutes)",
    )

    # Model configuration
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Model to use for evaluation (default: from environment)",
    )

    # Verbosity
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose output",
    )

    # Dry run mode
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate configuration without running evaluation",
    )

    # Skip Docker check (for testing)
    parser.add_argument(
        "--skip-docker-check",
        action="store_true",
        help="Skip Docker availability check (for testing only)",
    )

    return parser.parse_args()


def main() -> int:
    """Main entry point for SWE-bench evaluation CLI."""
    # Parse args first so --help works without requiring all dependencies
    args = parse_args()

    # Import dependencies after argparse has handled --help
    import asyncio
    import logging

    from swebench.orchestrator import SWEBenchOrchestrator

    # Configure logging
    if args.verbose:
        logging.basicConfig(
            level=logging.DEBUG,
            format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        )
    else:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s - %(levelname)s - %(message)s",
        )

    # Display configuration
    print("=" * 70)
    print("  SWE-BENCH EVALUATION")
    print("=" * 70)
    print()
    print(f"  Dataset:       {args.dataset}")
    print(f"  Max instances: {args.max_instances or 'all'}")
    print(f"  Max workers:   {args.max_workers}")
    print(f"  Run ID:        {args.run_id or '(auto-generated)'}")
    print(f"  Resume:        {args.resume}")
    print(f"  Timeout:       {args.timeout}s per instance")
    print(f"  Output dir:    {args.output_dir or '.auto-claude/swebench/'}")
    print()

    if args.dry_run:
        print("Dry run mode - configuration validated, exiting.")
        return 0

    # Create and run orchestrator
    try:
        orchestrator = SWEBenchOrchestrator(
            dataset_name=args.dataset,
            max_instances=args.max_instances,
            max_workers=args.max_workers,
            run_id=args.run_id,
            output_dir=args.output_dir,
            timeout_per_instance=args.timeout,
            model=args.model,
            skip_docker_check=args.skip_docker_check,
        )

        # Run the evaluation
        metrics = asyncio.run(orchestrator.run(resume=args.resume))

        # Print summary
        print()
        print("=" * 70)
        print("  EVALUATION COMPLETE")
        print("=" * 70)
        print()
        print(f"  Total instances:      {metrics.total_instances}")
        print(f"  Completed:            {metrics.completed_instances}")
        print(f"  Successful:           {metrics.successful_instances}")
        print(f"  Failed:               {metrics.failed_instances}")
        print(f"  Errors:               {metrics.error_instances}")
        print(f"  Resolution rate:      {metrics.resolution_rate:.1%}")
        print(f"  Total time:           {metrics.total_execution_time_seconds:.1f}s")
        print()
        print(f"  Predictions file:     {orchestrator.predictions_file}")
        print(f"  Report file:          {orchestrator.report_file}")
        print(f"  Checkpoint file:      {orchestrator.checkpoint_file}")
        print()

        return 0

    except KeyboardInterrupt:
        print("\nEvaluation interrupted by user.")
        print("Use --resume to continue from the last checkpoint.")
        return 130

    except Exception as e:
        print(f"\nError: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
