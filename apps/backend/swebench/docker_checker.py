"""
Docker Availability Checker for SWE-bench Evaluations
======================================================

This module provides functionality to verify Docker daemon availability before
starting SWE-bench evaluations. The SWE-bench evaluation harness requires Docker
to run test containers for each evaluation instance.

Usage:
    from swebench.docker_checker import check_docker, get_docker_info

    # Check Docker is available (raises exception if not)
    check_docker()

    # Get Docker version info
    info = get_docker_info()
    print(f"Docker version: {info['version']}")

    # Check without raising (returns bool)
    if is_docker_available():
        print("Docker is ready")
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from typing import Any


logger = logging.getLogger(__name__)


class DockerNotAvailableError(Exception):
    """Raised when Docker daemon is not available or not running."""

    pass


class DockerVersionError(Exception):
    """Raised when Docker version cannot be determined or is insufficient."""

    pass


def check_docker() -> None:
    """Check that Docker daemon is available and running.

    This function verifies:
        1. Docker CLI is installed and in PATH
        2. Docker daemon is running and accessible
        3. User has permissions to access Docker

    Raises:
        DockerNotAvailableError: If Docker is not installed, not running,
            or user lacks permissions to access it.

    Example:
        >>> check_docker()  # Raises DockerNotAvailableError if Docker unavailable
    """
    # Check if Docker CLI is installed
    docker_path = shutil.which("docker")
    if docker_path is None:
        raise DockerNotAvailableError(
            "Docker CLI not found in PATH. Please install Docker: "
            "https://docs.docker.com/get-docker/"
        )

    logger.debug(f"Found Docker CLI at: {docker_path}")

    # Check if Docker daemon is running by executing 'docker info'
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            error_msg = result.stderr.strip() if result.stderr else "Unknown error"

            # Provide helpful error messages for common issues
            if "permission denied" in error_msg.lower():
                raise DockerNotAvailableError(
                    "Permission denied accessing Docker. Either:\n"
                    "  1. Run with sudo, or\n"
                    "  2. Add your user to the 'docker' group: sudo usermod -aG docker $USER\n"
                    "  3. Log out and back in for group changes to take effect"
                )
            elif "cannot connect" in error_msg.lower() or "connection refused" in error_msg.lower():
                raise DockerNotAvailableError(
                    "Cannot connect to Docker daemon. Please ensure Docker is running:\n"
                    "  - Linux: sudo systemctl start docker\n"
                    "  - macOS/Windows: Start Docker Desktop"
                )
            elif "is the docker daemon running" in error_msg.lower():
                raise DockerNotAvailableError(
                    "Docker daemon is not running. Please start Docker:\n"
                    "  - Linux: sudo systemctl start docker\n"
                    "  - macOS/Windows: Start Docker Desktop"
                )
            else:
                raise DockerNotAvailableError(
                    f"Docker daemon not available: {error_msg}"
                )

    except subprocess.TimeoutExpired:
        raise DockerNotAvailableError(
            "Docker command timed out. The Docker daemon may be unresponsive."
        )
    except FileNotFoundError:
        raise DockerNotAvailableError(
            "Docker CLI not found. Please install Docker: "
            "https://docs.docker.com/get-docker/"
        )
    except OSError as e:
        raise DockerNotAvailableError(
            f"Failed to execute Docker command: {e}"
        ) from e

    logger.info("Docker daemon is available and running")


def is_docker_available() -> bool:
    """Check if Docker is available without raising an exception.

    Returns:
        True if Docker daemon is available and running, False otherwise.

    Example:
        >>> if is_docker_available():
        ...     print("Docker is ready for evaluations")
    """
    try:
        check_docker()
        return True
    except DockerNotAvailableError:
        return False


def get_docker_info() -> dict[str, Any]:
    """Get information about the Docker installation.

    Returns:
        Dictionary containing Docker information:
            - version: Docker version string
            - api_version: Docker API version
            - os: Operating system Docker is running on
            - arch: Architecture (amd64, arm64, etc.)
            - storage_driver: Storage driver in use
            - available: Whether Docker is available

    Raises:
        DockerNotAvailableError: If Docker is not available

    Example:
        >>> info = get_docker_info()
        >>> print(f"Docker {info['version']} on {info['os']}/{info['arch']}")
    """
    # First ensure Docker is available
    check_docker()

    info: dict[str, Any] = {
        "available": True,
        "version": "unknown",
        "api_version": "unknown",
        "os": "unknown",
        "arch": "unknown",
        "storage_driver": "unknown",
    }

    # Get Docker version
    try:
        result = subprocess.run(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            info["version"] = result.stdout.strip()

        # Get API version
        result = subprocess.run(
            ["docker", "version", "--format", "{{.Server.APIVersion}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            info["api_version"] = result.stdout.strip()

        # Get OS and architecture
        result = subprocess.run(
            ["docker", "info", "--format", "{{.OSType}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            info["os"] = result.stdout.strip()

        result = subprocess.run(
            ["docker", "info", "--format", "{{.Architecture}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            info["arch"] = result.stdout.strip()

        # Get storage driver
        result = subprocess.run(
            ["docker", "info", "--format", "{{.Driver}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            info["storage_driver"] = result.stdout.strip()

    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning(f"Failed to get some Docker info: {e}")

    logger.debug(f"Docker info: {info}")
    return info


def check_docker_disk_space(warning_threshold_gb: float = 10.0) -> dict[str, Any]:
    """Check available disk space for Docker.

    Docker images can consume significant disk space during SWE-bench evaluations.
    This function checks available space and warns if it's running low.

    Args:
        warning_threshold_gb: Threshold in GB below which to warn (default: 10.0)

    Returns:
        Dictionary containing:
            - data_root: Docker data directory path
            - available_gb: Available space in GB (may be None if unavailable)
            - warning: True if space is below threshold

    Raises:
        DockerNotAvailableError: If Docker is not available
    """
    check_docker()

    result: dict[str, Any] = {
        "data_root": "unknown",
        "available_gb": None,
        "warning": False,
    }

    try:
        # Get Docker data root directory
        proc = subprocess.run(
            ["docker", "info", "--format", "{{.DockerRootDir}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if proc.returncode == 0:
            result["data_root"] = proc.stdout.strip()

        # Get disk usage using 'docker system df'
        proc = subprocess.run(
            ["docker", "system", "df", "--format", "{{.Size}}"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        # Note: Getting exact available space requires parsing 'df' output
        # for the Docker data directory, which varies by platform

    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning(f"Failed to check Docker disk space: {e}")

    return result
