"""
SWE-bench Adapters
==================

Data transformation adapters for converting between SWE-bench and autoclaude formats.

Adapters:
    - instance_adapter: SWE-bench instance -> autoclaude spec format
    - results_adapter: autoclaude results -> SWE-bench prediction format
"""

from swebench.adapters.instance_adapter import (
    AutoClaudeSpec,
    convert_to_autoclaude_spec,
)

__all__ = [
    "AutoClaudeSpec",
    "convert_to_autoclaude_spec",
]
