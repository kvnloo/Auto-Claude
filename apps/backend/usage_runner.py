#!/usr/bin/env python3
"""
Usage Runner CLI
=================

CLI entry point for token usage operations. Designed for IPC communication
with the frontend via JSON output.

Supported Commands:
    get_summary          Get usage summary for a project
    get_by_date_range    Get usage data for a specific date range
    get_by_agent         Get usage breakdown by agent type
    export_csv           Export usage data to CSV format

Usage:
    python usage_runner.py get_summary --project-dir /path/to/project
    python usage_runner.py get_by_date_range --project-dir /path/to/project --start 2025-01-01 --end 2025-01-31
    python usage_runner.py get_by_agent --project-dir /path/to/project
    python usage_runner.py export_csv --project-dir /path/to/project --output report.csv

Exit Codes:
    0 - Success
    1 - Error (invalid arguments, file not found, etc.)
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path


def setup_path():
    """Add parent directory to path for imports."""
    parent_dir = Path(__file__).parent
    if str(parent_dir) not in sys.path:
        sys.path.insert(0, str(parent_dir))


# Set up path before imports
setup_path()


def output_json(data: dict, success: bool = True) -> None:
    """Output JSON response for IPC consumption."""
    response = {
        "success": success,
        "data": data,
    }
    print(json.dumps(response, indent=2))


def output_error(message: str, code: str = "ERROR") -> None:
    """Output error response in JSON format."""
    response = {
        "success": False,
        "error": {
            "code": code,
            "message": message,
        },
    }
    print(json.dumps(response, indent=2))
    sys.exit(1)


def parse_date(date_str: str) -> datetime:
    """Parse date string in YYYY-MM-DD format."""
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        output_error(
            f"Invalid date format: '{date_str}'. Use YYYY-MM-DD.",
            code="INVALID_DATE"
        )


def validate_project_dir(project_dir: str | None) -> Path:
    """Validate and return the project directory path."""
    if not project_dir:
        output_error(
            "--project-dir is required",
            code="MISSING_PROJECT_DIR"
        )

    path = Path(project_dir)
    if not path.exists():
        output_error(
            f"Project directory does not exist: {project_dir}",
            code="PROJECT_NOT_FOUND"
        )

    if not path.is_dir():
        output_error(
            f"Path is not a directory: {project_dir}",
            code="NOT_A_DIRECTORY"
        )

    return path


def cmd_get_summary(args: argparse.Namespace) -> None:
    """
    Get usage summary for a project.

    Returns aggregated usage statistics including:
    - Total tokens and costs
    - Session counts
    - Success/failure rates
    - Agent breakdown
    """
    from usage.aggregator import UsageAggregator

    project_dir = validate_project_dir(args.project_dir)

    try:
        aggregator = UsageAggregator(project_dir)

        # Parse optional date filters
        start_date = parse_date(args.start) if args.start else None
        end_date = parse_date(args.end) if args.end else None

        # Adjust end_date to end of day
        if end_date:
            end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)

        # Get summary
        summary = aggregator.get_usage_summary(
            start_date=start_date,
            end_date=end_date,
        )

        # Get efficiency score
        efficiency = aggregator.calculate_efficiency_score(
            start_date=start_date,
            end_date=end_date,
        )

        # Get trends
        cost_trend = aggregator.get_cost_trend(period="week")
        token_trend = aggregator.get_token_trend(period="week")

        data = {
            "summary": summary.to_dict(),
            "efficiency": efficiency.to_dict(),
            "trends": {
                "cost": cost_trend.to_dict(),
                "tokens": token_trend.to_dict(),
            },
        }

        output_json(data)

    except Exception as e:
        output_error(str(e), code="AGGREGATION_ERROR")


def cmd_get_by_date_range(args: argparse.Namespace) -> None:
    """
    Get usage data for a specific date range.

    Returns daily, weekly, and monthly breakdowns for the specified range.
    """
    from usage.aggregator import UsageAggregator

    project_dir = validate_project_dir(args.project_dir)

    # Date range is required for this command
    if not args.start or not args.end:
        output_error(
            "--start and --end are required for get_by_date_range",
            code="MISSING_DATE_RANGE"
        )

    start_date = parse_date(args.start)
    end_date = parse_date(args.end)

    # Validate date range
    if start_date > end_date:
        output_error(
            f"Start date ({args.start}) cannot be after end date ({args.end})",
            code="INVALID_DATE_RANGE"
        )

    # Adjust end_date to end of day
    end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)

    try:
        aggregator = UsageAggregator(project_dir)

        # Get daily usage
        daily = aggregator.get_daily_usage(
            start_date=start_date,
            end_date=end_date,
        )

        # Get weekly usage
        weekly = aggregator.get_weekly_usage(
            start_date=start_date,
            end_date=end_date,
        )

        # Get monthly usage
        monthly = aggregator.get_monthly_usage(
            start_date=start_date,
            end_date=end_date,
        )

        # Get per-spec usage for the range
        spec_usage = aggregator.get_usage_by_spec(
            start_date=start_date,
            end_date=end_date,
        )

        # Get total cost for the range
        total_cost = aggregator.get_total_cost(
            start_date=start_date,
            end_date=end_date,
        )

        data = {
            "date_range": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat(),
            },
            "daily": [d.to_dict() for d in daily],
            "weekly": weekly,  # Already serialized
            "monthly": monthly,  # Already serialized
            "by_spec": [s.to_dict() for s in spec_usage],
            "total_cost": round(total_cost, 4),
        }

        output_json(data)

    except Exception as e:
        output_error(str(e), code="DATE_RANGE_QUERY_ERROR")


def cmd_get_by_agent(args: argparse.Namespace) -> None:
    """
    Get usage breakdown by agent type.

    Returns usage statistics for each agent type (planner, coder, qa, etc.)
    """
    from usage.aggregator import UsageAggregator

    project_dir = validate_project_dir(args.project_dir)

    try:
        aggregator = UsageAggregator(project_dir)

        # Parse optional date filters
        start_date = parse_date(args.start) if args.start else None
        end_date = parse_date(args.end) if args.end else None

        # Adjust end_date to end of day
        if end_date:
            end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)

        # Get usage by agent type
        agent_usage = aggregator.get_usage_by_agent_type(
            start_date=start_date,
            end_date=end_date,
        )

        # Convert to serializable format
        breakdown = {}
        for agent_key, usage in agent_usage.items():
            breakdown[agent_key] = usage.to_dict()

        # Calculate totals
        total_tokens = sum(u.total_tokens for u in agent_usage.values())
        total_cost = sum(u.total_cost_usd for u in agent_usage.values())
        total_sessions = sum(u.session_count for u in agent_usage.values())

        data = {
            "breakdown": breakdown,
            "totals": {
                "tokens": total_tokens,
                "cost_usd": round(total_cost, 4),
                "sessions": total_sessions,
            },
        }

        if start_date and end_date:
            data["date_range"] = {
                "start": start_date.isoformat(),
                "end": end_date.isoformat(),
            }

        output_json(data)

    except Exception as e:
        output_error(str(e), code="AGENT_BREAKDOWN_ERROR")


def cmd_export_csv(args: argparse.Namespace) -> None:
    """
    Export usage data to CSV format.

    If --output is provided, writes to file. Otherwise, returns CSV content.
    """
    from usage.exporter import UsageExporter

    project_dir = validate_project_dir(args.project_dir)

    try:
        exporter = UsageExporter(project_dir)

        # Parse optional filters
        start_date = parse_date(args.start) if args.start else None
        end_date = parse_date(args.end) if args.end else None

        # Adjust end_date to end of day
        if end_date:
            end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)

        # Spec filter
        spec_id = args.spec if args.spec else None

        # Include summary row
        include_summary = not args.no_summary

        if args.output:
            # Export to file
            output_path = Path(args.output)

            result_path = exporter.export_to_file(
                output_path=output_path,
                spec_id=spec_id,
                start_date=start_date,
                end_date=end_date,
                include_summary=include_summary,
            )

            # Get record count for confirmation
            record_count = exporter.get_record_count(
                spec_id=spec_id,
                start_date=start_date,
                end_date=end_date,
            )

            data = {
                "file_path": str(result_path.absolute()),
                "record_count": record_count,
                "message": f"Exported {record_count} records to {result_path}",
            }
        else:
            # Return CSV content
            csv_content = exporter.export_to_csv(
                spec_id=spec_id,
                start_date=start_date,
                end_date=end_date,
                include_summary=include_summary,
            )

            record_count = exporter.get_record_count(
                spec_id=spec_id,
                start_date=start_date,
                end_date=end_date,
            )

            data = {
                "csv_content": csv_content,
                "record_count": record_count,
            }

        output_json(data)

    except Exception as e:
        output_error(str(e), code="EXPORT_ERROR")


def cmd_get_specs(args: argparse.Namespace) -> None:
    """
    Get list of specs with usage data.

    Returns list of spec IDs that have recorded usage.
    """
    from usage.store import TokenUsageStore
    from usage.aggregator import UsageAggregator

    project_dir = validate_project_dir(args.project_dir)

    try:
        store = TokenUsageStore(project_dir)
        aggregator = UsageAggregator(project_dir)

        # Get spec IDs with usage
        spec_ids = store.get_unique_spec_ids()

        # Get detailed info for each spec
        specs = []
        for spec_id in spec_ids:
            spec_usage_list = aggregator.get_usage_by_spec()
            spec_info = next(
                (s for s in spec_usage_list if s.spec_id == spec_id),
                None
            )
            if spec_info:
                specs.append(spec_info.to_dict())

        data = {
            "specs": specs,
            "total_specs": len(specs),
        }

        output_json(data)

    except Exception as e:
        output_error(str(e), code="SPECS_QUERY_ERROR")


def create_parser() -> argparse.ArgumentParser:
    """Create the argument parser with all subcommands."""
    parser = argparse.ArgumentParser(
        description="Token Usage CLI - Query and export usage data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Get usage summary
  python usage_runner.py get_summary --project-dir /path/to/project

  # Get usage for specific date range
  python usage_runner.py get_by_date_range --project-dir /path/to/project \\
      --start 2025-01-01 --end 2025-01-31

  # Get breakdown by agent type
  python usage_runner.py get_by_agent --project-dir /path/to/project

  # Export to CSV file
  python usage_runner.py export_csv --project-dir /path/to/project \\
      --output usage_report.csv

  # Export CSV content (for piping/IPC)
  python usage_runner.py export_csv --project-dir /path/to/project

Output Format:
  All commands output JSON with the structure:
  {
    "success": true/false,
    "data": { ... } or "error": { "code": "...", "message": "..." }
  }
        """,
    )

    subparsers = parser.add_subparsers(
        dest="command",
        title="commands",
        description="Available usage commands",
    )

    # Common arguments for all commands
    common_args = argparse.ArgumentParser(add_help=False)
    common_args.add_argument(
        "--project-dir",
        type=str,
        required=True,
        help="Path to the project directory",
    )

    # Date range arguments (optional for some commands)
    date_args = argparse.ArgumentParser(add_help=False)
    date_args.add_argument(
        "--start",
        type=str,
        default=None,
        metavar="YYYY-MM-DD",
        help="Start date for filtering (format: YYYY-MM-DD)",
    )
    date_args.add_argument(
        "--end",
        type=str,
        default=None,
        metavar="YYYY-MM-DD",
        help="End date for filtering (format: YYYY-MM-DD)",
    )

    # get_summary command
    summary_parser = subparsers.add_parser(
        "get_summary",
        parents=[common_args, date_args],
        help="Get usage summary for a project",
        description="""
Get aggregated usage summary including:
- Total tokens (input, output, thinking)
- Total cost in USD
- Session counts (success/failure)
- Efficiency scores
- Weekly trends
        """,
    )
    summary_parser.set_defaults(func=cmd_get_summary)

    # get_by_date_range command
    date_range_parser = subparsers.add_parser(
        "get_by_date_range",
        parents=[common_args, date_args],
        help="Get usage data for a specific date range",
        description="""
Get usage data for a date range including:
- Daily breakdown
- Weekly breakdown
- Monthly breakdown
- Per-spec usage
- Total cost for the period
        """,
    )
    date_range_parser.set_defaults(func=cmd_get_by_date_range)

    # get_by_agent command
    agent_parser = subparsers.add_parser(
        "get_by_agent",
        parents=[common_args, date_args],
        help="Get usage breakdown by agent type",
        description="""
Get usage breakdown by agent type including:
- Planner, Coder, QA agent stats
- Session counts per agent
- Success rates per agent
- Token and cost breakdown
        """,
    )
    agent_parser.set_defaults(func=cmd_get_by_agent)

    # export_csv command
    csv_parser = subparsers.add_parser(
        "export_csv",
        parents=[common_args, date_args],
        help="Export usage data to CSV format",
        description="""
Export usage records to CSV format.
If --output is specified, writes to file.
Otherwise, returns CSV content in the JSON response.
        """,
    )
    csv_parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        metavar="FILE",
        help="Output file path (if not specified, returns CSV content)",
    )
    csv_parser.add_argument(
        "--spec",
        type=str,
        default=None,
        help="Filter by specific spec ID",
    )
    csv_parser.add_argument(
        "--no-summary",
        action="store_true",
        help="Exclude summary row from CSV output",
    )
    csv_parser.set_defaults(func=cmd_export_csv)

    # get_specs command
    specs_parser = subparsers.add_parser(
        "get_specs",
        parents=[common_args],
        help="Get list of specs with usage data",
        description="""
Get list of all specs that have recorded usage data,
with usage statistics for each spec.
        """,
    )
    specs_parser.set_defaults(func=cmd_get_specs)

    return parser


def main() -> None:
    """Main CLI entry point."""
    parser = create_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Execute the command
    args.func(args)


if __name__ == "__main__":
    main()
