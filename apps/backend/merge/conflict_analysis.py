"""
Conflict Analysis
=================

Core logic for detecting and analyzing conflicts between task changes.

This module contains:
- Conflict detection algorithms
- Severity assessment logic
- Implicit conflict detection
- Range overlap checking
"""

from __future__ import annotations

import logging
from collections import defaultdict

from .compatibility_rules import CompatibilityRule
from .types import (
    ChangeType,
    ConflictRegion,
    ConflictSeverity,
    FileAnalysis,
    MergeStrategy,
    SemanticChange,
)

# Import debug utilities
try:
    from debug import debug, debug_detailed, debug_verbose
except ImportError:

    def debug(*args, **kwargs):
        pass

    def debug_detailed(*args, **kwargs):
        pass

    def debug_verbose(*args, **kwargs):
        pass


logger = logging.getLogger(__name__)
MODULE = "merge.conflict_analysis"


def detect_conflicts(
    task_analyses: dict[str, FileAnalysis],
    rule_index: dict[tuple[ChangeType, ChangeType], CompatibilityRule],
) -> list[ConflictRegion]:
    """
    Detect conflicts between multiple task changes to the same file.

    Args:
        task_analyses: Map of task_id -> FileAnalysis
        rule_index: Indexed compatibility rules for fast lookup

    Returns:
        List of detected conflict regions
    """
    task_ids = list(task_analyses.keys())
    debug(
        MODULE,
        f"Detecting conflicts between {len(task_analyses)} tasks",
        tasks=task_ids,
    )

    if len(task_analyses) <= 1:
        debug(MODULE, "No conflicts possible with 0-1 tasks")
        return []  # No conflicts possible with 0-1 tasks

    conflicts: list[ConflictRegion] = []

    # Group changes by location
    location_changes: dict[str, list[tuple[str, SemanticChange]]] = defaultdict(list)

    for task_id, analysis in task_analyses.items():
        debug_detailed(
            MODULE,
            f"Processing task {task_id}",
            changes_count=len(analysis.changes),
            file=analysis.file_path,
        )
        for change in analysis.changes:
            location_changes[change.location].append((task_id, change))

    debug_detailed(MODULE, f"Grouped changes into {len(location_changes)} locations")

    # Analyze each location for conflicts
    for location, task_changes in location_changes.items():
        if len(task_changes) <= 1:
            continue  # No conflict at this location

        debug_verbose(
            MODULE,
            f"Checking location {location}",
            task_changes_count=len(task_changes),
        )

        file_path = next(iter(task_analyses.values())).file_path
        conflict = analyze_location_conflict(
            file_path, location, task_changes, rule_index
        )
        if conflict:
            debug_detailed(
                MODULE,
                f"Conflict detected at {location}",
                severity=conflict.severity.value,
                can_auto_merge=conflict.can_auto_merge,
                tasks=conflict.tasks_involved,
            )
            conflicts.append(conflict)

    # Also check for implicit conflicts (e.g., changes to related code)
    implicit_conflicts = detect_implicit_conflicts(task_analyses)
    if implicit_conflicts:
        debug_detailed(MODULE, f"Found {len(implicit_conflicts)} implicit conflicts")
    conflicts.extend(implicit_conflicts)

    return conflicts


def analyze_location_conflict(
    file_path: str,
    location: str,
    task_changes: list[tuple[str, SemanticChange]],
    rule_index: dict[tuple[ChangeType, ChangeType], CompatibilityRule],
) -> ConflictRegion | None:
    """
    Analyze changes at a specific location for conflicts.

    Args:
        file_path: Path to the file being analyzed
        location: Location identifier (e.g., "function:main")
        task_changes: List of (task_id, change) tuples for this location
        rule_index: Indexed compatibility rules

    Returns:
        ConflictRegion if conflicts exist, None otherwise
    """
    tasks = [tc[0] for tc in task_changes]
    changes = [tc[1] for tc in task_changes]
    change_types = [c.change_type for c in changes]

    # Check if all changes target the same thing
    targets = {c.target for c in changes}
    if len(targets) > 1:
        # Different targets at same location - likely compatible
        # (e.g., adding two different functions)
        return None

    # Check pairwise compatibility
    all_compatible = True
    final_strategy: MergeStrategy | None = None
    reasons = []

    for i, (type_a, change_a) in enumerate(zip(change_types, changes)):
        for type_b, change_b in zip(change_types[i + 1 :], changes[i + 1 :]):
            rule = rule_index.get((type_a, type_b))

            if rule:
                if not rule.compatible:
                    all_compatible = False
                    reasons.append(rule.reason)
                elif rule.strategy:
                    final_strategy = rule.strategy
            else:
                # No rule - conservative default
                all_compatible = False
                reasons.append(f"No rule for {type_a.value} + {type_b.value}")

    # Determine severity
    if all_compatible:
        severity = ConflictSeverity.NONE
    else:
        severity = assess_severity(change_types, changes)

    return ConflictRegion(
        file_path=file_path,
        location=location,
        tasks_involved=tasks,
        change_types=change_types,
        severity=severity,
        can_auto_merge=all_compatible,
        merge_strategy=final_strategy if all_compatible else MergeStrategy.AI_REQUIRED,
        reason=" | ".join(reasons) if reasons else "Changes are compatible",
    )


def assess_severity(
    change_types: list[ChangeType],
    changes: list[SemanticChange],
) -> ConflictSeverity:
    """
    Assess the severity of a conflict.

    Args:
        change_types: List of change types involved
        changes: List of semantic changes

    Returns:
        Assessed conflict severity level
    """
    # Critical: Both tasks modify core logic
    modify_types = {
        ChangeType.MODIFY_FUNCTION,
        ChangeType.MODIFY_METHOD,
        ChangeType.MODIFY_CLASS,
    }
    modify_count = sum(1 for ct in change_types if ct in modify_types)

    if modify_count >= 2:
        # Check if they modify the exact same lines
        line_ranges = [(c.line_start, c.line_end) for c in changes]
        if ranges_overlap(line_ranges):
            return ConflictSeverity.CRITICAL

    # High: Structural changes that could break compilation
    structural_types = {
        ChangeType.WRAP_JSX,
        ChangeType.UNWRAP_JSX,
        ChangeType.REMOVE_FUNCTION,
        ChangeType.REMOVE_CLASS,
    }
    if any(ct in structural_types for ct in change_types):
        return ConflictSeverity.HIGH

    # Medium: Modifications to same function/method
    if modify_count >= 1:
        return ConflictSeverity.MEDIUM

    # Low: Likely resolvable with AI
    return ConflictSeverity.LOW


def ranges_overlap(ranges: list[tuple[int, int]]) -> bool:
    """
    Check if any line ranges overlap.

    Args:
        ranges: List of (start_line, end_line) tuples

    Returns:
        True if any ranges overlap, False otherwise
    """
    sorted_ranges = sorted(ranges)
    for i in range(len(sorted_ranges) - 1):
        if sorted_ranges[i][1] >= sorted_ranges[i + 1][0]:
            return True
    return False


def detect_implicit_conflicts(
    task_analyses: dict[str, FileAnalysis],
) -> list[ConflictRegion]:
    """
    Detect implicit conflicts not caught by location analysis.

    This includes conflicts like:
    - Function rename + function call changes
    - Import removal + usage
    - Variable rename + references

    Args:
        task_analyses: Map of task_id -> FileAnalysis

    Returns:
        List of implicit conflict regions
    """
    conflicts: list[ConflictRegion] = []

    if len(task_analyses) <= 1:
        return conflicts  # No implicit conflicts possible with 0-1 tasks

    # Check for function rename + function call changes
    # (If task A renames a function and task B calls the old name)
    rename_conflicts = _detect_function_rename_conflicts(task_analyses)
    conflicts.extend(rename_conflicts)

    # Check for import removal + usage
    # (If task A removes an import and task B uses it)
    # Note: Import conflict detection will be implemented in subtask-3-2

    return conflicts


def _detect_function_rename_conflicts(
    task_analyses: dict[str, FileAnalysis],
) -> list[ConflictRegion]:
    """
    Detect conflicts where one task renames a function and another task
    still references the old function name.

    Args:
        task_analyses: Map of task_id -> FileAnalysis

    Returns:
        List of conflict regions for function rename conflicts
    """
    conflicts: list[ConflictRegion] = []

    # Collect all function renames from all tasks
    # Format: list of (task_id, old_name, new_name, change)
    renames: list[tuple[str, str, str, SemanticChange]] = []

    for task_id, analysis in task_analyses.items():
        for change in analysis.changes:
            if change.change_type == ChangeType.RENAME_FUNCTION:
                # Extract old and new names from metadata or target
                old_name = change.metadata.get("old_name", change.target)
                new_name = change.metadata.get("new_name", "")

                # If old_name is in target and we have new_name in metadata
                if old_name and new_name:
                    renames.append((task_id, old_name, new_name, change))
                    debug_detailed(
                        MODULE,
                        f"Found function rename in task {task_id}",
                        old_name=old_name,
                        new_name=new_name,
                    )

    # For each rename, check if other tasks reference the old function name
    for rename_task_id, old_name, new_name, rename_change in renames:
        for other_task_id, other_analysis in task_analyses.items():
            if other_task_id == rename_task_id:
                continue  # Don't check against same task

            # Check if other task's changes reference the old function name
            references_old_name = _task_references_function(
                other_analysis, old_name
            )

            if references_old_name:
                debug_detailed(
                    MODULE,
                    f"Function rename conflict detected",
                    rename_task=rename_task_id,
                    referencing_task=other_task_id,
                    old_name=old_name,
                    new_name=new_name,
                )

                conflict = ConflictRegion(
                    file_path=other_analysis.file_path,
                    location=f"function:{old_name}",
                    tasks_involved=[rename_task_id, other_task_id],
                    change_types=[
                        ChangeType.RENAME_FUNCTION,
                        ChangeType.MODIFY_FUNCTION,
                    ],
                    severity=ConflictSeverity.HIGH,
                    can_auto_merge=False,
                    merge_strategy=MergeStrategy.AI_REQUIRED,
                    reason=(
                        f"Task '{rename_task_id}' renames function '{old_name}' to "
                        f"'{new_name}', but task '{other_task_id}' still references "
                        f"the old name '{old_name}'"
                    ),
                )
                conflicts.append(conflict)

    return conflicts


def _task_references_function(
    analysis: FileAnalysis,
    function_name: str,
) -> bool:
    """
    Check if a task's analysis references a specific function name.

    This checks:
    - Function modifications (functions_modified set)
    - Function calls in change content
    - Metadata containing function references

    Args:
        analysis: The FileAnalysis to check
        function_name: The function name to look for

    Returns:
        True if the analysis references the function, False otherwise
    """
    # Check if the function is in the modified functions set
    if function_name in analysis.functions_modified:
        return True

    # Check each change for references to the function
    for change in analysis.changes:
        # Check if target references the function
        if function_name in change.target:
            return True

        # Check if content_after contains the function name (likely a call)
        if change.content_after and function_name in change.content_after:
            return True

        # Check metadata for function calls
        function_calls = change.metadata.get("function_calls", [])
        if function_name in function_calls:
            return True

        # Check metadata for referenced functions
        referenced_functions = change.metadata.get("referenced_functions", [])
        if function_name in referenced_functions:
            return True

    return False


def analyze_compatibility(
    change_a: SemanticChange,
    change_b: SemanticChange,
    rule_index: dict[tuple[ChangeType, ChangeType], CompatibilityRule],
) -> tuple[bool, MergeStrategy | None, str]:
    """
    Analyze compatibility between two specific changes.

    Args:
        change_a: First semantic change
        change_b: Second semantic change
        rule_index: Indexed compatibility rules

    Returns:
        Tuple of (compatible, strategy, reason)
    """
    rule = rule_index.get((change_a.change_type, change_b.change_type))

    if rule:
        return (rule.compatible, rule.strategy, rule.reason)
    else:
        return (False, MergeStrategy.AI_REQUIRED, "No compatibility rule defined")
