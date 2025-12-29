"""
Auto Claude CLI Package
=======================

Command-line interface for the Auto Claude autonomous coding framework.

This package provides a modular CLI structure:
- main.py: Argument parsing and command routing
- spec_commands.py: Spec listing and management
- build_commands.py: Build execution and follow-up tasks
- workspace_commands.py: Workspace management (merge, review, discard)
- qa_commands.py: QA validation commands
- swebench_eval.py: SWE-bench evaluation CLI
- utils.py: Shared utilities and configuration
"""


def __getattr__(name: str):
    """Lazy import to avoid loading all dependencies at package import time."""
    if name == "main":
        from .main import main

        return main
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["main"]
