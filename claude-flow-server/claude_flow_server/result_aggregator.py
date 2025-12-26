"""
Result Aggregator Module
========================

Aggregates parallel agent outputs into unified, coherent responses.
Provides deduplication, metrics calculation, and error handling.

The result aggregator is used by:
- MCP Server: To combine outputs from parallel_execute tool
- Task Service: To process and store parallel execution results

Usage:
    from claude_flow_server.result_aggregator import ResultAggregator

    aggregator = ResultAggregator()
    result = aggregator.aggregate([
        {"output": "Finding 1", "agent_id": "agent-1"},
        {"output": "Finding 2", "agent_id": "agent-2"},
    ])
"""

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


# =============================================================================
# CONSTANTS
# =============================================================================

# Default estimate for sequential execution time per agent output
SEQUENTIAL_TIME_ESTIMATE_PER_OUTPUT = 30.0  # seconds

# Minimum similarity threshold for deduplication (0-1)
DEDUP_SIMILARITY_THRESHOLD = 0.85


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class AgentOutput:
    """
    Represents output from a single agent.

    Attributes:
        agent_id: Unique identifier for the agent
        output: The agent's output content
        success: Whether the agent completed successfully
        error: Error message if agent failed
        execution_time: Time taken by this agent in seconds
        api_calls: Number of API calls made by this agent
        metadata: Additional metadata from the agent
    """

    agent_id: str
    output: str = ""
    success: bool = True
    error: str | None = None
    execution_time: float = 0.0
    api_calls: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentOutput":
        """Create AgentOutput from dictionary."""
        return cls(
            agent_id=data.get("agent_id", data.get("id", f"agent-{id(data)}")),
            output=data.get("output", data.get("result", "")),
            success=data.get("success", True),
            error=data.get("error"),
            execution_time=data.get("execution_time", data.get("duration", 0.0)),
            api_calls=data.get("api_calls", 0),
            metadata=data.get("metadata", {}),
        )


class ExecutionMetrics(BaseModel):
    """
    Performance metrics for parallel execution.

    Attributes:
        execution_time_seconds: Total execution time in seconds
        agent_count: Number of agents used
        speedup_factor: Estimated speedup vs sequential execution
        sequential_baseline_seconds: Estimated sequential execution time
        agents_successful: Number of agents that completed successfully
        agents_failed: Number of agents that failed
        api_calls_total: Total API calls across all agents
        started_at: When execution started
        completed_at: When execution completed
    """

    execution_time_seconds: float = Field(default=0.0, ge=0)
    agent_count: int = Field(default=0, ge=0)
    speedup_factor: float = Field(default=1.0, ge=0)
    sequential_baseline_seconds: float = Field(default=0.0, ge=0)
    agents_successful: int = Field(default=0, ge=0)
    agents_failed: int = Field(default=0, ge=0)
    api_calls_total: int = Field(default=0, ge=0)
    started_at: datetime | None = None
    completed_at: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert metrics to dictionary."""
        return {
            "execution_time_seconds": self.execution_time_seconds,
            "agent_count": self.agent_count,
            "speedup_factor": round(self.speedup_factor, 2),
            "sequential_baseline_seconds": self.sequential_baseline_seconds,
            "agents_successful": self.agents_successful,
            "agents_failed": self.agents_failed,
            "api_calls_total": self.api_calls_total,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


@dataclass
class AggregatedResult:
    """
    Result of aggregating parallel agent outputs.

    Attributes:
        success: Whether aggregation was successful
        combined_output: Merged output from all agents
        outputs: List of individual agent outputs
        metrics: Performance metrics
        errors: List of error messages from failed agents
        deduplicated_count: Number of duplicate outputs removed
    """

    success: bool = True
    combined_output: str = ""
    outputs: list[AgentOutput] = field(default_factory=list)
    metrics: ExecutionMetrics = field(default_factory=ExecutionMetrics)
    errors: list[str] = field(default_factory=list)
    deduplicated_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Convert result to dictionary."""
        return {
            "success": self.success,
            "combined_output": self.combined_output,
            "outputs": [
                {
                    "agent_id": o.agent_id,
                    "output": o.output,
                    "success": o.success,
                    "error": o.error,
                }
                for o in self.outputs
            ],
            "metrics": self.metrics.to_dict(),
            "errors": self.errors,
            "deduplicated_count": self.deduplicated_count,
        }


# =============================================================================
# RESULT AGGREGATOR
# =============================================================================


class ResultAggregator:
    """
    Aggregates parallel agent outputs into unified responses.

    Supports:
    - Combining multiple agent outputs into coherent results
    - Deduplication of similar outputs
    - Performance metrics calculation
    - Error aggregation and handling
    """

    def __init__(
        self,
        enable_deduplication: bool = True,
        similarity_threshold: float = DEDUP_SIMILARITY_THRESHOLD,
    ) -> None:
        """
        Initialize the result aggregator.

        Args:
            enable_deduplication: Whether to deduplicate similar outputs
            similarity_threshold: Threshold for considering outputs as duplicates (0-1)
        """
        self.enable_deduplication = enable_deduplication
        self.similarity_threshold = similarity_threshold

    # =========================================================================
    # PUBLIC METHODS
    # =========================================================================

    def aggregate(
        self,
        agent_outputs: list[dict[str, Any]],
        execution_time: float | None = None,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
    ) -> AggregatedResult:
        """
        Aggregate multiple agent outputs into a unified result.

        Args:
            agent_outputs: List of agent output dictionaries
            execution_time: Total execution time in seconds
            started_at: When execution started
            completed_at: When execution completed

        Returns:
            AggregatedResult with combined output and metrics
        """
        if not agent_outputs:
            return AggregatedResult(
                success=True,
                combined_output="",
                outputs=[],
                metrics=ExecutionMetrics(),
            )

        # Parse agent outputs
        outputs = [AgentOutput.from_dict(o) for o in agent_outputs]

        # Deduplicate if enabled
        deduplicated_count = 0
        if self.enable_deduplication:
            outputs, deduplicated_count = self._deduplicate_outputs(outputs)

        # Separate successful and failed outputs
        successful_outputs = [o for o in outputs if o.success]
        failed_outputs = [o for o in outputs if not o.success]

        # Combine successful outputs
        combined_output = self._combine_outputs(successful_outputs)

        # Collect errors
        errors = [o.error for o in failed_outputs if o.error]

        # Calculate metrics
        metrics = self._calculate_metrics(
            outputs=outputs,
            execution_time=execution_time,
            started_at=started_at,
            completed_at=completed_at,
        )

        return AggregatedResult(
            success=len(successful_outputs) > 0,
            combined_output=combined_output,
            outputs=outputs,
            metrics=metrics,
            errors=errors,
            deduplicated_count=deduplicated_count,
        )

    def aggregate_with_structure(
        self,
        agent_outputs: list[dict[str, Any]],
        structure: str = "sections",
    ) -> AggregatedResult:
        """
        Aggregate outputs with a specific structure format.

        Args:
            agent_outputs: List of agent output dictionaries
            structure: Output structure ("sections", "list", "merged")

        Returns:
            AggregatedResult with structured combined output
        """
        result = self.aggregate(agent_outputs)

        if structure == "sections":
            result.combined_output = self._format_as_sections(result.outputs)
        elif structure == "list":
            result.combined_output = self._format_as_list(result.outputs)
        elif structure == "merged":
            result.combined_output = self._format_as_merged(result.outputs)

        return result

    # =========================================================================
    # PRIVATE METHODS
    # =========================================================================

    def _combine_outputs(self, outputs: list[AgentOutput]) -> str:
        """
        Combine multiple agent outputs into a single coherent output.

        Args:
            outputs: List of successful agent outputs

        Returns:
            Combined output string
        """
        if not outputs:
            return ""

        # If only one output, return it directly
        if len(outputs) == 1:
            return outputs[0].output

        # Combine outputs with section headers
        sections = []
        for output in outputs:
            if output.output.strip():
                sections.append(output.output.strip())

        return "\n\n---\n\n".join(sections)

    def _format_as_sections(self, outputs: list[AgentOutput]) -> str:
        """Format outputs as labeled sections."""
        sections = []
        for i, output in enumerate(outputs, 1):
            if output.success and output.output.strip():
                sections.append(f"## Agent {i} Findings\n\n{output.output.strip()}")

        return "\n\n".join(sections)

    def _format_as_list(self, outputs: list[AgentOutput]) -> str:
        """Format outputs as a bullet list."""
        items = []
        for output in outputs:
            if output.success and output.output.strip():
                # Split output into lines and format as list items
                for line in output.output.strip().split("\n"):
                    line = line.strip()
                    if line and not line.startswith("-"):
                        items.append(f"- {line}")
                    elif line:
                        items.append(line)

        return "\n".join(items)

    def _format_as_merged(self, outputs: list[AgentOutput]) -> str:
        """Format outputs as merged paragraphs."""
        paragraphs = []
        for output in outputs:
            if output.success and output.output.strip():
                paragraphs.append(output.output.strip())

        return "\n\n".join(paragraphs)

    def _deduplicate_outputs(
        self,
        outputs: list[AgentOutput],
    ) -> tuple[list[AgentOutput], int]:
        """
        Remove duplicate or highly similar outputs.

        Args:
            outputs: List of agent outputs

        Returns:
            Tuple of (deduplicated outputs, count of removed duplicates)
        """
        if len(outputs) <= 1:
            return outputs, 0

        # Use content hashing for exact duplicates
        seen_hashes: set[str] = set()
        unique_outputs: list[AgentOutput] = []
        duplicates = 0

        for output in outputs:
            # Normalize and hash the content
            normalized = self._normalize_text(output.output)
            content_hash = hashlib.md5(normalized.encode()).hexdigest()

            if content_hash not in seen_hashes:
                seen_hashes.add(content_hash)

                # Check for high similarity with existing outputs
                is_similar = False
                for existing in unique_outputs:
                    if self._calculate_similarity(output.output, existing.output) >= self.similarity_threshold:
                        is_similar = True
                        duplicates += 1
                        break

                if not is_similar:
                    unique_outputs.append(output)
            else:
                duplicates += 1

        return unique_outputs, duplicates

    def _normalize_text(self, text: str) -> str:
        """
        Normalize text for comparison.

        Args:
            text: Text to normalize

        Returns:
            Normalized text
        """
        # Lowercase
        text = text.lower()
        # Remove extra whitespace
        text = re.sub(r"\s+", " ", text)
        # Remove punctuation (keeping alphanumeric and spaces)
        text = re.sub(r"[^\w\s]", "", text)
        return text.strip()

    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """
        Calculate similarity between two texts using Jaccard similarity.

        Args:
            text1: First text
            text2: Second text

        Returns:
            Similarity score (0-1)
        """
        # Normalize texts
        words1 = set(self._normalize_text(text1).split())
        words2 = set(self._normalize_text(text2).split())

        if not words1 and not words2:
            return 1.0
        if not words1 or not words2:
            return 0.0

        intersection = len(words1 & words2)
        union = len(words1 | words2)

        return intersection / union if union > 0 else 0.0

    def _calculate_metrics(
        self,
        outputs: list[AgentOutput],
        execution_time: float | None = None,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
    ) -> ExecutionMetrics:
        """
        Calculate performance metrics for the parallel execution.

        Args:
            outputs: List of all agent outputs
            execution_time: Total execution time in seconds
            started_at: When execution started
            completed_at: When execution completed

        Returns:
            ExecutionMetrics with calculated values
        """
        agent_count = len(outputs)
        successful = sum(1 for o in outputs if o.success)
        failed = agent_count - successful

        # Calculate total API calls
        api_calls_total = sum(o.api_calls for o in outputs)

        # Calculate execution time from outputs if not provided
        if execution_time is None:
            # Use max of individual agent times (parallel execution)
            agent_times = [o.execution_time for o in outputs if o.execution_time > 0]
            execution_time = max(agent_times) if agent_times else 0.0

        # Estimate sequential baseline
        # Assume each agent's work would take SEQUENTIAL_TIME_ESTIMATE_PER_OUTPUT seconds sequentially
        sequential_baseline = agent_count * SEQUENTIAL_TIME_ESTIMATE_PER_OUTPUT

        # Also factor in actual agent execution times if available
        total_agent_time = sum(o.execution_time for o in outputs)
        if total_agent_time > sequential_baseline:
            sequential_baseline = total_agent_time

        # Calculate speedup factor
        speedup_factor = 1.0
        if execution_time > 0 and sequential_baseline > 0:
            speedup_factor = sequential_baseline / execution_time

        # Use current time if timestamps not provided
        now = datetime.now(timezone.utc)
        if completed_at is None:
            completed_at = now
        if started_at is None and execution_time > 0:
            # Estimate started_at from execution_time
            from datetime import timedelta
            started_at = completed_at - timedelta(seconds=execution_time)

        return ExecutionMetrics(
            execution_time_seconds=execution_time,
            agent_count=agent_count,
            speedup_factor=speedup_factor,
            sequential_baseline_seconds=sequential_baseline,
            agents_successful=successful,
            agents_failed=failed,
            api_calls_total=api_calls_total,
            started_at=started_at,
            completed_at=completed_at,
        )


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def create_aggregator(
    enable_deduplication: bool = True,
    similarity_threshold: float = DEDUP_SIMILARITY_THRESHOLD,
) -> ResultAggregator:
    """
    Create a result aggregator with custom settings.

    Args:
        enable_deduplication: Whether to deduplicate similar outputs
        similarity_threshold: Threshold for considering outputs as duplicates

    Returns:
        Configured ResultAggregator instance
    """
    return ResultAggregator(
        enable_deduplication=enable_deduplication,
        similarity_threshold=similarity_threshold,
    )


def aggregate_outputs(
    agent_outputs: list[dict[str, Any]],
    **kwargs: Any,
) -> AggregatedResult:
    """
    Convenience function to aggregate outputs.

    Args:
        agent_outputs: List of agent output dictionaries
        **kwargs: Additional arguments passed to aggregate()

    Returns:
        AggregatedResult with combined output and metrics
    """
    aggregator = ResultAggregator()
    return aggregator.aggregate(agent_outputs, **kwargs)
