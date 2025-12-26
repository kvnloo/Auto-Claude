"""
Semantic Analyzer
=================

Analyzes code changes at a semantic level using tree-sitter.

This module provides AST-based analysis of code changes, extracting
meaningful semantic changes like "added import", "modified function",
"wrapped JSX element" rather than line-level diffs.

When tree-sitter is not available, falls back to regex-based heuristics.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .types import ChangeType, ConflictSeverity, CrossFileImpact, DependencyConflict, FileAnalysis, SemanticChange

# Try to import networkx - it's optional for dependency graph analysis
NETWORKX_AVAILABLE = False
try:
    import networkx as nx

    NETWORKX_AVAILABLE = True
except ImportError:
    nx = None  # type: ignore

# Import debug utilities
try:
    from debug import (
        debug,
        debug_detailed,
        debug_error,
        debug_success,
        debug_verbose,
        is_debug_enabled,
    )
except ImportError:
    # Fallback if debug module not available
    def debug(*args, **kwargs):
        pass

    def debug_detailed(*args, **kwargs):
        pass

    def debug_verbose(*args, **kwargs):
        pass

    def debug_success(*args, **kwargs):
        pass

    def debug_error(*args, **kwargs):
        pass

    def is_debug_enabled():
        return False


logger = logging.getLogger(__name__)
MODULE = "merge.semantic_analyzer"

# Try to import tree-sitter - it's optional but recommended
TREE_SITTER_AVAILABLE = False
try:
    import tree_sitter  # noqa: F401
    from tree_sitter import Language, Node, Parser, Tree

    TREE_SITTER_AVAILABLE = True
    logger.info("tree-sitter available, using AST-based analysis")
except ImportError:
    logger.warning("tree-sitter not available, using regex-based fallback")
    Tree = None
    Node = None

# Try to import language bindings
LANGUAGES_AVAILABLE: dict[str, Any] = {}
if TREE_SITTER_AVAILABLE:
    try:
        import tree_sitter_python as tspython

        LANGUAGES_AVAILABLE[".py"] = tspython.language()
    except ImportError:
        pass

    try:
        import tree_sitter_javascript as tsjs

        LANGUAGES_AVAILABLE[".js"] = tsjs.language()
        LANGUAGES_AVAILABLE[".jsx"] = tsjs.language()
    except ImportError:
        pass

    try:
        import tree_sitter_typescript as tsts

        LANGUAGES_AVAILABLE[".ts"] = tsts.language_typescript()
        LANGUAGES_AVAILABLE[".tsx"] = tsts.language_tsx()
    except ImportError:
        pass

# Import our modular components
from .semantic_analysis.comparison import compare_elements
from .semantic_analysis.models import ExtractedElement
from .semantic_analysis.regex_analyzer import analyze_with_regex

if TREE_SITTER_AVAILABLE:
    from .semantic_analysis.js_analyzer import extract_js_elements
    from .semantic_analysis.python_analyzer import extract_python_elements


class SemanticAnalyzer:
    """
    Analyzes code changes at a semantic level.

    Uses tree-sitter for AST-based analysis when available,
    falling back to regex-based heuristics when not.

    Example:
        analyzer = SemanticAnalyzer()
        analysis = analyzer.analyze_diff("src/App.tsx", before_code, after_code)
        for change in analysis.changes:
            print(f"{change.change_type.value}: {change.target}")
    """

    def __init__(self):
        """Initialize the analyzer with available parsers."""
        self._parsers: dict[str, Parser] = {}

        debug(
            MODULE,
            "Initializing SemanticAnalyzer",
            tree_sitter_available=TREE_SITTER_AVAILABLE,
        )

        if TREE_SITTER_AVAILABLE:
            for ext, lang in LANGUAGES_AVAILABLE.items():
                parser = Parser()
                parser.language = Language(lang)
                self._parsers[ext] = parser
                debug_detailed(MODULE, f"Initialized parser for {ext}")
            debug_success(
                MODULE,
                "SemanticAnalyzer initialized",
                parsers=list(self._parsers.keys()),
            )
        else:
            debug(MODULE, "Using regex-based fallback (tree-sitter not available)")

    def analyze_diff(
        self,
        file_path: str,
        before: str,
        after: str,
        task_id: str | None = None,
    ) -> FileAnalysis:
        """
        Analyze the semantic differences between two versions of a file.

        Args:
            file_path: Path to the file being analyzed
            before: Content before changes
            after: Content after changes
            task_id: Optional task ID for context

        Returns:
            FileAnalysis containing semantic changes
        """
        ext = Path(file_path).suffix.lower()

        debug(
            MODULE,
            f"Analyzing diff for {file_path}",
            file_path=file_path,
            extension=ext,
            before_length=len(before),
            after_length=len(after),
            task_id=task_id,
        )

        # Use tree-sitter if available for this language
        if ext in self._parsers:
            debug_detailed(MODULE, f"Using tree-sitter parser for {ext}")
            analysis = self._analyze_with_tree_sitter(file_path, before, after, ext)
        else:
            debug_detailed(MODULE, f"Using regex fallback for {ext}")
            analysis = analyze_with_regex(file_path, before, after, ext)

        debug_success(
            MODULE,
            f"Analysis complete for {file_path}",
            changes_found=len(analysis.changes),
            functions_modified=len(analysis.functions_modified),
            functions_added=len(analysis.functions_added),
            imports_added=len(analysis.imports_added),
            total_lines_changed=analysis.total_lines_changed,
        )

        # Log each change at verbose level
        for change in analysis.changes:
            debug_verbose(
                MODULE,
                f"  Change: {change.change_type.value}",
                target=change.target,
                location=change.location,
                lines=f"{change.line_start}-{change.line_end}",
            )

        return analysis

    def _analyze_with_tree_sitter(
        self,
        file_path: str,
        before: str,
        after: str,
        ext: str,
    ) -> FileAnalysis:
        """Analyze using tree-sitter AST parsing."""
        parser = self._parsers[ext]

        tree_before = parser.parse(bytes(before, "utf-8"))
        tree_after = parser.parse(bytes(after, "utf-8"))

        # Extract structural elements from both versions
        elements_before = self._extract_elements(tree_before, before, ext)
        elements_after = self._extract_elements(tree_after, after, ext)

        # Compare and generate semantic changes
        changes = compare_elements(elements_before, elements_after, ext)

        # Build the analysis
        analysis = FileAnalysis(file_path=file_path, changes=changes)

        # Populate summary fields
        for change in changes:
            if change.change_type in {
                ChangeType.MODIFY_FUNCTION,
                ChangeType.ADD_HOOK_CALL,
            }:
                analysis.functions_modified.add(change.target)
            elif change.change_type == ChangeType.ADD_FUNCTION:
                analysis.functions_added.add(change.target)
            elif change.change_type == ChangeType.ADD_IMPORT:
                analysis.imports_added.add(change.target)
            elif change.change_type == ChangeType.REMOVE_IMPORT:
                analysis.imports_removed.add(change.target)
            elif change.change_type in {
                ChangeType.MODIFY_CLASS,
                ChangeType.ADD_METHOD,
            }:
                analysis.classes_modified.add(change.target.split(".")[0])

            analysis.total_lines_changed += change.line_end - change.line_start + 1

        return analysis

    def _extract_elements(
        self,
        tree: Tree,
        source: str,
        ext: str,
    ) -> dict[str, ExtractedElement]:
        """Extract structural elements from a syntax tree."""
        elements: dict[str, ExtractedElement] = {}
        source_bytes = bytes(source, "utf-8")

        def get_text(node: Node) -> str:
            return source_bytes[node.start_byte : node.end_byte].decode("utf-8")

        def get_line(byte_pos: int) -> int:
            # Convert byte position to line number (1-indexed)
            return source[:byte_pos].count("\n") + 1

        # Language-specific extraction
        if ext == ".py":
            extract_python_elements(tree.root_node, elements, get_text, get_line)
        elif ext in {".js", ".jsx", ".ts", ".tsx"}:
            extract_js_elements(tree.root_node, elements, get_text, get_line, ext)

        return elements

    def analyze_file(self, file_path: str, content: str) -> FileAnalysis:
        """
        Analyze a single file's structure (not a diff).

        Useful for capturing baseline state.

        Args:
            file_path: Path to the file
            content: File content

        Returns:
            FileAnalysis with structural elements (no changes, just structure)
        """
        # Analyze against empty string to get all elements as "additions"
        return self.analyze_diff(file_path, "", content)

    @property
    def supported_extensions(self) -> set[str]:
        """Get the set of supported file extensions."""
        if TREE_SITTER_AVAILABLE:
            # Tree-sitter extensions plus regex fallbacks
            return set(self._parsers.keys()) | {".py", ".js", ".jsx", ".ts", ".tsx"}
        else:
            # Only regex-supported extensions
            return {".py", ".js", ".jsx", ".ts", ".tsx"}

    def is_supported(self, file_path: str) -> bool:
        """Check if a file type is supported for semantic analysis."""
        ext = Path(file_path).suffix.lower()
        return ext in self.supported_extensions


def build_dependency_graph(
    file_analyses: dict[str, FileAnalysis] | list[FileAnalysis],
) -> Any:
    """
    Build a directed graph of file dependencies based on import relationships.

    Creates a NetworkX DiGraph where nodes are file paths and edges represent
    import dependencies. An edge from file A to file B means "A imports/depends on B".

    This graph is used for:
    - Cross-file impact analysis (find files affected by a change)
    - Dependency conflict detection (warn when changes break downstream modules)
    - Circular dependency detection

    Args:
        file_analyses: Either a dict mapping file paths to FileAnalysis objects,
                      or a list of FileAnalysis objects.

    Returns:
        nx.DiGraph: A directed graph of file dependencies.
                   Returns an empty DiGraph if networkx is not available.

    Example:
        analyses = {
            'src/utils.py': FileAnalysis(file_path='src/utils.py', imports_added={'os'}),
            'src/main.py': FileAnalysis(file_path='src/main.py', imports_added={'src.utils'}),
        }
        graph = build_dependency_graph(analyses)
        # graph has edge: 'src/main.py' -> 'src.utils' (main imports utils)
    """
    # Handle case when networkx is not available
    if not NETWORKX_AVAILABLE:
        debug(
            MODULE,
            "NetworkX not available, returning stub graph",
        )
        # Return a simple stub that mimics DiGraph interface for basic operations
        return _StubDiGraph()

    G = nx.DiGraph()

    # Convert list to dict if necessary
    analyses_dict: dict[str, FileAnalysis] = {}
    if isinstance(file_analyses, dict):
        analyses_dict = file_analyses
    elif isinstance(file_analyses, list):
        analyses_dict = {fa.file_path: fa for fa in file_analyses}

    debug(
        MODULE,
        "Building dependency graph",
        num_files=len(analyses_dict),
    )

    # Add nodes for all analyzed files
    for file_path in analyses_dict:
        G.add_node(file_path)

    # Build edges from import relationships
    for file_path, analysis in analyses_dict.items():
        # Add edges for new imports (file_path depends on imported module)
        for import_module in analysis.imports_added:
            # Add edge: this file depends on the imported module
            G.add_edge(file_path, import_module)
            debug_detailed(
                MODULE,
                f"Added import dependency: {file_path} -> {import_module}",
            )

        # Also consider existing imports from changes metadata
        for change in analysis.changes:
            if change.change_type == ChangeType.ADD_IMPORT:
                # The target of an ADD_IMPORT is the module being imported
                G.add_edge(file_path, change.target)

    debug_success(
        MODULE,
        "Dependency graph built",
        nodes=G.number_of_nodes(),
        edges=G.number_of_edges(),
    )

    return G


class _StubDiGraph:
    """
    Stub implementation of DiGraph interface when networkx is not available.

    Provides minimal interface compatibility for graceful degradation.
    """

    def __init__(self):
        self._nodes: set[str] = set()
        self._edges: list[tuple[str, str]] = []

    def add_node(self, node: str) -> None:
        """Add a node to the graph."""
        self._nodes.add(node)

    def add_edge(self, source: str, target: str) -> None:
        """Add an edge to the graph."""
        self._nodes.add(source)
        self._nodes.add(target)
        self._edges.append((source, target))

    def number_of_nodes(self) -> int:
        """Return the number of nodes."""
        return len(self._nodes)

    def number_of_edges(self) -> int:
        """Return the number of edges."""
        return len(self._edges)

    def __contains__(self, node: str) -> bool:
        """Check if a node is in the graph."""
        return node in self._nodes

    def nodes(self) -> set[str]:
        """Return all nodes."""
        return self._nodes

    def edges(self) -> list[tuple[str, str]]:
        """Return all edges."""
        return self._edges


def detect_dependency_conflicts(
    file_analyses: dict[str, FileAnalysis] | list[FileAnalysis],
    graph: Any | None,
) -> list[DependencyConflict]:
    """
    Detect when changes break downstream dependencies using graph analysis.

    Analyzes semantic changes and uses the dependency graph to identify
    when modifications to one file may break other files that depend on it.

    Breaking changes that are detected:
    - REMOVE_FUNCTION: A function that other files may call is removed
    - REMOVE_IMPORT: An import that may be re-exported is removed
    - MODIFY_FUNCTION: A function signature change that may break callers
    - RENAME_FUNCTION: A function rename without updating call sites
    - REMOVE_METHOD: A method that other files may call is removed
    - REMOVE_CLASS: A class that other files may use is removed

    Args:
        file_analyses: Either a dict mapping file paths to FileAnalysis objects,
                      or a list of FileAnalysis objects.
        graph: Optional NetworkX DiGraph of file dependencies.
               If None, a new graph will be built from file_analyses.

    Returns:
        list[DependencyConflict]: List of detected dependency conflicts.

    Example:
        analyses = {...}  # FileAnalysis objects
        graph = build_dependency_graph(analyses)
        conflicts = detect_dependency_conflicts(analyses, graph)
        for conflict in conflicts:
            print(f"Change may break {len(conflict.affected_files)} files")
    """
    conflicts: list[DependencyConflict] = []

    # Convert list to dict if necessary
    analyses_dict: dict[str, FileAnalysis] = {}
    if isinstance(file_analyses, dict):
        analyses_dict = file_analyses
    elif isinstance(file_analyses, list):
        analyses_dict = {fa.file_path: fa for fa in file_analyses}

    # If no analyses, return empty list
    if not analyses_dict:
        return conflicts

    # Build graph if not provided
    if graph is None:
        graph = build_dependency_graph(file_analyses)

    debug(
        MODULE,
        "Detecting dependency conflicts",
        num_files=len(analyses_dict),
        graph_available=graph is not None,
    )

    # Change types that may break downstream dependencies
    breaking_change_types = {
        ChangeType.REMOVE_FUNCTION,
        ChangeType.REMOVE_IMPORT,
        ChangeType.MODIFY_FUNCTION,
        ChangeType.RENAME_FUNCTION,
        ChangeType.REMOVE_METHOD,
        ChangeType.REMOVE_CLASS,
    }

    # Iterate through all file analyses to find breaking changes
    for file_path, analysis in analyses_dict.items():
        for change in analysis.changes:
            if change.change_type in breaking_change_types:
                # Find files that depend on this file (files that import/use it)
                affected_files = _find_dependent_files(graph, file_path)

                if affected_files:
                    # Determine severity based on change type and number of affected files
                    severity = _determine_conflict_severity(
                        change.change_type, len(affected_files)
                    )

                    # Create description
                    description = _create_conflict_description(
                        change, file_path, affected_files
                    )

                    # Add file_path to change metadata if not present
                    if "file_path" not in change.metadata:
                        change.metadata["file_path"] = file_path

                    conflict = DependencyConflict(
                        change=change,
                        affected_files=affected_files,
                        severity=severity,
                        description=description,
                    )
                    conflicts.append(conflict)

                    debug_detailed(
                        MODULE,
                        f"Detected dependency conflict: {change.change_type.value}",
                        file_path=file_path,
                        target=change.target,
                        affected_count=len(affected_files),
                        severity=severity.value,
                    )

    debug_success(
        MODULE,
        "Dependency conflict detection complete",
        conflicts_found=len(conflicts),
    )

    return conflicts


def _find_dependent_files(graph: Any, file_path: str) -> list[str]:
    """
    Find all files that depend on the given file using the dependency graph.

    Uses nx.ancestors() to find upstream files (files that import this file).
    Note: In our graph, edges go from importer -> imported, so we want
    files where an edge points TO this file (predecessors/ancestors).

    Args:
        graph: NetworkX DiGraph or stub graph
        file_path: The file path to find dependents for

    Returns:
        list[str]: List of file paths that depend on file_path
    """
    if graph is None:
        return []

    # Check if the file is in the graph
    if file_path not in graph:
        return []

    # For NetworkX DiGraph
    if NETWORKX_AVAILABLE and hasattr(graph, "predecessors"):
        # predecessors() gives files that have an edge TO this file
        # This means files that import/depend on this file
        try:
            # Get direct predecessors (files that directly import this file)
            dependents = list(graph.predecessors(file_path))
            return dependents
        except Exception:
            return []

    # For stub graph, search edges manually
    if hasattr(graph, "edges"):
        dependents = []
        for source, target in graph.edges():
            if target == file_path:
                dependents.append(source)
        return dependents

    return []


def _determine_conflict_severity(
    change_type: ChangeType, affected_count: int
) -> ConflictSeverity:
    """
    Determine the severity of a dependency conflict.

    Args:
        change_type: The type of breaking change
        affected_count: Number of files affected

    Returns:
        ConflictSeverity: The severity level
    """
    # Remove operations are more severe than modifications
    if change_type in {
        ChangeType.REMOVE_FUNCTION,
        ChangeType.REMOVE_CLASS,
        ChangeType.REMOVE_METHOD,
    }:
        if affected_count > 5:
            return ConflictSeverity.CRITICAL
        elif affected_count > 2:
            return ConflictSeverity.HIGH
        else:
            return ConflictSeverity.MEDIUM

    # Rename without updating call sites
    if change_type == ChangeType.RENAME_FUNCTION:
        return ConflictSeverity.HIGH

    # Modifications may or may not break callers
    if change_type == ChangeType.MODIFY_FUNCTION:
        if affected_count > 5:
            return ConflictSeverity.HIGH
        elif affected_count > 2:
            return ConflictSeverity.MEDIUM
        else:
            return ConflictSeverity.LOW

    # Import removal
    if change_type == ChangeType.REMOVE_IMPORT:
        return ConflictSeverity.MEDIUM

    return ConflictSeverity.LOW


def _create_conflict_description(
    change: SemanticChange, file_path: str, affected_files: list[str]
) -> str:
    """
    Create a human-readable description of the dependency conflict.

    Args:
        change: The semantic change causing the conflict
        file_path: The file where the change occurred
        affected_files: List of affected file paths

    Returns:
        str: Human-readable description
    """
    change_descriptions = {
        ChangeType.REMOVE_FUNCTION: f"Removing function '{change.target}'",
        ChangeType.REMOVE_IMPORT: f"Removing import '{change.target}'",
        ChangeType.MODIFY_FUNCTION: f"Modifying function '{change.target}'",
        ChangeType.RENAME_FUNCTION: f"Renaming function '{change.target}'",
        ChangeType.REMOVE_METHOD: f"Removing method '{change.target}'",
        ChangeType.REMOVE_CLASS: f"Removing class '{change.target}'",
    }

    action = change_descriptions.get(
        change.change_type, f"Change to '{change.target}'"
    )

    affected_summary = (
        f"{len(affected_files)} dependent file(s)"
        if len(affected_files) > 3
        else ", ".join(affected_files)
    )

    return f"{action} in {file_path} may break {affected_summary}"


def analyze_cross_file_impact(
    file_analyses: dict[str, FileAnalysis] | list[FileAnalysis],
    graph: Any | None,
) -> list[CrossFileImpact]:
    """
    Analyze the ripple effects of changes across multiple files using graph traversal.

    Uses the dependency graph to find all downstream files affected by changes
    in each analyzed file. This helps identify the full scope of impact when
    a shared utility, function, or module is modified.

    Impact types detected:
    - 'import_dependency': Files that import the changed module
    - 'function_call': Files that may call modified/removed functions
    - 'inheritance': Files with classes that inherit from modified classes

    Args:
        file_analyses: Either a dict mapping file paths to FileAnalysis objects,
                      or a list of FileAnalysis objects.
        graph: Optional NetworkX DiGraph of file dependencies.
               If None, a new graph will be built from file_analyses.

    Returns:
        list[CrossFileImpact]: List of cross-file impact objects, each describing
                               how a change in one file affects other files.

    Example:
        analyses = {
            'src/utils.py': FileAnalysis(file_path='src/utils.py', ...),
            'src/main.py': FileAnalysis(file_path='src/main.py', ...),
        }
        graph = build_dependency_graph(analyses)
        impacts = analyze_cross_file_impact(analyses, graph)
        for impact in impacts:
            print(f"{impact.source_file}: affects {len(impact.impacted_files)} files")
    """
    impacts: list[CrossFileImpact] = []

    # Convert list to dict if necessary
    analyses_dict: dict[str, FileAnalysis] = {}
    if isinstance(file_analyses, dict):
        analyses_dict = file_analyses
    elif isinstance(file_analyses, list):
        analyses_dict = {fa.file_path: fa for fa in file_analyses}

    # If no analyses, return empty list
    if not analyses_dict:
        return impacts

    # Build graph if not provided
    if graph is None:
        graph = build_dependency_graph(file_analyses)

    debug(
        MODULE,
        "Analyzing cross-file impact",
        num_files=len(analyses_dict),
        graph_available=graph is not None,
    )

    # Change types that have significant cross-file impact
    impactful_change_types = {
        # Function changes
        ChangeType.REMOVE_FUNCTION,
        ChangeType.MODIFY_FUNCTION,
        ChangeType.RENAME_FUNCTION,
        # Import changes
        ChangeType.REMOVE_IMPORT,
        ChangeType.MODIFY_IMPORT,
        # Class changes
        ChangeType.REMOVE_CLASS,
        ChangeType.MODIFY_CLASS,
        ChangeType.REMOVE_METHOD,
        ChangeType.MODIFY_METHOD,
        # Type changes (TypeScript)
        ChangeType.MODIFY_TYPE,
        ChangeType.MODIFY_INTERFACE,
    }

    # Iterate through all file analyses to find impactful changes
    for file_path, analysis in analyses_dict.items():
        for change in analysis.changes:
            if change.change_type in impactful_change_types:
                # Find all files that depend on this file
                impacted_files = _find_all_impacted_files(graph, file_path)

                if impacted_files:
                    # Determine impact type based on change type
                    impact_type = _determine_impact_type(change.change_type)

                    # Add file_path to change metadata if not present
                    if "file_path" not in change.metadata:
                        change.metadata["file_path"] = file_path

                    impact = CrossFileImpact(
                        source_file=file_path,
                        change=change,
                        impacted_files=impacted_files,
                        impact_type=impact_type,
                    )
                    impacts.append(impact)

                    debug_detailed(
                        MODULE,
                        f"Cross-file impact detected: {change.change_type.value}",
                        source_file=file_path,
                        target=change.target,
                        impacted_count=len(impacted_files),
                        impact_type=impact_type,
                    )

    debug_success(
        MODULE,
        "Cross-file impact analysis complete",
        impacts_found=len(impacts),
    )

    return impacts


def _find_all_impacted_files(graph: Any, file_path: str) -> list[str]:
    """
    Find all files that may be impacted by changes to the given file.

    Uses graph traversal to find both direct dependents (files that import this file)
    and transitive dependents (files that depend on files that depend on this file).

    Args:
        graph: NetworkX DiGraph or stub graph
        file_path: The file path to find impacts for

    Returns:
        list[str]: List of file paths that may be impacted by changes to file_path
    """
    if graph is None:
        return []

    # Check if the file is in the graph
    if file_path not in graph:
        return []

    impacted: list[str] = []

    # For NetworkX DiGraph, use predecessors (files that import this file)
    # and optionally traverse the full dependency tree
    if NETWORKX_AVAILABLE and hasattr(graph, "predecessors"):
        try:
            # Get direct predecessors (files that directly import this file)
            direct_dependents = set(graph.predecessors(file_path))

            # For a more complete picture, we could also find transitive dependents
            # using nx.ancestors(), but for now we focus on direct dependencies
            # to avoid over-reporting
            impacted = list(direct_dependents)

            # Sort for consistent ordering
            impacted.sort()
            return impacted
        except Exception:
            return []

    # For stub graph, search edges manually
    if hasattr(graph, "edges"):
        for source, target in graph.edges():
            if target == file_path:
                impacted.append(source)
        impacted.sort()
        return impacted

    return []


def _determine_impact_type(change_type: ChangeType) -> str:
    """
    Determine the type of cross-file impact based on the change type.

    Args:
        change_type: The type of semantic change

    Returns:
        str: The impact type string
    """
    if change_type in {
        ChangeType.REMOVE_FUNCTION,
        ChangeType.MODIFY_FUNCTION,
        ChangeType.RENAME_FUNCTION,
        ChangeType.REMOVE_METHOD,
        ChangeType.MODIFY_METHOD,
    }:
        return "function_call"

    if change_type in {
        ChangeType.REMOVE_CLASS,
        ChangeType.MODIFY_CLASS,
    }:
        return "inheritance"

    if change_type in {
        ChangeType.REMOVE_IMPORT,
        ChangeType.MODIFY_IMPORT,
    }:
        return "import_dependency"

    if change_type in {
        ChangeType.MODIFY_TYPE,
        ChangeType.MODIFY_INTERFACE,
    }:
        return "type_dependency"

    return "unknown"


# Re-export ExtractedElement for backwards compatibility
__all__ = [
    "SemanticAnalyzer",
    "ExtractedElement",
    "build_dependency_graph",
    "detect_dependency_conflicts",
    "analyze_cross_file_impact",
]
