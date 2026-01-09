"""
Token Usage Store
==================

Persistent storage for token usage data with thread-safe and process-safe operations.

The TokenUsageStore persists usage records to JSON files within each spec directory,
enabling per-spec tracking while also supporting project-wide aggregation.

Storage Structure:
    .auto-claude/specs/XXX-feature/usage/
        usage.json - Array of TokenUsageRecord objects

Example Usage:
    from pathlib import Path
    from usage.store import TokenUsageStore
    from usage.models import TokenUsageRecord, AgentType, SessionOutcome

    # Create store for a project
    store = TokenUsageStore(project_dir=Path("/path/to/project"))

    # Record usage
    record = TokenUsageRecord(
        spec_id="025-feature",
        session_id="session-abc123",
        agent_type=AgentType.CODER,
        input_tokens=1500,
        output_tokens=3200,
        thinking_tokens=500,
        cache_hit_tokens=800,
        model_name="claude-sonnet-4-5-20250929",
        outcome=SessionOutcome.SUCCESS,
    )
    store.record_usage(record, spec_dir=Path("/path/to/project/.auto-claude/specs/025-feature"))

    # Query usage
    records = store.get_usage_for_spec("025-feature")
"""

import json
import logging
import os
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from usage.models import AgentType, TokenUsageRecord

logger = logging.getLogger(__name__)

# File locking support (cross-platform)
_IS_WINDOWS = os.name == "nt"

try:
    import fcntl  # type: ignore
except ImportError:
    fcntl = None

try:
    import msvcrt  # type: ignore
except ImportError:
    msvcrt = None


class TokenUsageStoreError(Exception):
    """Base exception for TokenUsageStore errors."""

    pass


class FileLockError(TokenUsageStoreError):
    """Raised when file locking fails."""

    pass


class FileLockTimeout(FileLockError):
    """Raised when file lock acquisition times out."""

    pass


def _acquire_file_lock(fd: int, timeout: float = 5.0) -> None:
    """
    Acquire an exclusive file lock with timeout.

    Args:
        fd: File descriptor to lock
        timeout: Maximum seconds to wait for lock

    Raises:
        FileLockTimeout: If lock cannot be acquired within timeout
    """
    start_time = time.time()

    while True:
        try:
            if _IS_WINDOWS:
                if msvcrt is None:
                    return  # Skip locking if not available
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1024 * 1024)
            else:
                if fcntl is None:
                    return  # Skip locking if not available
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return  # Lock acquired
        except (BlockingIOError, OSError):
            elapsed = time.time() - start_time
            if elapsed >= timeout:
                raise FileLockTimeout(
                    f"Failed to acquire file lock within {timeout}s"
                )
            time.sleep(0.01)


def _release_file_lock(fd: int) -> None:
    """Release file lock."""
    try:
        if _IS_WINDOWS:
            if msvcrt is not None:
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1024 * 1024)
        else:
            if fcntl is not None:
                fcntl.flock(fd, fcntl.LOCK_UN)
    except (OSError, Exception):
        pass  # Best effort cleanup


class TokenUsageStore:
    """
    Persistent storage for token usage data.

    Thread-safe and process-safe storage using file locking.
    Stores usage data per-spec in JSON files, with support for
    project-wide aggregation across all specs.

    Attributes:
        project_dir: Root directory of the project
        lock_timeout: Timeout for acquiring file locks (seconds)
    """

    USAGE_DIR_NAME = "usage"
    USAGE_FILE_NAME = "usage.json"

    def __init__(
        self,
        project_dir: Optional[Path] = None,
        lock_timeout: float = 5.0,
    ):
        """
        Initialize the TokenUsageStore.

        Args:
            project_dir: Root directory of the project. If None, operations
                         requiring project-wide access will raise errors.
            lock_timeout: Timeout for file lock acquisition (default: 5.0s)
        """
        self.project_dir = Path(project_dir) if project_dir else None
        self.lock_timeout = lock_timeout
        self._thread_lock = threading.Lock()

    def _get_usage_dir(self, spec_dir: Path) -> Path:
        """Get the usage directory for a spec, creating it if needed."""
        usage_dir = Path(spec_dir) / self.USAGE_DIR_NAME
        usage_dir.mkdir(parents=True, exist_ok=True)
        return usage_dir

    def _get_usage_file(self, spec_dir: Path) -> Path:
        """Get the path to the usage.json file for a spec."""
        return self._get_usage_dir(spec_dir) / self.USAGE_FILE_NAME

    def _read_usage_file(self, spec_dir: Path) -> list[dict]:
        """
        Read usage records from a spec's usage file.

        Args:
            spec_dir: Path to the spec directory

        Returns:
            List of usage record dictionaries
        """
        usage_file = self._get_usage_file(spec_dir)

        if not usage_file.exists():
            return []

        try:
            with open(usage_file) as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except (OSError, json.JSONDecodeError) as e:
            logger.warning(f"Failed to read usage file {usage_file}: {e}")
            return []

    def _write_usage_file(
        self, spec_dir: Path, records: list[dict], timeout: Optional[float] = None
    ) -> None:
        """
        Write usage records to a spec's usage file with atomic write.

        Uses file locking for cross-process safety and atomic write
        (temp file + rename) for data integrity.

        Args:
            spec_dir: Path to the spec directory
            records: List of usage record dictionaries to write
            timeout: Lock timeout override (default: use instance timeout)
        """
        usage_file = self._get_usage_file(spec_dir)
        timeout = timeout or self.lock_timeout

        # Create parent directory if needed
        usage_file.parent.mkdir(parents=True, exist_ok=True)

        # Create lock file
        lock_file = usage_file.parent / f".{usage_file.name}.lock"

        fd = None
        try:
            # Open/create lock file and acquire lock
            fd = os.open(str(lock_file), os.O_CREAT | os.O_RDWR)
            _acquire_file_lock(fd, timeout)

            # Atomic write using temp file
            tmp_fd, tmp_path = tempfile.mkstemp(
                dir=usage_file.parent,
                prefix=f".{usage_file.name}.tmp.",
                suffix="",
            )

            try:
                with os.fdopen(tmp_fd, "w") as f:
                    json.dump(records, f, indent=2)

                # Atomic replace
                os.replace(tmp_path, usage_file)

            except Exception:
                # Clean up temp file on error
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
                raise

        finally:
            if fd is not None:
                _release_file_lock(fd)
                try:
                    os.close(fd)
                except Exception:
                    pass

    def record_usage(
        self,
        record: TokenUsageRecord,
        spec_dir: Optional[Path] = None,
    ) -> None:
        """
        Record a new token usage entry.

        Appends the record to the spec's usage file with thread-safe
        and process-safe operations.

        Args:
            record: TokenUsageRecord to persist
            spec_dir: Path to the spec directory. If None, will attempt
                      to derive from project_dir and record.spec_id

        Raises:
            TokenUsageStoreError: If spec_dir cannot be determined
        """
        # Determine spec directory
        if spec_dir is None:
            if self.project_dir is None:
                raise TokenUsageStoreError(
                    "spec_dir must be provided or project_dir must be set"
                )
            # Try to find spec dir by spec_id
            spec_dir = self._find_spec_dir(record.spec_id)
            if spec_dir is None:
                raise TokenUsageStoreError(
                    f"Could not find spec directory for spec_id: {record.spec_id}"
                )

        spec_dir = Path(spec_dir)

        with self._thread_lock:
            # Read current records
            records = self._read_usage_file(spec_dir)

            # Add new record
            records.append(record.to_dict())

            # Write back
            self._write_usage_file(spec_dir, records)

        logger.debug(
            f"Recorded usage for spec {record.spec_id}, session {record.session_id}"
        )

    def get_usage_for_spec(
        self,
        spec_id: str,
        spec_dir: Optional[Path] = None,
    ) -> list[TokenUsageRecord]:
        """
        Get all usage records for a specific spec.

        Args:
            spec_id: The spec identifier (e.g., "025-token-usage")
            spec_dir: Path to the spec directory. If None, will search
                      in project_dir.

        Returns:
            List of TokenUsageRecord objects for the spec
        """
        if spec_dir is None:
            spec_dir = self._find_spec_dir(spec_id)
            if spec_dir is None:
                return []

        records_data = self._read_usage_file(spec_dir)

        records = []
        for data in records_data:
            try:
                records.append(TokenUsageRecord.from_dict(data))
            except (KeyError, ValueError) as e:
                logger.warning(f"Failed to parse usage record: {e}")
                continue

        return records

    def get_usage_for_date_range(
        self,
        start_date: datetime,
        end_date: datetime,
        spec_id: Optional[str] = None,
        spec_dir: Optional[Path] = None,
    ) -> list[TokenUsageRecord]:
        """
        Get usage records within a date range.

        Args:
            start_date: Start of date range (inclusive)
            end_date: End of date range (inclusive)
            spec_id: Optional spec ID to filter by. If None and spec_dir is None,
                     searches all specs in project.
            spec_dir: Optional spec directory. If provided, only searches this spec.

        Returns:
            List of TokenUsageRecord objects within the date range
        """
        # Get records based on scope
        if spec_dir is not None:
            all_records = self._read_usage_file(spec_dir)
        elif spec_id is not None:
            spec_dir = self._find_spec_dir(spec_id)
            if spec_dir is None:
                return []
            all_records = self._read_usage_file(spec_dir)
        else:
            # Get all records from all specs
            all_records = self._get_all_records_data()

        # Filter by date range
        filtered_records = []
        for data in all_records:
            try:
                record = TokenUsageRecord.from_dict(data)
                if start_date <= record.timestamp <= end_date:
                    filtered_records.append(record)
            except (KeyError, ValueError) as e:
                logger.warning(f"Failed to parse usage record: {e}")
                continue

        return filtered_records

    def get_usage_by_agent_type(
        self,
        agent_type: AgentType,
        spec_id: Optional[str] = None,
        spec_dir: Optional[Path] = None,
    ) -> list[TokenUsageRecord]:
        """
        Get usage records filtered by agent type.

        Args:
            agent_type: The agent type to filter by
            spec_id: Optional spec ID to filter by. If None and spec_dir is None,
                     searches all specs in project.
            spec_dir: Optional spec directory. If provided, only searches this spec.

        Returns:
            List of TokenUsageRecord objects for the specified agent type
        """
        # Get records based on scope
        if spec_dir is not None:
            all_records = self._read_usage_file(spec_dir)
        elif spec_id is not None:
            spec_dir = self._find_spec_dir(spec_id)
            if spec_dir is None:
                return []
            all_records = self._read_usage_file(spec_dir)
        else:
            # Get all records from all specs
            all_records = self._get_all_records_data()

        # Filter by agent type
        filtered_records = []
        for data in all_records:
            try:
                record = TokenUsageRecord.from_dict(data)
                if record.agent_type == agent_type:
                    filtered_records.append(record)
            except (KeyError, ValueError) as e:
                logger.warning(f"Failed to parse usage record: {e}")
                continue

        return filtered_records

    def get_all_usage_for_project(self) -> list[TokenUsageRecord]:
        """
        Get all usage records across all specs in the project.

        Returns:
            List of all TokenUsageRecord objects in the project,
            sorted by timestamp (oldest first)

        Raises:
            TokenUsageStoreError: If project_dir is not set
        """
        if self.project_dir is None:
            raise TokenUsageStoreError(
                "project_dir must be set to get project-wide usage"
            )

        all_records = self._get_all_records_data()

        records = []
        for data in all_records:
            try:
                records.append(TokenUsageRecord.from_dict(data))
            except (KeyError, ValueError) as e:
                logger.warning(f"Failed to parse usage record: {e}")
                continue

        # Sort by timestamp
        records.sort(key=lambda r: r.timestamp)

        return records

    def get_unique_spec_ids(self) -> list[str]:
        """
        Get list of unique spec IDs that have usage data.

        Returns:
            List of spec IDs with recorded usage data

        Raises:
            TokenUsageStoreError: If project_dir is not set
        """
        if self.project_dir is None:
            raise TokenUsageStoreError(
                "project_dir must be set to get spec IDs"
            )

        specs_dir = self.project_dir / ".auto-claude" / "specs"

        if not specs_dir.exists():
            return []

        spec_ids = []
        for spec_dir in specs_dir.iterdir():
            if spec_dir.is_dir():
                usage_file = spec_dir / self.USAGE_DIR_NAME / self.USAGE_FILE_NAME
                if usage_file.exists():
                    spec_ids.append(spec_dir.name)

        return sorted(spec_ids)

    def _find_spec_dir(self, spec_id: str) -> Optional[Path]:
        """
        Find the spec directory for a given spec ID.

        Args:
            spec_id: The spec identifier

        Returns:
            Path to the spec directory, or None if not found
        """
        if self.project_dir is None:
            return None

        specs_dir = self.project_dir / ".auto-claude" / "specs"

        if not specs_dir.exists():
            return None

        # Direct match
        direct_path = specs_dir / spec_id
        if direct_path.exists():
            return direct_path

        # Search for partial match (e.g., "025" matches "025-token-usage")
        for spec_dir in specs_dir.iterdir():
            if spec_dir.is_dir() and spec_dir.name.startswith(spec_id):
                return spec_dir

        return None

    def _get_all_records_data(self) -> list[dict]:
        """
        Get raw record data from all specs in the project.

        Returns:
            List of all usage record dictionaries
        """
        if self.project_dir is None:
            return []

        specs_dir = self.project_dir / ".auto-claude" / "specs"

        if not specs_dir.exists():
            return []

        all_records: list[dict] = []

        for spec_dir in specs_dir.iterdir():
            if spec_dir.is_dir():
                records = self._read_usage_file(spec_dir)
                all_records.extend(records)

        return all_records

    def delete_usage_for_spec(
        self,
        spec_id: str,
        spec_dir: Optional[Path] = None,
    ) -> bool:
        """
        Delete all usage data for a spec.

        Args:
            spec_id: The spec identifier
            spec_dir: Optional spec directory path

        Returns:
            True if data was deleted, False if no data existed
        """
        if spec_dir is None:
            spec_dir = self._find_spec_dir(spec_id)
            if spec_dir is None:
                return False

        usage_file = self._get_usage_file(spec_dir)

        if not usage_file.exists():
            return False

        with self._thread_lock:
            try:
                usage_file.unlink()
                logger.info(f"Deleted usage data for spec {spec_id}")
                return True
            except OSError as e:
                logger.warning(f"Failed to delete usage file: {e}")
                return False

    def get_usage_count(
        self,
        spec_id: Optional[str] = None,
        spec_dir: Optional[Path] = None,
    ) -> int:
        """
        Get the count of usage records.

        Args:
            spec_id: Optional spec ID to filter by
            spec_dir: Optional spec directory

        Returns:
            Number of usage records
        """
        if spec_dir is not None:
            records = self._read_usage_file(spec_dir)
            return len(records)
        elif spec_id is not None:
            spec_dir = self._find_spec_dir(spec_id)
            if spec_dir is None:
                return 0
            records = self._read_usage_file(spec_dir)
            return len(records)
        else:
            records = self._get_all_records_data()
            return len(records)
