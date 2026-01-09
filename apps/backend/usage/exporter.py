"""
Usage Exporter
===============

Export token usage data to CSV format for reporting and expense tracking.

The UsageExporter provides methods to export usage records with support for:
- Filtering by date range and spec
- Proper CSV formatting with escaping
- UTF-8 encoding for international characters
- Summary row with totals

CSV Columns:
- date: Timestamp of the session (ISO format)
- spec_id: Spec identifier
- spec_name: Human-readable spec name (derived from spec_id)
- agent_type: Type of agent (planner, coder, qa_reviewer, etc.)
- input_tokens: Number of input tokens
- output_tokens: Number of output tokens
- thinking_tokens: Number of thinking tokens
- cache_hits: Number of cache hit tokens
- model: Model name used
- cost_usd: Cost in USD
- outcome: Session outcome (success, failed, etc.)

Example usage:
    from pathlib import Path
    from usage.exporter import UsageExporter

    exporter = UsageExporter(project_dir=Path("/path/to/project"))

    # Export all usage data
    csv_content = exporter.export_to_csv()

    # Export with filters
    csv_content = exporter.export_to_csv(
        spec_id="025-token-usage",
        start_date=datetime(2025, 1, 1),
        end_date=datetime(2025, 12, 31),
    )

    # Write to file
    exporter.export_to_file(
        output_path=Path("usage_report.csv"),
        include_summary=True,
    )
"""

import csv
import io
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional

from usage.models import TokenUsageRecord
from usage.store import TokenUsageStore
from usage.cost_calculator import CostCalculator, get_cost_calculator


# CSV column headers
CSV_HEADERS = [
    "date",
    "spec_id",
    "spec_name",
    "agent_type",
    "input_tokens",
    "output_tokens",
    "thinking_tokens",
    "cache_hits",
    "model",
    "cost_usd",
    "outcome",
]


def _extract_spec_name(spec_id: str) -> str:
    """
    Extract a human-readable name from a spec ID.

    Converts spec IDs like "025-token-usage-dashboard" to
    "Token Usage Dashboard".

    Args:
        spec_id: The spec identifier

    Returns:
        Human-readable spec name
    """
    # Remove leading numbers and hyphens (e.g., "025-")
    parts = spec_id.split("-", 1)
    if len(parts) > 1 and parts[0].isdigit():
        name_part = parts[1]
    else:
        name_part = spec_id

    # Convert kebab-case to title case
    words = name_part.replace("-", " ").replace("_", " ").split()
    return " ".join(word.capitalize() for word in words)


class UsageExporter:
    """
    Export token usage data to CSV format.

    Supports filtering by date range and spec ID, with options for
    including summary totals.

    Attributes:
        project_dir: Root directory of the project
        store: TokenUsageStore for data access
        calculator: CostCalculator for cost computation
    """

    def __init__(
        self,
        project_dir: Path,
        calculator: Optional[CostCalculator] = None,
    ):
        """
        Initialize the UsageExporter.

        Args:
            project_dir: Root directory of the project
            calculator: Optional CostCalculator instance (uses default if not provided)
        """
        self.project_dir = Path(project_dir)
        self.store = TokenUsageStore(project_dir=self.project_dir)
        self.calculator = calculator or get_cost_calculator()

    def export_to_csv(
        self,
        spec_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        include_summary: bool = True,
    ) -> str:
        """
        Export usage data to CSV format.

        Args:
            spec_id: Optional spec ID to filter by
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering
            include_summary: Whether to include a summary row with totals (default: True)

        Returns:
            CSV content as a string (UTF-8 encoded)
        """
        # Get records based on filters
        records = self._get_filtered_records(spec_id, start_date, end_date)

        # Create CSV content
        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

        # Write header
        writer.writerow(CSV_HEADERS)

        # Track totals for summary row
        total_input_tokens = 0
        total_output_tokens = 0
        total_thinking_tokens = 0
        total_cache_hits = 0
        total_cost = Decimal("0")

        # Write data rows
        for record in records:
            cost = self.calculator.calculate_cost(record)
            row = self._record_to_row(record, cost)
            writer.writerow(row)

            # Accumulate totals
            total_input_tokens += record.input_tokens
            total_output_tokens += record.output_tokens
            total_thinking_tokens += record.thinking_tokens
            total_cache_hits += record.cache_hit_tokens
            total_cost += cost

        # Add summary row
        if include_summary and records:
            summary_row = self._create_summary_row(
                total_input_tokens=total_input_tokens,
                total_output_tokens=total_output_tokens,
                total_thinking_tokens=total_thinking_tokens,
                total_cache_hits=total_cache_hits,
                total_cost=total_cost,
                record_count=len(records),
            )
            writer.writerow(summary_row)

        return output.getvalue()

    def export_to_file(
        self,
        output_path: Path,
        spec_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        include_summary: bool = True,
    ) -> Path:
        """
        Export usage data to a CSV file.

        Args:
            output_path: Path to write the CSV file
            spec_id: Optional spec ID to filter by
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering
            include_summary: Whether to include a summary row with totals

        Returns:
            Path to the written file
        """
        csv_content = self.export_to_csv(
            spec_id=spec_id,
            start_date=start_date,
            end_date=end_date,
            include_summary=include_summary,
        )

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, "w", encoding="utf-8", newline="") as f:
            f.write(csv_content)

        return output_path

    def get_record_count(
        self,
        spec_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> int:
        """
        Get the count of records that would be exported.

        Useful for checking before export or displaying to user.

        Args:
            spec_id: Optional spec ID to filter by
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering

        Returns:
            Number of records matching the filters
        """
        records = self._get_filtered_records(spec_id, start_date, end_date)
        return len(records)

    def _get_filtered_records(
        self,
        spec_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> list[TokenUsageRecord]:
        """
        Get usage records with applied filters.

        Args:
            spec_id: Optional spec ID to filter by
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering

        Returns:
            List of filtered TokenUsageRecord objects, sorted by timestamp
        """
        # Determine which query method to use based on filters
        if spec_id is not None:
            # Get records for specific spec
            records = self.store.get_usage_for_spec(spec_id)

            # Apply date filter if provided
            if start_date is not None or end_date is not None:
                records = self._filter_by_date_range(records, start_date, end_date)
        elif start_date is not None and end_date is not None:
            # Get records by date range
            records = self.store.get_usage_for_date_range(start_date, end_date)
        else:
            # Get all records
            records = self.store.get_all_usage_for_project()

        # Sort by timestamp (oldest first)
        records.sort(key=lambda r: r.timestamp)

        return records

    def _filter_by_date_range(
        self,
        records: list[TokenUsageRecord],
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> list[TokenUsageRecord]:
        """
        Filter records by date range.

        Args:
            records: List of records to filter
            start_date: Optional start date (inclusive)
            end_date: Optional end date (inclusive)

        Returns:
            Filtered list of records
        """
        filtered = []
        for record in records:
            if start_date is not None and record.timestamp < start_date:
                continue
            if end_date is not None and record.timestamp > end_date:
                continue
            filtered.append(record)
        return filtered

    def _record_to_row(
        self,
        record: TokenUsageRecord,
        cost: Decimal,
    ) -> list[str]:
        """
        Convert a TokenUsageRecord to a CSV row.

        Args:
            record: The usage record
            cost: Calculated cost for the record

        Returns:
            List of string values for the CSV row
        """
        return [
            record.timestamp.isoformat(),
            record.spec_id,
            _extract_spec_name(record.spec_id),
            record.agent_type.value,
            str(record.input_tokens),
            str(record.output_tokens),
            str(record.thinking_tokens),
            str(record.cache_hit_tokens),
            record.model_name,
            f"{float(cost):.6f}",
            record.outcome.value,
        ]

    def _create_summary_row(
        self,
        total_input_tokens: int,
        total_output_tokens: int,
        total_thinking_tokens: int,
        total_cache_hits: int,
        total_cost: Decimal,
        record_count: int,
    ) -> list[str]:
        """
        Create a summary row with totals.

        Args:
            total_input_tokens: Sum of input tokens
            total_output_tokens: Sum of output tokens
            total_thinking_tokens: Sum of thinking tokens
            total_cache_hits: Sum of cache hit tokens
            total_cost: Sum of costs
            record_count: Number of records

        Returns:
            List of string values for the summary row
        """
        return [
            "",  # date - empty for summary
            "TOTAL",  # spec_id
            f"({record_count} sessions)",  # spec_name - show count
            "",  # agent_type - empty for summary
            str(total_input_tokens),
            str(total_output_tokens),
            str(total_thinking_tokens),
            str(total_cache_hits),
            "",  # model - empty for summary
            f"{float(total_cost):.6f}",
            "",  # outcome - empty for summary
        ]


def get_usage_exporter(project_dir: Path) -> UsageExporter:
    """
    Create a UsageExporter instance.

    Convenience function for creating an exporter.

    Args:
        project_dir: Root directory of the project

    Returns:
        Configured UsageExporter instance
    """
    return UsageExporter(project_dir)


def export_usage_to_csv(
    project_dir: Path,
    spec_id: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    include_summary: bool = True,
) -> str:
    """
    Convenience function to export usage data to CSV.

    Args:
        project_dir: Root directory of the project
        spec_id: Optional spec ID to filter by
        start_date: Optional start date for filtering
        end_date: Optional end date for filtering
        include_summary: Whether to include a summary row

    Returns:
        CSV content as a string
    """
    exporter = UsageExporter(project_dir)
    return exporter.export_to_csv(
        spec_id=spec_id,
        start_date=start_date,
        end_date=end_date,
        include_summary=include_summary,
    )
