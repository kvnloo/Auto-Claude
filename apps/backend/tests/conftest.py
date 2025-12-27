"""
Pytest configuration and shared fixtures for backend tests.
"""

import sys
from pathlib import Path

# Add the runners directory to the path for imports
runners_dir = Path(__file__).parent.parent / "runners"
sys.path.insert(0, str(runners_dir))
sys.path.insert(0, str(runners_dir / "github"))
sys.path.insert(0, str(runners_dir / "roadmap"))
sys.path.insert(0, str(runners_dir / "autonomous"))


def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line(
        "markers", "asyncio: mark test as an async test"
    )
