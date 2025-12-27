"""
Roadmap Feature Fetcher for Autonomous Mode
=============================================

Fetches roadmap features with status='planned' for autonomous task execution.
Reads from the roadmap.json file in the project's .auto-claude/roadmap/ directory.

Supports:
- Filtering features by status ('planned', 'in_progress', 'done', 'under_review')
- Extracting priority scoring inputs (complexity, impact, dependencies)
- Updating feature status with atomic file writes
- Graceful handling of missing roadmap.json

Usage:
    from runners.roadmap.feature_fetcher import FeatureFetcher

    # Initialize with project directory
    fetcher = FeatureFetcher(project_dir=Path("/path/to/project"))

    # Fetch all planned features
    features = fetcher.fetch_planned_features()

    # Update feature status
    fetcher.update_feature_status(feature_id="feature-1", status="in_progress")
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

# Configure logger
logger = logging.getLogger(__name__)


class FeatureStatus(str, Enum):
    """Valid status values for roadmap features."""

    UNDER_REVIEW = "under_review"
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class FeaturePriority(str, Enum):
    """Valid priority values for roadmap features (MoSCoW method)."""

    MUST = "must"
    SHOULD = "should"
    COULD = "could"
    WONT = "wont"


class FeatureComplexity(str, Enum):
    """Valid complexity values for roadmap features."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class FeatureImpact(str, Enum):
    """Valid impact values for roadmap features."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class FeatureFetchError(Exception):
    """Raised when feature fetching fails."""

    pass


class FeatureUpdateError(Exception):
    """Raised when feature status update fails."""

    pass


@dataclass
class RoadmapFeature:
    """
    Represents a roadmap feature for autonomous processing.

    Matches the TypeScript RoadmapFeature interface from
    apps/frontend/src/shared/types/roadmap.ts.

    Attributes:
        id: Unique feature identifier
        title: Feature title
        description: Feature description
        rationale: Why this feature is needed
        priority: MoSCoW priority (must, should, could, wont)
        complexity: Implementation complexity (low, medium, high)
        impact: Expected impact (low, medium, high)
        phase_id: ID of the phase this feature belongs to
        dependencies: List of feature IDs this depends on
        status: Current status (under_review, planned, in_progress, done)
        acceptance_criteria: List of acceptance criteria
        user_stories: List of user stories
        linked_spec_id: ID of linked specification (if any)
        external_id: ID from external system (e.g., GitHub issue number)
        external_url: URL back to external system
        votes: Vote count from external system
    """

    id: str
    title: str
    description: str
    rationale: str = ""
    priority: str = "should"  # must, should, could, wont
    complexity: str = "medium"  # low, medium, high
    impact: str = "medium"  # low, medium, high
    phase_id: str = ""
    dependencies: list[str] = field(default_factory=list)
    status: str = "planned"  # under_review, planned, in_progress, done
    acceptance_criteria: list[str] = field(default_factory=list)
    user_stories: list[str] = field(default_factory=list)
    linked_spec_id: str | None = None
    external_id: str | None = None
    external_url: str | None = None
    votes: int | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RoadmapFeature:
        """
        Create RoadmapFeature from roadmap.json data.

        Args:
            data: Dictionary from roadmap.json features array

        Returns:
            RoadmapFeature instance
        """
        return cls(
            id=data.get("id", ""),
            title=data.get("title", ""),
            description=data.get("description", ""),
            rationale=data.get("rationale", ""),
            priority=data.get("priority", "should"),
            complexity=data.get("complexity", "medium"),
            impact=data.get("impact", "medium"),
            phase_id=data.get("phaseId", ""),
            dependencies=data.get("dependencies", []),
            status=data.get("status", "planned"),
            acceptance_criteria=data.get("acceptanceCriteria", []),
            user_stories=data.get("userStories", []),
            linked_spec_id=data.get("linkedSpecId"),
            external_id=data.get("externalId"),
            external_url=data.get("externalUrl"),
            votes=data.get("votes"),
        )

    def to_dict(self) -> dict[str, Any]:
        """
        Convert to dictionary for serialization.

        Returns:
            Dictionary matching roadmap.json feature format
        """
        result = {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "rationale": self.rationale,
            "priority": self.priority,
            "complexity": self.complexity,
            "impact": self.impact,
            "phaseId": self.phase_id,
            "dependencies": self.dependencies,
            "status": self.status,
            "acceptanceCriteria": self.acceptance_criteria,
            "userStories": self.user_stories,
        }

        # Only include optional fields if they have values
        if self.linked_spec_id is not None:
            result["linkedSpecId"] = self.linked_spec_id
        if self.external_id is not None:
            result["externalId"] = self.external_id
        if self.external_url is not None:
            result["externalUrl"] = self.external_url
        if self.votes is not None:
            result["votes"] = self.votes

        return result

    def get_priority_score_inputs(self) -> dict[str, Any]:
        """
        Extract priority scoring inputs for task prioritization.

        Returns:
            Dictionary with complexity, impact, priority, and dependencies
        """
        return {
            "complexity": self.complexity,
            "impact": self.impact,
            "priority": self.priority,
            "dependencies": self.dependencies,
            "has_external_source": self.external_id is not None,
            "votes": self.votes or 0,
        }


class FeatureFetcher:
    """
    Fetches roadmap features for autonomous task processing.

    Reads from the roadmap.json file and provides filtering and update capabilities.

    Usage:
        fetcher = FeatureFetcher(project_dir=Path("/path/to/project"))

        # Get all planned features
        features = fetcher.fetch_planned_features()

        # Update feature status
        fetcher.update_feature_status(feature_id="feature-1", status="in_progress")
    """

    # Default roadmap file location relative to project directory
    DEFAULT_ROADMAP_PATH = ".auto-claude/roadmap/roadmap.json"

    def __init__(
        self,
        project_dir: Path,
        roadmap_path: str | Path | None = None,
    ):
        """
        Initialize FeatureFetcher.

        Args:
            project_dir: Project directory path
            roadmap_path: Optional custom path to roadmap.json (relative to project_dir)
        """
        self.project_dir = Path(project_dir)
        if roadmap_path:
            self.roadmap_path = self.project_dir / Path(roadmap_path)
        else:
            self.roadmap_path = self.project_dir / self.DEFAULT_ROADMAP_PATH

    def _load_roadmap(self) -> dict[str, Any]:
        """
        Load roadmap.json file.

        Returns:
            Roadmap data dictionary

        Raises:
            FeatureFetchError: If roadmap cannot be loaded
        """
        if not self.roadmap_path.exists():
            logger.warning(f"Roadmap file not found: {self.roadmap_path}")
            return {"features": [], "phases": []}

        try:
            with open(self.roadmap_path, encoding="utf-8") as f:
                data = json.load(f)
            logger.debug(f"Loaded roadmap from: {self.roadmap_path}")
            return data
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in roadmap file: {e}")
            raise FeatureFetchError(f"Invalid JSON in roadmap file: {e}") from e
        except OSError as e:
            logger.error(f"Error reading roadmap file: {e}")
            raise FeatureFetchError(f"Error reading roadmap file: {e}") from e

    def _save_roadmap(self, roadmap: dict[str, Any]) -> None:
        """
        Save roadmap.json file atomically.

        Args:
            roadmap: Roadmap data dictionary

        Raises:
            FeatureUpdateError: If roadmap cannot be saved
        """
        try:
            # Update timestamp
            roadmap["updatedAt"] = datetime.utcnow().isoformat()

            # Ensure directory exists
            self.roadmap_path.parent.mkdir(parents=True, exist_ok=True)

            # Write to temp file first, then atomic rename
            temp_path = self.roadmap_path.with_suffix(".json.tmp")
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(roadmap, f, indent=2, ensure_ascii=False)

            # Atomic rename
            temp_path.replace(self.roadmap_path)
            logger.debug(f"Saved roadmap to: {self.roadmap_path}")

        except OSError as e:
            logger.error(f"Error saving roadmap file: {e}")
            raise FeatureUpdateError(f"Error saving roadmap file: {e}") from e

    def fetch_planned_features(self) -> list[RoadmapFeature]:
        """
        Fetch all features with status='planned'.

        Returns:
            List of RoadmapFeature objects with status='planned'
        """
        return self.fetch_features_by_status(FeatureStatus.PLANNED)

    def fetch_features_by_status(
        self,
        status: FeatureStatus | str,
    ) -> list[RoadmapFeature]:
        """
        Fetch all features with a specific status.

        Args:
            status: Feature status to filter by

        Returns:
            List of RoadmapFeature objects matching the status
        """
        status_value = status.value if isinstance(status, FeatureStatus) else status

        try:
            roadmap = self._load_roadmap()
            features_data = roadmap.get("features", [])

            features = [
                RoadmapFeature.from_dict(data)
                for data in features_data
                if data.get("status") == status_value
            ]

            logger.info(
                f"Fetched {len(features)} features with status='{status_value}'"
            )
            return features

        except FeatureFetchError:
            # Re-raise fetch errors
            raise
        except Exception as e:
            logger.error(f"Unexpected error fetching features: {e}")
            raise FeatureFetchError(f"Unexpected error fetching features: {e}") from e

    def fetch_all_features(self) -> list[RoadmapFeature]:
        """
        Fetch all features from the roadmap.

        Returns:
            List of all RoadmapFeature objects
        """
        try:
            roadmap = self._load_roadmap()
            features_data = roadmap.get("features", [])

            features = [RoadmapFeature.from_dict(data) for data in features_data]

            logger.info(f"Fetched {len(features)} total features")
            return features

        except FeatureFetchError:
            raise
        except Exception as e:
            logger.error(f"Unexpected error fetching features: {e}")
            raise FeatureFetchError(f"Unexpected error fetching features: {e}") from e

    def fetch_feature(self, feature_id: str) -> RoadmapFeature | None:
        """
        Fetch a specific feature by ID.

        Args:
            feature_id: The feature ID to fetch

        Returns:
            RoadmapFeature object or None if not found
        """
        try:
            roadmap = self._load_roadmap()
            features_data = roadmap.get("features", [])

            for data in features_data:
                if data.get("id") == feature_id:
                    return RoadmapFeature.from_dict(data)

            logger.debug(f"Feature not found: {feature_id}")
            return None

        except FeatureFetchError:
            raise
        except Exception as e:
            logger.error(f"Unexpected error fetching feature: {e}")
            raise FeatureFetchError(f"Unexpected error fetching feature: {e}") from e

    def update_feature_status(
        self,
        feature_id: str,
        status: FeatureStatus | str,
        linked_spec_id: str | None = None,
    ) -> bool:
        """
        Update the status of a feature and save to roadmap.json.

        Args:
            feature_id: The feature ID to update
            status: New status value
            linked_spec_id: Optional spec ID to link to the feature

        Returns:
            True if update was successful, False if feature not found

        Raises:
            FeatureUpdateError: If update fails
        """
        status_value = status.value if isinstance(status, FeatureStatus) else status

        # Validate status value
        valid_statuses = {s.value for s in FeatureStatus}
        if status_value not in valid_statuses:
            raise FeatureUpdateError(
                f"Invalid status '{status_value}'. "
                f"Must be one of: {', '.join(valid_statuses)}"
            )

        try:
            roadmap = self._load_roadmap()
            features_data = roadmap.get("features", [])

            # Find and update the feature
            feature_found = False
            for feature in features_data:
                if feature.get("id") == feature_id:
                    old_status = feature.get("status")
                    feature["status"] = status_value

                    if linked_spec_id is not None:
                        feature["linkedSpecId"] = linked_spec_id

                    feature_found = True
                    logger.info(
                        f"Updated feature '{feature_id}' status: "
                        f"'{old_status}' -> '{status_value}'"
                    )
                    break

            if not feature_found:
                logger.warning(f"Feature not found for update: {feature_id}")
                return False

            # Save updated roadmap
            self._save_roadmap(roadmap)
            return True

        except FeatureUpdateError:
            raise
        except FeatureFetchError:
            raise FeatureUpdateError(
                f"Cannot update feature: roadmap load failed"
            ) from None
        except Exception as e:
            logger.error(f"Unexpected error updating feature: {e}")
            raise FeatureUpdateError(
                f"Unexpected error updating feature: {e}"
            ) from e

    def mark_in_progress(
        self,
        feature_id: str,
        linked_spec_id: str | None = None,
    ) -> bool:
        """
        Mark a feature as in-progress.

        Args:
            feature_id: The feature ID to update
            linked_spec_id: Optional spec ID to link

        Returns:
            True if update was successful
        """
        logger.info(f"Marking feature '{feature_id}' as in-progress")
        return self.update_feature_status(
            feature_id=feature_id,
            status=FeatureStatus.IN_PROGRESS,
            linked_spec_id=linked_spec_id,
        )

    def mark_done(
        self,
        feature_id: str,
        linked_spec_id: str | None = None,
    ) -> bool:
        """
        Mark a feature as done.

        Args:
            feature_id: The feature ID to update
            linked_spec_id: Optional spec ID to link

        Returns:
            True if update was successful
        """
        logger.info(f"Marking feature '{feature_id}' as done")
        return self.update_feature_status(
            feature_id=feature_id,
            status=FeatureStatus.DONE,
            linked_spec_id=linked_spec_id,
        )

    def mark_under_review(self, feature_id: str) -> bool:
        """
        Mark a feature as under review (e.g., after failure).

        Args:
            feature_id: The feature ID to update

        Returns:
            True if update was successful
        """
        logger.info(f"Marking feature '{feature_id}' as under review")
        return self.update_feature_status(
            feature_id=feature_id,
            status=FeatureStatus.UNDER_REVIEW,
        )

    def roadmap_exists(self) -> bool:
        """
        Check if roadmap.json exists.

        Returns:
            True if roadmap file exists
        """
        return self.roadmap_path.exists()

    def get_features_with_dependencies_met(
        self,
        completed_feature_ids: set[str] | None = None,
    ) -> list[RoadmapFeature]:
        """
        Get planned features whose dependencies are all met.

        Args:
            completed_feature_ids: Set of completed feature IDs.
                If None, fetches from roadmap (status='done')

        Returns:
            List of planned features with all dependencies satisfied
        """
        if completed_feature_ids is None:
            done_features = self.fetch_features_by_status(FeatureStatus.DONE)
            completed_feature_ids = {f.id for f in done_features}

        planned_features = self.fetch_planned_features()

        # Filter to features with all dependencies met
        ready_features = []
        for feature in planned_features:
            if not feature.dependencies:
                # No dependencies, always ready
                ready_features.append(feature)
            elif all(dep in completed_feature_ids for dep in feature.dependencies):
                # All dependencies are completed
                ready_features.append(feature)

        logger.info(
            f"Found {len(ready_features)} planned features with dependencies met"
        )
        return ready_features


# Convenience functions for quick access
def fetch_planned_features(
    project_dir: Path | str,
) -> list[dict[str, Any]]:
    """
    Convenience function to fetch planned features without instantiating FeatureFetcher.

    Args:
        project_dir: Project directory path

    Returns:
        List of feature dictionaries
    """
    fetcher = FeatureFetcher(project_dir=Path(project_dir))
    features = fetcher.fetch_planned_features()
    return [feature.to_dict() for feature in features]


def update_feature_status(
    project_dir: Path | str,
    feature_id: str,
    status: str,
    linked_spec_id: str | None = None,
) -> bool:
    """
    Convenience function to update feature status.

    Args:
        project_dir: Project directory path
        feature_id: The feature ID to update
        status: New status value
        linked_spec_id: Optional spec ID to link

    Returns:
        True if update was successful
    """
    fetcher = FeatureFetcher(project_dir=Path(project_dir))
    return fetcher.update_feature_status(
        feature_id=feature_id,
        status=status,
        linked_spec_id=linked_spec_id,
    )


# For testing and CLI usage
if __name__ == "__main__":
    import sys

    def main():
        """Test feature fetching."""
        project_dir = Path.cwd()
        print(f"Testing FeatureFetcher in: {project_dir}")
        print("=" * 60)

        fetcher = FeatureFetcher(project_dir=project_dir)

        # Check if roadmap exists
        print(f"\n1. Checking roadmap file...")
        if fetcher.roadmap_exists():
            print(f"   Roadmap found: {fetcher.roadmap_path}")
        else:
            print(f"   Roadmap not found: {fetcher.roadmap_path}")
            print("   (This is expected if no roadmap has been generated)")

        # Fetch all features
        print("\n2. Fetching all features...")
        try:
            all_features = fetcher.fetch_all_features()
            print(f"   Found {len(all_features)} total features")
        except FeatureFetchError as e:
            print(f"   Error: {e}")
            all_features = []

        # Fetch planned features
        print("\n3. Fetching planned features...")
        try:
            planned = fetcher.fetch_planned_features()
            print(f"   Found {len(planned)} planned features:")
            for feature in planned[:5]:  # Show first 5
                deps = f" (deps: {', '.join(feature.dependencies)})" if feature.dependencies else ""
                print(f"   - {feature.id}: {feature.title[:40]}...{deps}")
                print(f"     Priority: {feature.priority}, Complexity: {feature.complexity}, Impact: {feature.impact}")
            if len(planned) > 5:
                print(f"   ... and {len(planned) - 5} more")
        except FeatureFetchError as e:
            print(f"   Error: {e}")

        # Show features with dependencies met
        print("\n4. Features with dependencies met...")
        try:
            ready = fetcher.get_features_with_dependencies_met()
            print(f"   Found {len(ready)} ready features (no unmet dependencies)")
        except FeatureFetchError as e:
            print(f"   Error: {e}")

        print("\nDone!")

    main()
