"""
Integration Tests for GHClient Claim Metadata Methods
======================================================

NOTE: Due to package import conflicts in the spec directory (claude_agent_sdk
dependency in spec/__init__.py), the actual integration tests are located at
the worktree root in test_gh_client_claims.py.

To run the tests, use one of these commands from the worktree root:

    # Run the verification test
    python -m pytest test_gh_client_claims.py::test_claim_metadata -v

    # Run all claim-related tests
    python -m pytest test_gh_client_claims.py -v

    # Run with specific test class
    python -m pytest test_gh_client_claims.py::TestClaimMetadataIntegration -v

The tests cover:
- parse_claim_metadata: JSON parsing from HTML comments
- format_claim_comment: Human-readable claim comments with embedded metadata
- format_release_comment: Release comment formatting
- get_claim_status: Issue status with label and comment parsing
- claim_issue: Full claim operation (labels + comments)
- release_issue: Full release operation (labels + comments)
- Error handling for malformed comments, rate limits, API errors
- Unicode and special character handling
- Multiple claim comment ordering

Total: 36 tests covering all claim metadata functionality.
"""

# This file exists to document where the actual tests are located.
# See test_gh_client_claims.py in the worktree root.

import sys
from pathlib import Path

def test_claim_metadata():
    """
    Redirect test to the actual implementation at worktree root.

    This test imports and runs the actual test from test_gh_client_claims.py.
    It exists to satisfy any verification command that expects this file path.
    """
    # Add worktree root to path
    worktree_root = Path(__file__).parent.parent.parent.parent
    if str(worktree_root) not in sys.path:
        sys.path.insert(0, str(worktree_root))

    # Import the actual test module
    import importlib.util
    test_file = worktree_root / "test_gh_client_claims.py"

    if not test_file.exists():
        raise FileNotFoundError(
            f"Test file not found at {test_file}. "
            "Please run tests from worktree root using: "
            "python -m pytest test_gh_client_claims.py::test_claim_metadata -v"
        )

    # Load and execute the test module
    spec = importlib.util.spec_from_file_location("test_gh_client_claims", test_file)
    module = importlib.util.module_from_spec(spec)

    # Execute the actual test
    spec.loader.exec_module(module)
    module.test_claim_metadata()


if __name__ == "__main__":
    # Run directly using pytest from worktree root
    import subprocess
    worktree_root = Path(__file__).parent.parent.parent.parent
    result = subprocess.run(
        ["python", "-m", "pytest", "test_gh_client_claims.py::test_claim_metadata", "-v"],
        cwd=worktree_root,
    )
    sys.exit(result.returncode)
