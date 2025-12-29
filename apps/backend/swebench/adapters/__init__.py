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
from swebench.adapters.results_adapter import (
    convert_results_batch,
    convert_to_swebench_prediction,
    export_predictions_to_jsonl,
    load_predictions_from_jsonl,
    validate_jsonl_file,
)

__all__ = [
    # Instance adapter
    "AutoClaudeSpec",
    "convert_to_autoclaude_spec",
    # Results adapter
    "convert_to_swebench_prediction",
    "convert_results_batch",
    "export_predictions_to_jsonl",
    "load_predictions_from_jsonl",
    "validate_jsonl_file",
]
