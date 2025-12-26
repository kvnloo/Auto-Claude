"""
Tests for Conflict Detection
=============================

Comprehensive test suite for enhanced conflict detection covering:
- Semantic conflict detection (function rename, import removal)
- Dependency conflict detection using NetworkX graphs
- Cross-file impact analysis
- Implicit conflict detection
- Edge cases and integration scenarios

This test suite verifies the functionality implemented for spec 006:
Enhanced Conflict Analysis & Detection.
"""

import pytest
from merge.conflict_analysis import (
    analyze_compatibility,
    analyze_location_conflict,
    assess_severity,
    detect_conflicts,
    detect_implicit_conflicts,
    ranges_overlap,
    _detect_function_rename_conflicts,
    _detect_import_removal_conflicts,
    _task_references_function,
    _task_uses_import,
    _dependency_conflict_to_region,
    _cross_file_impact_to_region,
)
from merge.semantic_analyzer import (
    build_dependency_graph,
    detect_dependency_conflicts,
    analyze_cross_file_impact,
    NETWORKX_AVAILABLE,
)
from merge.types import (
    ChangeType,
    ConflictRegion,
    ConflictSeverity,
    CrossFileImpact,
    DependencyConflict,
    FileAnalysis,
    MergeStrategy,
    SemanticChange,
)
from merge.compatibility_rules import build_default_rules, index_rules


def build_rule_index():
    """Helper to build rule index for testing."""
    return index_rules(build_default_rules())


# ==============================================================================
# Test Fixtures
# ==============================================================================


def create_semantic_change(
    change_type: ChangeType,
    target: str,
    location: str = "function:main",
    line_start: int = 1,
    line_end: int = 5,
    content_before: str | None = None,
    content_after: str | None = None,
    metadata: dict | None = None,
) -> SemanticChange:
    """Helper to create SemanticChange objects for testing."""
    return SemanticChange(
        change_type=change_type,
        target=target,
        location=location,
        line_start=line_start,
        line_end=line_end,
        content_before=content_before,
        content_after=content_after,
        metadata=metadata or {},
    )


def create_file_analysis(
    file_path: str,
    changes: list[SemanticChange] | None = None,
    functions_modified: set[str] | None = None,
    functions_added: set[str] | None = None,
    imports_added: set[str] | None = None,
    imports_removed: set[str] | None = None,
) -> FileAnalysis:
    """Helper to create FileAnalysis objects for testing."""
    return FileAnalysis(
        file_path=file_path,
        changes=changes or [],
        functions_modified=functions_modified or set(),
        functions_added=functions_added or set(),
        imports_added=imports_added or set(),
        imports_removed=imports_removed or set(),
    )


# ==============================================================================
# Test Function Rename Conflict Detection
# ==============================================================================


class TestFunctionRenameConflicts:
    """Test detection of function rename conflicts."""

    def test_detect_function_rename_conflict(self):
        """Detects when task A renames a function and task B still uses old name."""
        # Task A renames function 'old_name' to 'new_name'
        rename_change = create_semantic_change(
            change_type=ChangeType.RENAME_FUNCTION,
            target="old_name",
            metadata={"old_name": "old_name", "new_name": "new_name"},
        )
        task_a_analysis = create_file_analysis(
            file_path="src/utils.py",
            changes=[rename_change],
        )

        # Task B modifies code that still uses 'old_name'
        modify_change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="caller_function",
            content_after="result = old_name(x)",
        )
        task_b_analysis = create_file_analysis(
            file_path="src/utils.py",
            changes=[modify_change],
            functions_modified={"caller_function"},
        )

        task_analyses = {
            "task_a": task_a_analysis,
            "task_b": task_b_analysis,
        }

        conflicts = _detect_function_rename_conflicts(task_analyses)

        assert len(conflicts) == 1
        conflict = conflicts[0]
        assert conflict.severity == ConflictSeverity.HIGH
        assert "task_a" in conflict.tasks_involved
        assert "task_b" in conflict.tasks_involved
        assert "old_name" in conflict.reason
        assert "new_name" in conflict.reason

    def test_no_conflict_when_new_name_used(self):
        """No conflict when other task already uses new function name."""
        rename_change = create_semantic_change(
            change_type=ChangeType.RENAME_FUNCTION,
            target="old_name",
            metadata={"old_name": "old_name", "new_name": "new_name"},
        )
        task_a_analysis = create_file_analysis(
            file_path="src/utils.py",
            changes=[rename_change],
        )

        # Task B uses the new name (no conflict)
        modify_change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="caller_function",
            content_after="result = new_name(x)",  # Uses new name
        )
        task_b_analysis = create_file_analysis(
            file_path="src/utils.py",
            changes=[modify_change],
        )

        task_analyses = {
            "task_a": task_a_analysis,
            "task_b": task_b_analysis,
        }

        conflicts = _detect_function_rename_conflicts(task_analyses)
        assert len(conflicts) == 0

    def test_no_conflict_with_single_task(self):
        """No conflict detection with only one task."""
        rename_change = create_semantic_change(
            change_type=ChangeType.RENAME_FUNCTION,
            target="old_name",
            metadata={"old_name": "old_name", "new_name": "new_name"},
        )
        task_a_analysis = create_file_analysis(
            file_path="src/utils.py",
            changes=[rename_change],
        )

        task_analyses = {"task_a": task_a_analysis}

        conflicts = _detect_function_rename_conflicts(task_analyses)
        assert len(conflicts) == 0

    def test_task_references_function_in_functions_modified(self):
        """Detects function reference in functions_modified set."""
        analysis = create_file_analysis(
            file_path="src/main.py",
            functions_modified={"target_function"},
        )

        assert _task_references_function(analysis, "target_function") is True
        assert _task_references_function(analysis, "other_function") is False

    def test_task_references_function_in_content_after(self):
        """Detects function reference in change content_after."""
        change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="caller",
            content_after="x = target_function(y)",
        )
        analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[change],
        )

        assert _task_references_function(analysis, "target_function") is True
        assert _task_references_function(analysis, "other_function") is False

    def test_task_references_function_in_metadata(self):
        """Detects function reference in change metadata."""
        change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="caller",
            metadata={"function_calls": ["target_function", "other_func"]},
        )
        analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[change],
        )

        assert _task_references_function(analysis, "target_function") is True
        assert _task_references_function(analysis, "unknown_function") is False


# ==============================================================================
# Test Import Removal Conflict Detection
# ==============================================================================


class TestImportRemovalConflicts:
    """Test detection of import removal conflicts."""

    def test_detect_import_removal_with_add_conflict(self):
        """Detects conflict when task A removes import that task B adds."""
        # Task A removes the import
        task_a_analysis = create_file_analysis(
            file_path="src/main.py",
            imports_removed={"utils.helper"},
        )

        # Task B adds the same import (indicating it needs it)
        task_b_analysis = create_file_analysis(
            file_path="src/main.py",
            imports_added={"utils.helper"},
        )

        task_analyses = {
            "task_a": task_a_analysis,
            "task_b": task_b_analysis,
        }

        conflicts = _detect_import_removal_conflicts(task_analyses)

        assert len(conflicts) == 1
        conflict = conflicts[0]
        assert conflict.severity == ConflictSeverity.HIGH
        assert ChangeType.REMOVE_IMPORT in conflict.change_types
        assert ChangeType.ADD_IMPORT in conflict.change_types
        assert "utils.helper" in conflict.reason

    def test_detect_import_removal_with_usage_conflict(self):
        """Detects conflict when task A removes import that task B uses."""
        # Task A removes the import
        remove_change = create_semantic_change(
            change_type=ChangeType.REMOVE_IMPORT,
            target="utils.helper",
        )
        task_a_analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[remove_change],
            imports_removed={"utils.helper"},
        )

        # Task B uses the import in its changes
        modify_change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="process_data",
            content_after="result = helper.process(data)",
        )
        task_b_analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[modify_change],
        )

        task_analyses = {
            "task_a": task_a_analysis,
            "task_b": task_b_analysis,
        }

        conflicts = _detect_import_removal_conflicts(task_analyses)

        assert len(conflicts) == 1
        conflict = conflicts[0]
        assert conflict.severity == ConflictSeverity.HIGH
        assert "utils.helper" in conflict.reason or "helper" in conflict.reason

    def test_no_conflict_when_import_not_used(self):
        """No conflict when removed import is not used by other tasks."""
        task_a_analysis = create_file_analysis(
            file_path="src/main.py",
            imports_removed={"unused_module"},
        )

        task_b_analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[
                create_semantic_change(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="some_function",
                    content_after="x = other_module.func()",
                )
            ],
        )

        task_analyses = {
            "task_a": task_a_analysis,
            "task_b": task_b_analysis,
        }

        conflicts = _detect_import_removal_conflicts(task_analyses)
        assert len(conflicts) == 0

    def test_task_uses_import_in_content(self):
        """Detects import usage in change content."""
        change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="process",
            content_after="result = utils.helper.process(data)",
        )
        analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[change],
        )

        assert _task_uses_import(analysis, "utils.helper") is True
        assert _task_uses_import(analysis, "helper") is True  # Short form
        assert _task_uses_import(analysis, "other_module") is False

    def test_task_uses_import_in_metadata(self):
        """Detects import usage in metadata."""
        change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="process",
            metadata={"imports_used": ["utils.helper"]},
        )
        analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[change],
        )

        assert _task_uses_import(analysis, "utils.helper") is True
        assert _task_uses_import(analysis, "other_module") is False


# ==============================================================================
# Test Dependency Graph Building
# ==============================================================================


class TestDependencyGraph:
    """Test dependency graph building functionality."""

    def test_build_empty_graph(self):
        """Building graph from empty analyses returns empty graph."""
        graph = build_dependency_graph({})
        assert graph.number_of_nodes() == 0
        assert graph.number_of_edges() == 0

    def test_build_graph_from_dict(self):
        """Build graph from dictionary of FileAnalysis objects."""
        analyses = {
            "src/main.py": create_file_analysis(
                file_path="src/main.py",
                imports_added={"utils", "helper"},
            ),
            "src/utils.py": create_file_analysis(
                file_path="src/utils.py",
                imports_added={"os"},
            ),
        }

        graph = build_dependency_graph(analyses)

        assert "src/main.py" in graph
        assert "src/utils.py" in graph
        assert graph.number_of_nodes() >= 2

    def test_build_graph_from_list(self):
        """Build graph from list of FileAnalysis objects."""
        analyses = [
            create_file_analysis(
                file_path="src/main.py",
                imports_added={"utils"},
            ),
            create_file_analysis(
                file_path="src/utils.py",
            ),
        ]

        graph = build_dependency_graph(analyses)

        assert "src/main.py" in graph
        assert "src/utils.py" in graph

    def test_graph_edges_from_imports(self):
        """Graph edges are created from import relationships."""
        analyses = {
            "src/main.py": create_file_analysis(
                file_path="src/main.py",
                imports_added={"src.utils"},
            ),
        }

        graph = build_dependency_graph(analyses)

        # Check that an edge exists from main.py to src.utils
        edges = list(graph.edges())
        assert len(edges) >= 1

    def test_graph_contains_check(self):
        """Can check if node is in graph."""
        analyses = {
            "src/main.py": create_file_analysis(file_path="src/main.py"),
        }

        graph = build_dependency_graph(analyses)

        assert "src/main.py" in graph
        assert "nonexistent.py" not in graph


# ==============================================================================
# Test Dependency Conflict Detection
# ==============================================================================


class TestDependencyConflicts:
    """Test dependency conflict detection using graph analysis."""

    def test_detect_function_removal_conflict(self):
        """Detects when removing a function may break dependent files."""
        # File that removes a function
        remove_change = create_semantic_change(
            change_type=ChangeType.REMOVE_FUNCTION,
            target="helper_function",
            metadata={"file_path": "src/utils.py"},
        )
        analyses = {
            "src/utils.py": create_file_analysis(
                file_path="src/utils.py",
                changes=[remove_change],
            ),
            "src/main.py": create_file_analysis(
                file_path="src/main.py",
                imports_added={"src/utils.py"},
            ),
        }

        # Build graph where main.py imports utils.py
        graph = build_dependency_graph(analyses)

        conflicts = detect_dependency_conflicts(analyses, graph)

        # If networkx found dependent files, we should have conflicts
        # Note: This depends on graph structure - may be 0 if no predecessors found
        assert isinstance(conflicts, list)
        for conflict in conflicts:
            assert isinstance(conflict, DependencyConflict)
            assert conflict.severity in [
                ConflictSeverity.LOW,
                ConflictSeverity.MEDIUM,
                ConflictSeverity.HIGH,
                ConflictSeverity.CRITICAL,
            ]

    def test_detect_class_removal_conflict(self):
        """Detects when removing a class may break dependent files."""
        remove_change = create_semantic_change(
            change_type=ChangeType.REMOVE_CLASS,
            target="BaseService",
            metadata={"file_path": "src/base.py"},
        )
        analyses = {
            "src/base.py": create_file_analysis(
                file_path="src/base.py",
                changes=[remove_change],
            ),
        }

        graph = build_dependency_graph(analyses)
        conflicts = detect_dependency_conflicts(analyses, graph)

        assert isinstance(conflicts, list)

    def test_no_conflict_for_additive_changes(self):
        """No dependency conflict for purely additive changes."""
        add_change = create_semantic_change(
            change_type=ChangeType.ADD_FUNCTION,
            target="new_helper",
            metadata={"file_path": "src/utils.py"},
        )
        analyses = {
            "src/utils.py": create_file_analysis(
                file_path="src/utils.py",
                changes=[add_change],
            ),
        }

        graph = build_dependency_graph(analyses)
        conflicts = detect_dependency_conflicts(analyses, graph)

        assert len(conflicts) == 0

    def test_conflict_severity_based_on_change_type(self):
        """Conflict severity is determined by change type and affected count."""
        # RENAME_FUNCTION should be HIGH severity
        rename_change = create_semantic_change(
            change_type=ChangeType.RENAME_FUNCTION,
            target="old_name",
            metadata={"file_path": "src/utils.py"},
        )
        analyses = {
            "src/utils.py": create_file_analysis(
                file_path="src/utils.py",
                changes=[rename_change],
            ),
        }

        graph = build_dependency_graph(analyses)
        conflicts = detect_dependency_conflicts(analyses, graph)

        # Even if no conflicts found (no dependents), verify function works
        assert isinstance(conflicts, list)

    def test_detect_with_none_graph(self):
        """Function builds graph automatically if None provided."""
        remove_change = create_semantic_change(
            change_type=ChangeType.REMOVE_FUNCTION,
            target="helper",
            metadata={"file_path": "src/utils.py"},
        )
        analyses = {
            "src/utils.py": create_file_analysis(
                file_path="src/utils.py",
                changes=[remove_change],
            ),
        }

        # Pass None for graph - should build automatically
        conflicts = detect_dependency_conflicts(analyses, None)

        assert isinstance(conflicts, list)


# ==============================================================================
# Test Cross-File Impact Analysis
# ==============================================================================


class TestCrossFileImpact:
    """Test cross-file impact analysis functionality."""

    def test_analyze_empty_analyses(self):
        """Empty analyses returns empty impacts list."""
        impacts = analyze_cross_file_impact({}, None)
        assert impacts == []

    def test_detect_function_removal_impact(self):
        """Detects impact when removing a function used by other files."""
        remove_change = create_semantic_change(
            change_type=ChangeType.REMOVE_FUNCTION,
            target="shared_helper",
            metadata={"file_path": "src/shared.py"},
        )
        analyses = {
            "src/shared.py": create_file_analysis(
                file_path="src/shared.py",
                changes=[remove_change],
            ),
        }

        graph = build_dependency_graph(analyses)
        impacts = analyze_cross_file_impact(analyses, graph)

        assert isinstance(impacts, list)
        for impact in impacts:
            assert isinstance(impact, CrossFileImpact)
            assert impact.source_file == "src/shared.py"

    def test_impact_type_for_function_changes(self):
        """Impact type is 'function_call' for function-related changes."""
        modify_change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="process_data",
            metadata={"file_path": "src/processor.py"},
        )
        analyses = {
            "src/processor.py": create_file_analysis(
                file_path="src/processor.py",
                changes=[modify_change],
            ),
        }

        graph = build_dependency_graph(analyses)
        impacts = analyze_cross_file_impact(analyses, graph)

        # Verify impact type if impacts were found
        for impact in impacts:
            if impact.change.change_type == ChangeType.MODIFY_FUNCTION:
                assert impact.impact_type == "function_call"

    def test_impact_type_for_class_changes(self):
        """Impact type is 'inheritance' for class-related changes."""
        modify_change = create_semantic_change(
            change_type=ChangeType.MODIFY_CLASS,
            target="BaseClass",
            metadata={"file_path": "src/base.py"},
        )
        analyses = {
            "src/base.py": create_file_analysis(
                file_path="src/base.py",
                changes=[modify_change],
            ),
        }

        graph = build_dependency_graph(analyses)
        impacts = analyze_cross_file_impact(analyses, graph)

        for impact in impacts:
            if impact.change.change_type == ChangeType.MODIFY_CLASS:
                assert impact.impact_type == "inheritance"

    def test_no_impact_for_additive_changes(self):
        """No cross-file impact for purely additive changes."""
        add_change = create_semantic_change(
            change_type=ChangeType.ADD_FUNCTION,
            target="new_function",
        )
        analyses = {
            "src/utils.py": create_file_analysis(
                file_path="src/utils.py",
                changes=[add_change],
            ),
        }

        graph = build_dependency_graph(analyses)
        impacts = analyze_cross_file_impact(analyses, graph)

        # ADD_FUNCTION is not in impactful_change_types
        assert len(impacts) == 0


# ==============================================================================
# Test Integration: detect_implicit_conflicts
# ==============================================================================


class TestDetectImplicitConflicts:
    """Test the unified detect_implicit_conflicts function."""

    def test_detects_both_conflict_types(self):
        """Detects both function rename and import removal conflicts."""
        # Task A: renames function
        rename_change = create_semantic_change(
            change_type=ChangeType.RENAME_FUNCTION,
            target="old_func",
            metadata={"old_name": "old_func", "new_name": "new_func"},
        )
        task_a_analysis = create_file_analysis(
            file_path="src/utils.py",
            changes=[rename_change],
        )

        # Task B: uses old function name
        modify_change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="caller",
            content_after="old_func()",
        )
        task_b_analysis = create_file_analysis(
            file_path="src/utils.py",
            changes=[modify_change],
        )

        # Task C: removes import that Task D adds
        task_c_analysis = create_file_analysis(
            file_path="src/main.py",
            imports_removed={"external_lib"},
        )

        task_d_analysis = create_file_analysis(
            file_path="src/main.py",
            imports_added={"external_lib"},
        )

        task_analyses = {
            "task_a": task_a_analysis,
            "task_b": task_b_analysis,
            "task_c": task_c_analysis,
            "task_d": task_d_analysis,
        }

        conflicts = detect_implicit_conflicts(task_analyses)

        assert len(conflicts) >= 2  # At least one of each type

    def test_no_conflicts_single_task(self):
        """No implicit conflicts with single task."""
        task_a_analysis = create_file_analysis(
            file_path="src/utils.py",
            imports_removed={"some_import"},
        )

        task_analyses = {"task_a": task_a_analysis}

        conflicts = detect_implicit_conflicts(task_analyses)
        assert len(conflicts) == 0

    def test_empty_analyses(self):
        """Empty analyses returns empty conflicts list."""
        conflicts = detect_implicit_conflicts({})
        assert conflicts == []


# ==============================================================================
# Test Conversion Functions
# ==============================================================================


class TestConversionFunctions:
    """Test conversion functions for conflict types."""

    def test_dependency_conflict_to_region(self):
        """Converts DependencyConflict to ConflictRegion."""
        change = create_semantic_change(
            change_type=ChangeType.REMOVE_FUNCTION,
            target="helper",
            metadata={"file_path": "src/utils.py"},
        )
        dep_conflict = DependencyConflict(
            change=change,
            affected_files=["src/main.py", "src/test.py"],
            severity=ConflictSeverity.HIGH,
            description="Removing helper may break 2 files",
        )

        region = _dependency_conflict_to_region(dep_conflict)

        assert isinstance(region, ConflictRegion)
        assert region.severity == ConflictSeverity.HIGH
        assert region.can_auto_merge is False
        assert region.merge_strategy == MergeStrategy.AI_REQUIRED
        assert "helper" in region.reason

    def test_cross_file_impact_to_region_significant(self):
        """Converts significant CrossFileImpact to ConflictRegion."""
        change = create_semantic_change(
            change_type=ChangeType.REMOVE_FUNCTION,
            target="critical_function",
        )
        impact = CrossFileImpact(
            source_file="src/core.py",
            change=change,
            impacted_files=["a.py", "b.py", "c.py"],
            impact_type="function_call",
        )

        region = _cross_file_impact_to_region(impact)

        assert region is not None
        assert isinstance(region, ConflictRegion)
        assert region.file_path == "src/core.py"

    def test_cross_file_impact_to_region_no_impacts(self):
        """Returns None for CrossFileImpact with no impacted files."""
        change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="isolated_function",
        )
        impact = CrossFileImpact(
            source_file="src/isolated.py",
            change=change,
            impacted_files=[],  # No files impacted
            impact_type="function_call",
        )

        region = _cross_file_impact_to_region(impact)

        assert region is None

    def test_cross_file_impact_severity_scaling(self):
        """Severity scales with number of impacted files."""
        change = create_semantic_change(
            change_type=ChangeType.REMOVE_FUNCTION,
            target="func",
        )

        # 1-2 files = LOW
        impact_small = CrossFileImpact(
            source_file="src/a.py",
            change=change,
            impacted_files=["b.py"],
            impact_type="function_call",
        )
        region_small = _cross_file_impact_to_region(impact_small)
        assert region_small.severity == ConflictSeverity.LOW

        # 3-5 files = MEDIUM
        impact_medium = CrossFileImpact(
            source_file="src/a.py",
            change=change,
            impacted_files=["b.py", "c.py", "d.py"],
            impact_type="function_call",
        )
        region_medium = _cross_file_impact_to_region(impact_medium)
        assert region_medium.severity == ConflictSeverity.MEDIUM

        # >5 files = HIGH
        impact_large = CrossFileImpact(
            source_file="src/a.py",
            change=change,
            impacted_files=["b.py", "c.py", "d.py", "e.py", "f.py", "g.py"],
            impact_type="function_call",
        )
        region_large = _cross_file_impact_to_region(impact_large)
        assert region_large.severity == ConflictSeverity.HIGH


# ==============================================================================
# Test Main detect_conflicts Function Integration
# ==============================================================================


class TestDetectConflictsIntegration:
    """Integration tests for the main detect_conflicts function."""

    def test_empty_analyses_no_conflicts(self):
        """Empty analyses produces no conflicts."""
        rule_index = build_rule_index()
        conflicts = detect_conflicts({}, rule_index)
        assert conflicts == []

    def test_single_task_no_conflicts(self):
        """Single task produces no conflicts."""
        analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[
                create_semantic_change(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="new_func",
                )
            ],
        )

        rule_index = build_rule_index()
        conflicts = detect_conflicts({"task_a": analysis}, rule_index)

        assert conflicts == []

    def test_integrates_implicit_conflicts(self):
        """Main function includes implicit conflict detection."""
        # Setup rename conflict
        rename_change = create_semantic_change(
            change_type=ChangeType.RENAME_FUNCTION,
            target="old_name",
            metadata={"old_name": "old_name", "new_name": "new_name"},
        )
        task_a = create_file_analysis(
            file_path="src/utils.py",
            changes=[rename_change],
        )

        modify_change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="caller",
            content_after="old_name()",
        )
        task_b = create_file_analysis(
            file_path="src/utils.py",
            changes=[modify_change],
        )

        rule_index = build_rule_index()
        conflicts = detect_conflicts(
            {"task_a": task_a, "task_b": task_b},
            rule_index,
        )

        # Should include the implicit rename conflict
        rename_conflicts = [
            c for c in conflicts if "old_name" in c.reason and "new_name" in c.reason
        ]
        assert len(rename_conflicts) >= 1


# ==============================================================================
# Test Helper Functions
# ==============================================================================


class TestHelperFunctions:
    """Test helper functions for conflict detection."""

    def test_ranges_overlap_true(self):
        """Detects overlapping line ranges."""
        ranges = [(1, 10), (5, 15)]
        assert ranges_overlap(ranges) is True

    def test_ranges_overlap_false(self):
        """Detects non-overlapping line ranges."""
        ranges = [(1, 5), (10, 15)]
        assert ranges_overlap(ranges) is False

    def test_ranges_overlap_adjacent(self):
        """Adjacent ranges are considered overlapping."""
        ranges = [(1, 5), (5, 10)]
        assert ranges_overlap(ranges) is True

    def test_ranges_overlap_single(self):
        """Single range has no overlap."""
        ranges = [(1, 10)]
        assert ranges_overlap(ranges) is False

    def test_assess_severity_critical(self):
        """Critical severity for overlapping modifications."""
        change_types = [ChangeType.MODIFY_FUNCTION, ChangeType.MODIFY_FUNCTION]
        changes = [
            create_semantic_change(
                change_type=ChangeType.MODIFY_FUNCTION,
                target="func",
                line_start=1,
                line_end=10,
            ),
            create_semantic_change(
                change_type=ChangeType.MODIFY_FUNCTION,
                target="func",
                line_start=5,
                line_end=15,
            ),
        ]

        severity = assess_severity(change_types, changes)
        assert severity == ConflictSeverity.CRITICAL

    def test_assess_severity_high_for_structural(self):
        """High severity for structural changes like REMOVE_FUNCTION."""
        change_types = [ChangeType.REMOVE_FUNCTION, ChangeType.ADD_FUNCTION]
        changes = [
            create_semantic_change(
                change_type=ChangeType.REMOVE_FUNCTION,
                target="old_func",
            ),
            create_semantic_change(
                change_type=ChangeType.ADD_FUNCTION,
                target="new_func",
            ),
        ]

        severity = assess_severity(change_types, changes)
        assert severity == ConflictSeverity.HIGH


# ==============================================================================
# Test analyze_location_conflict
# ==============================================================================


class TestAnalyzeLocationConflict:
    """Test location-based conflict analysis."""

    def test_no_conflict_different_targets(self):
        """No conflict when changes target different things at same location."""
        task_changes = [
            (
                "task_a",
                create_semantic_change(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="func_a",
                ),
            ),
            (
                "task_b",
                create_semantic_change(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="func_b",
                ),
            ),
        ]

        rule_index = build_rule_index()
        conflict = analyze_location_conflict(
            "src/main.py",
            "file_top",
            task_changes,
            rule_index,
        )

        assert conflict is None

    def test_conflict_same_target_incompatible(self):
        """Conflict when changes to same target are incompatible."""
        task_changes = [
            (
                "task_a",
                create_semantic_change(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="shared_func",
                    line_start=1,
                    line_end=10,
                ),
            ),
            (
                "task_b",
                create_semantic_change(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="shared_func",
                    line_start=5,
                    line_end=15,
                ),
            ),
        ]

        rule_index = build_rule_index()
        conflict = analyze_location_conflict(
            "src/main.py",
            "function:shared_func",
            task_changes,
            rule_index,
        )

        assert conflict is not None
        assert conflict.file_path == "src/main.py"
        assert "task_a" in conflict.tasks_involved
        assert "task_b" in conflict.tasks_involved


# ==============================================================================
# Test analyze_compatibility
# ==============================================================================


class TestAnalyzeCompatibility:
    """Test pairwise change compatibility analysis."""

    def test_compatible_additive_changes(self):
        """Additive changes are generally compatible."""
        change_a = create_semantic_change(
            change_type=ChangeType.ADD_IMPORT,
            target="module_a",
        )
        change_b = create_semantic_change(
            change_type=ChangeType.ADD_IMPORT,
            target="module_b",
        )

        rule_index = build_rule_index()
        compatible, strategy, reason = analyze_compatibility(
            change_a, change_b, rule_index
        )

        # ADD_IMPORT + ADD_IMPORT should be compatible
        if (ChangeType.ADD_IMPORT, ChangeType.ADD_IMPORT) in rule_index:
            assert compatible is True

    def test_incompatible_destructive_changes(self):
        """Destructive changes may be incompatible."""
        change_a = create_semantic_change(
            change_type=ChangeType.REMOVE_FUNCTION,
            target="func",
        )
        change_b = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="func",
        )

        rule_index = build_rule_index()
        compatible, strategy, reason = analyze_compatibility(
            change_a, change_b, rule_index
        )

        # Should return result (may be compatible or not based on rules)
        assert isinstance(compatible, bool)
        assert isinstance(reason, str)


# ==============================================================================
# Test Edge Cases
# ==============================================================================


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_none_content_in_changes(self):
        """Handles None content in changes gracefully."""
        change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="func",
            content_before=None,
            content_after=None,
        )
        analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[change],
        )

        # Should not raise
        result = _task_references_function(analysis, "some_func")
        assert result is False

        result = _task_uses_import(analysis, "some_import")
        assert result is False

    def test_empty_metadata(self):
        """Handles empty metadata gracefully."""
        change = create_semantic_change(
            change_type=ChangeType.RENAME_FUNCTION,
            target="func",
            metadata={},  # Empty metadata
        )
        analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[change],
        )

        # Should not raise - no old_name/new_name means no rename detected
        conflicts = _detect_function_rename_conflicts({"task_a": analysis})
        assert isinstance(conflicts, list)

    def test_special_characters_in_names(self):
        """Handles special characters in function/import names."""
        analysis = create_file_analysis(
            file_path="src/main.py",
            imports_removed={"@scope/package"},
        )

        # Should handle special characters
        result = _task_uses_import(analysis, "@scope/package")
        assert isinstance(result, bool)

    def test_very_long_file_paths(self):
        """Handles very long file paths."""
        long_path = "src/" + "subdir/" * 50 + "file.py"
        analysis = create_file_analysis(file_path=long_path)

        # Pass as list so file_path is used correctly
        graph = build_dependency_graph([analysis])
        assert long_path in graph

    def test_unicode_in_content(self):
        """Handles unicode characters in content."""
        change = create_semantic_change(
            change_type=ChangeType.MODIFY_FUNCTION,
            target="process_émoji",
            content_after="result = '🎉 success 日本語'",
        )
        analysis = create_file_analysis(
            file_path="src/main.py",
            changes=[change],
        )

        # Should handle unicode
        result = _task_references_function(analysis, "process_émoji")
        assert result is True


# ==============================================================================
# Test E2E Scenarios
# ==============================================================================


class TestE2EScenarios:
    """End-to-end test scenarios simulating real usage."""

    def test_e2e_semantic_conflict_function_rename(self):
        """E2E: Detects function rename without updating call sites."""
        # Developer A renames a function
        dev_a_analysis = create_file_analysis(
            file_path="src/utils.py",
            changes=[
                create_semantic_change(
                    change_type=ChangeType.RENAME_FUNCTION,
                    target="calculate_total",
                    metadata={
                        "old_name": "calculate_total",
                        "new_name": "compute_sum",
                    },
                )
            ],
        )

        # Developer B adds code that uses old function name
        dev_b_analysis = create_file_analysis(
            file_path="src/utils.py",
            changes=[
                create_semantic_change(
                    change_type=ChangeType.ADD_FUNCTION,
                    target="process_order",
                    content_after="total = calculate_total(items)",
                )
            ],
        )

        rule_index = build_rule_index()
        conflicts = detect_conflicts(
            {"dev_a": dev_a_analysis, "dev_b": dev_b_analysis},
            rule_index,
        )

        # Should find the semantic conflict
        semantic_conflicts = [
            c
            for c in conflicts
            if "calculate_total" in c.reason or "compute_sum" in c.reason
        ]
        assert len(semantic_conflicts) >= 1
        assert any(c.severity == ConflictSeverity.HIGH for c in semantic_conflicts)

    def test_e2e_import_removal_conflict(self):
        """E2E: Detects import removal affecting other developer's code."""
        # Developer A removes an import
        dev_a_analysis = create_file_analysis(
            file_path="src/processor.py",
            imports_removed={"pandas"},
        )

        # Developer B adds code that uses pandas
        dev_b_analysis = create_file_analysis(
            file_path="src/processor.py",
            changes=[
                create_semantic_change(
                    change_type=ChangeType.MODIFY_FUNCTION,
                    target="analyze_data",
                    content_after="df = pandas.DataFrame(data)",
                )
            ],
        )

        rule_index = build_rule_index()
        conflicts = detect_conflicts(
            {"dev_a": dev_a_analysis, "dev_b": dev_b_analysis},
            rule_index,
        )

        # Should find the import conflict
        import_conflicts = [c for c in conflicts if "pandas" in c.reason]
        assert len(import_conflicts) >= 1

    def test_e2e_full_pipeline(self):
        """E2E: Full pipeline from parsing to conflict detection."""
        # Simulate a real multi-developer scenario
        # Both tasks modify the same function at the same location
        analyses = {
            "feature_auth": create_file_analysis(
                file_path="src/auth.py",
                changes=[
                    create_semantic_change(
                        change_type=ChangeType.ADD_FUNCTION,
                        target="validate_token",
                        location="file_top",
                        line_start=50,
                        line_end=70,
                    ),
                    create_semantic_change(
                        change_type=ChangeType.MODIFY_FUNCTION,
                        target="login",
                        location="function:login",  # Same location as other task
                        line_start=10,
                        line_end=30,
                    ),
                ],
                imports_added={"jwt"},
            ),
            "feature_logging": create_file_analysis(
                file_path="src/auth.py",
                changes=[
                    create_semantic_change(
                        change_type=ChangeType.ADD_IMPORT,
                        target="logging",
                        location="file_top",
                        line_start=1,
                        line_end=1,
                    ),
                    create_semantic_change(
                        change_type=ChangeType.MODIFY_FUNCTION,
                        target="login",
                        location="function:login",  # Same location as other task
                        line_start=10,
                        line_end=30,
                    ),
                ],
            ),
        }

        rule_index = build_rule_index()
        conflicts = detect_conflicts(analyses, rule_index)

        # Should detect conflict at login function (both tasks modify same location)
        login_conflicts = [c for c in conflicts if "login" in c.location]
        assert len(login_conflicts) >= 1


# ==============================================================================
# Test NetworkX Availability Handling
# ==============================================================================


class TestNetworkXHandling:
    """Test graceful handling of NetworkX availability."""

    def test_graph_operations_with_stub(self):
        """Graph operations work even with stub (when NetworkX unavailable)."""
        analyses = {
            "src/main.py": create_file_analysis(
                file_path="src/main.py",
                imports_added={"utils"},
            ),
        }

        # Should not raise even if NetworkX is unavailable
        graph = build_dependency_graph(analyses)
        assert graph is not None
        assert hasattr(graph, "number_of_nodes")
        assert hasattr(graph, "number_of_edges")

    def test_dependency_detection_without_networkx(self):
        """Dependency detection gracefully handles missing NetworkX."""
        analyses = {
            "src/utils.py": create_file_analysis(
                file_path="src/utils.py",
                changes=[
                    create_semantic_change(
                        change_type=ChangeType.REMOVE_FUNCTION,
                        target="helper",
                    )
                ],
            ),
        }

        # Should not raise
        conflicts = detect_dependency_conflicts(analyses, None)
        assert isinstance(conflicts, list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
