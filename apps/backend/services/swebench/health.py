"""
SWE-bench Infrastructure Health Checks
======================================

Health check module for validating infrastructure requirements before running
SWE-bench benchmark evaluations.

This module provides functions to check:
- Docker daemon availability and configuration
- Disk space requirements (minimum 10GB free)
- CPU core count and recommended max_workers
- System architecture detection (x86_64 vs ARM)

Usage:
    from apps.backend.services.swebench.health import check_infrastructure

    # Run all health checks
    status = check_infrastructure()
    if status.all_passed:
        print("Ready to run benchmarks!")
    else:
        for error in status.errors:
            print(f"Error: {error}")
"""

from __future__ import annotations

import logging
import os
import platform
import shutil
from typing import Optional

from .models import HealthCheckResult, InfrastructureStatus

logger = logging.getLogger(__name__)


# Constants
MINIMUM_DISK_SPACE_GB = 10.0
CPU_UTILIZATION_LIMIT = 0.75  # Cap max_workers at 75% of CPU cores
MINIMUM_CPU_CORES = 1


class HealthCheckError(Exception):
    """Raised when a health check encounters an unexpected error."""

    pass


def check_docker_available() -> HealthCheckResult:
    """
    Check if Docker daemon is running and accessible.

    This function verifies that:
    - Docker is installed on the system
    - Docker daemon is running
    - Current user has permission to use Docker

    Returns:
        HealthCheckResult with pass/fail status and details

    Example:
        >>> result = check_docker_available()
        >>> if result.passed:
        ...     print("Docker is ready")
        ... else:
        ...     print(f"Docker issue: {result.message}")
    """
    check_name = "docker_available"

    try:
        import docker
    except ImportError:
        return HealthCheckResult(
            check_name=check_name,
            passed=False,
            message="Docker SDK not installed. Install with: pip install docker",
            details={"error": "import_error", "package": "docker"},
        )

    try:
        # Attempt to connect to Docker daemon
        client = docker.from_env()
        version_info = client.version()

        # Extract relevant version information
        docker_version = version_info.get("Version", "unknown")
        api_version = version_info.get("ApiVersion", "unknown")
        os_type = version_info.get("Os", "unknown")
        arch = version_info.get("Arch", "unknown")

        logger.info(
            f"Docker available: version {docker_version}, "
            f"API {api_version}, {os_type}/{arch}"
        )

        return HealthCheckResult(
            check_name=check_name,
            passed=True,
            message=f"Docker is running (version {docker_version})",
            details={
                "version": docker_version,
                "api_version": api_version,
                "os": os_type,
                "arch": arch,
            },
        )

    except docker.errors.DockerException as e:
        error_msg = str(e)

        # Provide helpful error messages for common issues
        if "Permission denied" in error_msg or "permission denied" in error_msg:
            message = (
                "Docker permission denied. "
                "Add user to docker group or run with sudo."
            )
        elif "Cannot connect" in error_msg or "connection refused" in error_msg.lower():
            message = (
                "Docker is not running. "
                "Please start Docker and try again."
            )
        else:
            message = f"Docker error: {error_msg}"

        logger.warning(f"Docker check failed: {message}")

        return HealthCheckResult(
            check_name=check_name,
            passed=False,
            message=message,
            details={"error": "docker_exception", "raw_error": error_msg},
        )

    except Exception as e:
        logger.error(f"Unexpected error checking Docker: {e}")
        return HealthCheckResult(
            check_name=check_name,
            passed=False,
            message=f"Unexpected error checking Docker: {e}",
            details={"error": "unexpected_error", "raw_error": str(e)},
        )


def check_disk_space(
    path: Optional[str] = None,
    minimum_gb: float = MINIMUM_DISK_SPACE_GB,
) -> HealthCheckResult:
    """
    Check if sufficient disk space is available for benchmark execution.

    Docker images for SWE-bench evaluation can be quite large. This check
    ensures there's enough space for Docker images and container data.

    Args:
        path: Path to check disk space for. Defaults to Docker's data-root
              or the current working directory.
        minimum_gb: Minimum required free space in gigabytes. Defaults to 10GB.

    Returns:
        HealthCheckResult with disk space details

    Example:
        >>> result = check_disk_space(minimum_gb=20.0)
        >>> if not result.passed:
        ...     print(f"Low disk space: {result.message}")
    """
    check_name = "disk_space"

    try:
        # Determine path to check
        if path is None:
            # Try to get Docker's data-root location
            docker_data_root = _get_docker_data_root()
            path = docker_data_root if docker_data_root else os.getcwd()

        # Get disk usage statistics
        disk_usage = shutil.disk_usage(path)

        total_gb = disk_usage.total / (1024 ** 3)
        used_gb = disk_usage.used / (1024 ** 3)
        free_gb = disk_usage.free / (1024 ** 3)
        usage_percent = (disk_usage.used / disk_usage.total) * 100

        details = {
            "path": path,
            "total_gb": round(total_gb, 2),
            "used_gb": round(used_gb, 2),
            "free_gb": round(free_gb, 2),
            "usage_percent": round(usage_percent, 1),
            "minimum_required_gb": minimum_gb,
        }

        if free_gb >= minimum_gb:
            logger.info(
                f"Disk space check passed: {free_gb:.1f}GB free "
                f"(minimum: {minimum_gb}GB)"
            )
            return HealthCheckResult(
                check_name=check_name,
                passed=True,
                message=f"{free_gb:.1f}GB free disk space available",
                details=details,
            )
        else:
            message = (
                f"Insufficient disk space: {free_gb:.1f}GB free, "
                f"minimum {minimum_gb}GB required. "
                "Consider running 'docker system prune' to free space."
            )
            logger.warning(f"Disk space check failed: {message}")
            return HealthCheckResult(
                check_name=check_name,
                passed=False,
                message=message,
                details=details,
            )

    except OSError as e:
        logger.error(f"Error checking disk space: {e}")
        return HealthCheckResult(
            check_name=check_name,
            passed=False,
            message=f"Unable to check disk space: {e}",
            details={"error": "os_error", "raw_error": str(e)},
        )


def _get_docker_data_root() -> Optional[str]:
    """
    Get Docker's data-root directory path.

    Returns:
        Path to Docker's data directory, or None if cannot be determined.
    """
    try:
        import docker

        client = docker.from_env()
        info = client.info()
        return info.get("DockerRootDir")
    except Exception:
        return None


def check_cpu_cores(
    utilization_limit: float = CPU_UTILIZATION_LIMIT,
) -> HealthCheckResult:
    """
    Check CPU core count and calculate recommended max_workers.

    SWE-bench evaluation should not use all available CPU cores to prevent
    system lock-up. This function calculates a safe max_workers value.

    Args:
        utilization_limit: Maximum fraction of CPU cores to use.
                          Defaults to 0.75 (75%).

    Returns:
        HealthCheckResult with CPU information and recommended max_workers

    Example:
        >>> result = check_cpu_cores()
        >>> if result.passed:
        ...     max_workers = result.details["recommended_max_workers"]
        ...     print(f"Use max {max_workers} workers")
    """
    check_name = "cpu_cores"

    try:
        # Get CPU core count
        cpu_count = os.cpu_count()

        if cpu_count is None:
            return HealthCheckResult(
                check_name=check_name,
                passed=False,
                message="Unable to determine CPU core count",
                details={"error": "cpu_count_none"},
            )

        # Calculate recommended max workers (capped at 75% of cores)
        recommended_max_workers = max(
            MINIMUM_CPU_CORES,
            int(cpu_count * utilization_limit),
        )

        # Additional system info
        try:
            load_avg = os.getloadavg() if hasattr(os, "getloadavg") else None
        except OSError:
            load_avg = None

        details = {
            "cpu_count": cpu_count,
            "utilization_limit": utilization_limit,
            "recommended_max_workers": recommended_max_workers,
            "load_average": (
                [round(x, 2) for x in load_avg] if load_avg else None
            ),
        }

        logger.info(
            f"CPU check passed: {cpu_count} cores, "
            f"recommended max_workers: {recommended_max_workers}"
        )

        return HealthCheckResult(
            check_name=check_name,
            passed=True,
            message=(
                f"{cpu_count} CPU cores available, "
                f"recommended max_workers: {recommended_max_workers}"
            ),
            details=details,
        )

    except Exception as e:
        logger.error(f"Error checking CPU cores: {e}")
        return HealthCheckResult(
            check_name=check_name,
            passed=False,
            message=f"Error checking CPU cores: {e}",
            details={"error": "unexpected_error", "raw_error": str(e)},
        )


def check_architecture() -> HealthCheckResult:
    """
    Check system architecture for compatibility with SWE-bench evaluation.

    SWE-bench evaluation works best on x86_64 architecture. ARM systems
    (like Apple M-series Macs) may encounter compatibility issues with
    Docker containers built for x86_64.

    Returns:
        HealthCheckResult with architecture information and warnings

    Note:
        ARM architecture is not a blocking failure - it's a warning.
        Use `namespace=''` flag for ARM compatibility in some cases.
    """
    check_name = "architecture"

    try:
        machine = platform.machine().lower()
        system = platform.system()
        processor = platform.processor()

        # Detect ARM architecture
        is_arm = any(
            arm_id in machine
            for arm_id in ["arm", "aarch64", "arm64"]
        )

        # Detect Apple Silicon specifically
        is_apple_silicon = is_arm and system == "Darwin"

        details = {
            "machine": machine,
            "system": system,
            "processor": processor,
            "is_arm": is_arm,
            "is_apple_silicon": is_apple_silicon,
            "platform": platform.platform(),
        }

        if is_arm:
            if is_apple_silicon:
                message = (
                    "Apple Silicon (ARM) detected. "
                    "Some SWE-bench Docker images may require x86_64 emulation. "
                    "Consider using 'namespace=\"\"' flag for compatibility. "
                    "Performance may be reduced."
                )
            else:
                message = (
                    "ARM architecture detected. "
                    "Some SWE-bench Docker images are built for x86_64 and may "
                    "have compatibility issues. Consider using x86_64 system "
                    "for best results."
                )

            logger.warning(f"Architecture warning: {message}")

            return HealthCheckResult(
                check_name=check_name,
                passed=False,  # Warning state, not blocking
                message=message,
                details=details,
            )

        else:
            logger.info(f"Architecture check passed: {machine} ({system})")
            return HealthCheckResult(
                check_name=check_name,
                passed=True,
                message=f"x86_64 architecture detected ({system})",
                details=details,
            )

    except Exception as e:
        logger.error(f"Error checking architecture: {e}")
        return HealthCheckResult(
            check_name=check_name,
            passed=True,  # Don't block on architecture check errors
            message=f"Unable to determine architecture: {e}",
            details={"error": "unexpected_error", "raw_error": str(e)},
        )


def check_infrastructure(
    disk_path: Optional[str] = None,
    minimum_disk_gb: float = MINIMUM_DISK_SPACE_GB,
    cpu_utilization_limit: float = CPU_UTILIZATION_LIMIT,
) -> InfrastructureStatus:
    """
    Run all infrastructure health checks and return aggregated status.

    This is the main entry point for infrastructure validation before
    running SWE-bench benchmarks.

    Args:
        disk_path: Path to check disk space for. Defaults to Docker's data-root.
        minimum_disk_gb: Minimum required free disk space in GB.
        cpu_utilization_limit: Maximum fraction of CPU cores to use.

    Returns:
        InfrastructureStatus with all health check results

    Example:
        >>> from apps.backend.services.swebench.health import check_infrastructure
        >>> status = check_infrastructure()
        >>> if status.all_passed:
        ...     print("Ready to run SWE-bench evaluation!")
        ... else:
        ...     print("Infrastructure issues detected:")
        ...     for error in status.errors:
        ...         print(f"  - {error}")
        ...     for warning in status.warnings:
        ...         print(f"  [WARNING] {warning}")
    """
    logger.info("Running infrastructure health checks...")

    # Run all checks
    docker_result = check_docker_available()
    disk_result = check_disk_space(path=disk_path, minimum_gb=minimum_disk_gb)
    cpu_result = check_cpu_cores(utilization_limit=cpu_utilization_limit)
    arch_result = check_architecture()

    status = InfrastructureStatus(
        docker_available=docker_result,
        disk_space=disk_result,
        cpu_cores=cpu_result,
        architecture=arch_result,
    )

    # Log summary
    if status.all_passed:
        warnings = status.warnings
        if warnings:
            logger.info(
                f"Infrastructure checks passed with {len(warnings)} warning(s)"
            )
        else:
            logger.info("All infrastructure checks passed")
    else:
        errors = status.errors
        logger.warning(
            f"Infrastructure checks failed: {len(errors)} error(s)"
        )

    return status


def get_recommended_max_workers() -> int:
    """
    Get the recommended maximum number of workers for benchmark execution.

    This is a convenience function that runs the CPU check and returns
    the recommended max_workers value.

    Returns:
        Recommended number of workers (capped at 75% of CPU cores)

    Example:
        >>> workers = get_recommended_max_workers()
        >>> print(f"Running with {workers} workers")
    """
    result = check_cpu_cores()
    if result.passed and "recommended_max_workers" in result.details:
        return result.details["recommended_max_workers"]
    return MINIMUM_CPU_CORES


def get_available_disk_space_gb(path: Optional[str] = None) -> float:
    """
    Get available disk space in gigabytes.

    Args:
        path: Path to check. Defaults to Docker's data-root or cwd.

    Returns:
        Available disk space in GB, or 0.0 if cannot be determined

    Example:
        >>> free_gb = get_available_disk_space_gb()
        >>> print(f"{free_gb:.1f}GB available")
    """
    result = check_disk_space(path=path)
    if result.passed and "free_gb" in result.details:
        return result.details["free_gb"]
    return 0.0
