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
from .semantic_analyzer import (
    analyze_cross_file_impact,
    build_dependency_graph,
    detect_dependency_conflicts,
)
from .types import (
    ChangeType,
    ConflictRegion,
    ConflictSeverity,
    CrossFileImpact,
    DependencyConflict,
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

    # Build dependency graph for advanced conflict detection
    dependency_graph = build_dependency_graph(task_analyses)
    debug_detailed(
        MODULE,
        "Built dependency graph for conflict detection",
        nodes=dependency_graph.number_of_nodes(),
        edges=dependency_graph.number_of_edges(),
    )

    # Detect dependency conflicts (changes that break downstream modules)
    dependency_conflicts = detect_dependency_conflicts(task_analyses, dependency_graph)
    if dependency_conflicts:
        debug_detailed(
            MODULE, f"Found {len(dependency_conflicts)} dependency conflicts"
        )
        # Convert DependencyConflict to ConflictRegion
        for dep_conflict in dependency_conflicts:
            conflict_region = _dependency_conflict_to_region(dep_conflict)
            conflicts.append(conflict_region)

    # Analyze cross-file impact (ripple effects across the codebase)
    cross_file_impacts = analyze_cross_file_impact(task_analyses, dependency_graph)
    if cross_file_impacts:
        debug_detailed(
            MODULE, f"Found {len(cross_file_impacts)} cross-file impacts"
        )
        # Convert significant impacts to ConflictRegion warnings
        for impact in cross_file_impacts:
            conflict_region = _cross_file_impact_to_region(impact)
            if conflict_region:
                conflicts.append(conflict_region)

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
    import_conflicts = _detect_import_removal_conflicts(task_analyses)
    conflicts.extend(import_conflicts)

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


def _detect_import_removal_conflicts(
    task_analyses: dict[str, FileAnalysis],
) -> list[ConflictRegion]:
    """
    Detect conflicts where one task removes an import that another task uses.

    This detects when task A removes an import (e.g., `from utils import helper`)
    and task B either:
    - Adds the same import (indicating it needs the import)
    - Uses the imported module/function in its changes

    Args:
        task_analyses: Map of task_id -> FileAnalysis

    Returns:
        List of conflict regions for import removal conflicts
    """
    conflicts: list[ConflictRegion] = []

    # Collect all import removals from all tasks
    # Format: list of (task_id, import_name, change)
    removals: list[tuple[str, str, SemanticChange | None]] = []

    for task_id, analysis in task_analyses.items():
        # Check imports_removed set
        for import_name in analysis.imports_removed:
            debug_detailed(
                MODULE,
                f"Found import removal in task {task_id}",
                import_name=import_name,
            )
            removals.append((task_id, import_name, None))

        # Also check for REMOVE_IMPORT changes
        for change in analysis.changes:
            if change.change_type == ChangeType.REMOVE_IMPORT:
                import_name = change.target
                if import_name and (task_id, import_name, None) not in [
                    (t, i, None) for t, i, _ in removals
                ]:
                    debug_detailed(
                        MODULE,
                        f"Found REMOVE_IMPORT change in task {task_id}",
                        import_name=import_name,
                    )
                    removals.append((task_id, import_name, change))

    # For each removal, check if other tasks use or add the same import
    for removal_task_id, import_name, removal_change in removals:
        for other_task_id, other_analysis in task_analyses.items():
            if other_task_id == removal_task_id:
                continue  # Don't check against same task

            # Check if other task adds the same import (indicates it needs it)
            if import_name in other_analysis.imports_added:
                debug_detailed(
                    MODULE,
                    "Import removal conflict detected (other task adds import)",
                    removal_task=removal_task_id,
                    using_task=other_task_id,
                    import_name=import_name,
                )

                conflict = ConflictRegion(
                    file_path=other_analysis.file_path,
                    location=f"import:{import_name}",
                    tasks_involved=[removal_task_id, other_task_id],
                    change_types=[ChangeType.REMOVE_IMPORT, ChangeType.ADD_IMPORT],
                    severity=ConflictSeverity.HIGH,
                    can_auto_merge=False,
                    merge_strategy=MergeStrategy.AI_REQUIRED,
                    reason=(
                        f"Task '{removal_task_id}' removes import '{import_name}', "
                        f"but task '{other_task_id}' adds the same import"
                    ),
                )
                conflicts.append(conflict)
                continue  # Already found a conflict, no need to check usage

            # Check if other task uses the import in its changes
            uses_import = _task_uses_import(other_analysis, import_name)

            if uses_import:
                debug_detailed(
                    MODULE,
                    "Import removal conflict detected (other task uses import)",
                    removal_task=removal_task_id,
                    using_task=other_task_id,
                    import_name=import_name,
                )

                conflict = ConflictRegion(
                    file_path=other_analysis.file_path,
                    location=f"import:{import_name}",
                    tasks_involved=[removal_task_id, other_task_id],
                    change_types=[ChangeType.REMOVE_IMPORT, ChangeType.MODIFY_FUNCTION],
                    severity=ConflictSeverity.HIGH,
                    can_auto_merge=False,
                    merge_strategy=MergeStrategy.AI_REQUIRED,
                    reason=(
                        f"Task '{removal_task_id}' removes import '{import_name}', "
                        f"but task '{other_task_id}' uses '{import_name}' in its changes"
                    ),
                )
                conflicts.append(conflict)

    return conflicts


def _task_uses_import(
    analysis: FileAnalysis,
    import_name: str,
) -> bool:
    """
    Check if a task's analysis uses a specific import.

    This checks:
    - Content in changes that references the import
    - Metadata containing import references
    - Function calls that might use the imported module

    Args:
        analysis: The FileAnalysis to check
        import_name: The import name to look for (e.g., "utils.helper" or "helper")

    Returns:
        True if the analysis uses the import, False otherwise
    """
    # Extract the module/function name from the import
    # e.g., "from utils import helper" -> check for "helper"
    # e.g., "import utils.helper" -> check for "utils.helper" or "helper"
    import_parts = import_name.split(".")
    names_to_check = [import_name]  # Full import name
    if import_parts:
        names_to_check.append(import_parts[-1])  # Last part (e.g., "helper")

    for change in analysis.changes:
        # Check if content_after contains any of the import names
        if change.content_after:
            for name in names_to_check:
                if name in change.content_after:
                    return True

        # Check metadata for imports used
        imports_used = change.metadata.get("imports_used", [])
        for name in names_to_check:
            if name in imports_used:
                return True

        # Check metadata for function calls that might use the import
        function_calls = change.metadata.get("function_calls", [])
        for name in names_to_check:
            if any(name in call for call in function_calls):
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


def _dependency_conflict_to_region(dep_conflict: DependencyConflict) -> ConflictRegion:
    """
    Convert a DependencyConflict to a ConflictRegion for unified conflict handling.

    Args:
        dep_conflict: The dependency conflict to convert

    Returns:
        ConflictRegion representing the dependency conflict
    """
    change = dep_conflict.change
    file_path = change.metadata.get("file_path", "unknown")

    return ConflictRegion(
        file_path=file_path,
        location=f"dependency:{change.target}",
        tasks_involved=[],  # Dependency conflicts don't have specific task IDs
        change_types=[change.change_type],
        severity=dep_conflict.severity,
        can_auto_merge=False,
        merge_strategy=MergeStrategy.AI_REQUIRED,
        reason=dep_conflict.description,
    )


def _cross_file_impact_to_region(impact: CrossFileImpact) -> ConflictRegion | None:
    """
    Convert a CrossFileImpact to a ConflictRegion if significant enough.

    Only converts impacts with HIGH or CRITICAL severity implications
    to avoid noise from low-impact changes.

    Args:
        impact: The cross-file impact to potentially convert

    Returns:
        ConflictRegion if the impact is significant, None otherwise
    """
    change = impact.change

    # Determine severity based on impact type and number of affected files
    num_impacted = len(impact.impacted_files)

    # Only create conflict regions for significant impacts
    if num_impacted < 1:
        return None

    # Determine severity based on scope of impact
    if num_impacted > 5:
        severity = ConflictSeverity.HIGH
    elif num_impacted > 2:
        severity = ConflictSeverity.MEDIUM
    else:
        severity = ConflictSeverity.LOW

    # For low severity impacts, only report for critical change types
    critical_change_types = {
        ChangeType.REMOVE_FUNCTION,
        ChangeType.REMOVE_CLASS,
        ChangeType.REMOVE_METHOD,
        ChangeType.RENAME_FUNCTION,
    }
    if severity == ConflictSeverity.LOW and change.change_type not in critical_change_types:
        return None

    impacted_summary = (
        f"{num_impacted} file(s)"
        if num_impacted > 3
        else ", ".join(impact.impacted_files)
    )

    return ConflictRegion(
        file_path=impact.source_file,
        location=f"impact:{change.target}",
        tasks_involved=[],  # Cross-file impacts don't have specific task IDs
        change_types=[change.change_type],
        severity=severity,
        can_auto_merge=False,
        merge_strategy=MergeStrategy.AI_REQUIRED,
        reason=f"{impact.impact_type}: Change to '{change.target}' affects {impacted_summary}",
    )
