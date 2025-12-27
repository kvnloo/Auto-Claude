"""
Tests for Roadmap Feature Fetcher for Autonomous Mode
======================================================

Tests the FeatureFetcher class with mocked roadmap.json file operations.
Covers:
- Fetching features with status='planned'
- Filtering by various statuses
- Updating feature status with atomic writes
- Dependency resolution
- Error handling (missing files, invalid JSON, update failures)
- Priority score input extraction

Uses pytest fixtures and tmp_path for isolated test directories.
"""

from __future__ import annotations

import json
import pytest
from pathlib import Path
from unittest.mock import patch

# Import the modules to test
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "runners" / "roadmap"))

from feature_fetcher import (
    FeatureFetcher,
    RoadmapFeature,
    FeatureStatus,
    FeaturePriority,
    FeatureComplexity,
    FeatureImpact,
    FeatureFetchError,
    FeatureUpdateError,
    fetch_planned_features,
    update_feature_status,
)


# =============================================================================
# Test Fixtures
# =============================================================================

@pytest.fixture
def tmp_project_dir(tmp_path: Path) -> Path:
    """Create a temporary project directory with .auto-claude structure."""
    roadmap_dir = tmp_path / ".auto-claude" / "roadmap"
    roadmap_dir.mkdir(parents=True)
    return tmp_path


@pytest.fixture
def sample_roadmap_data() -> dict:
    """Sample roadmap data for testing."""
    return {
        "features": [
            {
                "id": "feature-1",
                "title": "Implement user authentication",
                "description": "Add OAuth2 login support",
                "rationale": "Users need secure access",
                "priority": "must",
                "complexity": "high",
                "impact": "high",
                "phaseId": "phase-1",
                "dependencies": [],
                "status": "planned",
                "acceptanceCriteria": ["OAuth2 flow works", "Tokens refresh"],
                "userStories": ["As a user, I want to log in securely"],
            },
            {
                "id": "feature-2",
                "title": "Add dark mode",
                "description": "Theme switching support",
                "rationale": "User preference",
                "priority": "should",
                "complexity": "medium",
                "impact": "medium",
                "phaseId": "phase-2",
                "dependencies": ["feature-1"],
                "status": "planned",
                "acceptanceCriteria": ["Toggle works", "Preference saved"],
                "userStories": [],
            },
            {
                "id": "feature-3",
                "title": "Dashboard redesign",
                "description": "New dashboard layout",
                "rationale": "Improve UX",
                "priority": "could",
                "complexity": "low",
                "impact": "medium",
                "phaseId": "phase-2",
                "dependencies": [],
                "status": "in_progress",
                "acceptanceCriteria": ["New layout implemented"],
                "userStories": [],
                "linkedSpecId": "spec-001",
            },
            {
                "id": "feature-4",
                "title": "API documentation",
                "description": "Generate OpenAPI docs",
                "rationale": "Developer experience",
                "priority": "should",
                "complexity": "low",
                "impact": "low",
                "phaseId": "phase-3",
                "dependencies": ["feature-1", "feature-3"],
                "status": "done",
                "acceptanceCriteria": ["Swagger UI available"],
                "userStories": [],
                "externalId": "123",
                "externalUrl": "https://github.com/org/repo/issues/123",
                "votes": 42,
            },
        ],
        "phases": [
            {"id": "phase-1", "name": "Foundation"},
            {"id": "phase-2", "name": "Features"},
            {"id": "phase-3", "name": "Documentation"},
        ],
        "updatedAt": "2025-12-26T10:00:00Z",
    }


@pytest.fixture
def create_roadmap(tmp_project_dir, sample_roadmap_data):
    """Factory to create roadmap.json file with custom data."""
    def _create(data: dict | None = None) -> Path:
        roadmap_path = tmp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        roadmap_path.parent.mkdir(parents=True, exist_ok=True)

        content = data if data is not None else sample_roadmap_data
        with open(roadmap_path, "w", encoding="utf-8") as f:
            json.dump(content, f, indent=2)

        return roadmap_path

    return _create


# =============================================================================
# RoadmapFeature Dataclass Tests
# =============================================================================

class TestRoadmapFeature:
    """Tests for the RoadmapFeature dataclass."""

    def test_from_dict_full(self, sample_roadmap_data):
        """Test creating RoadmapFeature from dict with all fields."""
        feature_data = sample_roadmap_data["features"][0]
        feature = RoadmapFeature.from_dict(feature_data)

        assert feature.id == "feature-1"
        assert feature.title == "Implement user authentication"
        assert feature.description == "Add OAuth2 login support"
        assert feature.rationale == "Users need secure access"
        assert feature.priority == "must"
        assert feature.complexity == "high"
        assert feature.impact == "high"
        assert feature.phase_id == "phase-1"
        assert feature.dependencies == []
        assert feature.status == "planned"
        assert len(feature.acceptance_criteria) == 2
        assert len(feature.user_stories) == 1

    def test_from_dict_with_optional_fields(self, sample_roadmap_data):
        """Test creating RoadmapFeature with optional fields."""
        feature_data = sample_roadmap_data["features"][3]  # Has external fields
        feature = RoadmapFeature.from_dict(feature_data)

        assert feature.external_id == "123"
        assert feature.external_url == "https://github.com/org/repo/issues/123"
        assert feature.votes == 42
        assert feature.linked_spec_id is None  # Not in this feature

    def test_from_dict_minimal(self):
        """Test creating RoadmapFeature with minimal fields."""
        data = {"id": "minimal", "title": "Minimal feature"}
        feature = RoadmapFeature.from_dict(data)

        assert feature.id == "minimal"
        assert feature.title == "Minimal feature"
        assert feature.description == ""
        assert feature.priority == "should"  # Default
        assert feature.complexity == "medium"  # Default
        assert feature.status == "planned"  # Default
        assert feature.dependencies == []

    def test_to_dict(self, sample_roadmap_data):
        """Test converting RoadmapFeature to dict."""
        feature_data = sample_roadmap_data["features"][0]
        feature = RoadmapFeature.from_dict(feature_data)
        result = feature.to_dict()

        assert result["id"] == "feature-1"
        assert result["title"] == "Implement user authentication"
        assert result["phaseId"] == "phase-1"  # Uses camelCase
        assert result["acceptanceCriteria"] == ["OAuth2 flow works", "Tokens refresh"]
        assert "linkedSpecId" not in result  # Not included when None

    def test_to_dict_with_optional_fields(self, sample_roadmap_data):
        """Test to_dict includes optional fields when present."""
        feature_data = sample_roadmap_data["features"][3]
        feature = RoadmapFeature.from_dict(feature_data)
        result = feature.to_dict()

        assert result["externalId"] == "123"
        assert result["externalUrl"] == "https://github.com/org/repo/issues/123"
        assert result["votes"] == 42

    def test_get_priority_score_inputs(self, sample_roadmap_data):
        """Test extracting priority score inputs."""
        feature_data = sample_roadmap_data["features"][0]
        feature = RoadmapFeature.from_dict(feature_data)
        inputs = feature.get_priority_score_inputs()

        assert inputs["complexity"] == "high"
        assert inputs["impact"] == "high"
        assert inputs["priority"] == "must"
        assert inputs["dependencies"] == []
        assert inputs["has_external_source"] is False
        assert inputs["votes"] == 0

    def test_get_priority_score_inputs_with_external(self, sample_roadmap_data):
        """Test priority inputs include external source info."""
        feature_data = sample_roadmap_data["features"][3]
        feature = RoadmapFeature.from_dict(feature_data)
        inputs = feature.get_priority_score_inputs()

        assert inputs["has_external_source"] is True
        assert inputs["votes"] == 42


# =============================================================================
# FeatureFetcher Tests - Fetch Operations
# =============================================================================

class TestFeatureFetcherFetch:
    """Tests for FeatureFetcher fetch operations."""

    def test_fetch_planned_features(self, tmp_project_dir, create_roadmap):
        """Test fetching features with status='planned'."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        features = fetcher.fetch_planned_features()

        assert len(features) == 2
        assert all(f.status == "planned" for f in features)
        assert features[0].id == "feature-1"
        assert features[1].id == "feature-2"

    def test_fetch_features_by_status_in_progress(
        self, tmp_project_dir, create_roadmap
    ):
        """Test fetching features with status='in_progress'."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        features = fetcher.fetch_features_by_status(FeatureStatus.IN_PROGRESS)

        assert len(features) == 1
        assert features[0].id == "feature-3"
        assert features[0].linked_spec_id == "spec-001"

    def test_fetch_features_by_status_done(self, tmp_project_dir, create_roadmap):
        """Test fetching features with status='done'."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        features = fetcher.fetch_features_by_status("done")  # String version

        assert len(features) == 1
        assert features[0].id == "feature-4"

    def test_fetch_all_features(self, tmp_project_dir, create_roadmap):
        """Test fetching all features regardless of status."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        features = fetcher.fetch_all_features()

        assert len(features) == 4

    def test_fetch_feature_by_id(self, tmp_project_dir, create_roadmap):
        """Test fetching a specific feature by ID."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        feature = fetcher.fetch_feature("feature-2")

        assert feature is not None
        assert feature.title == "Add dark mode"
        assert feature.dependencies == ["feature-1"]

    def test_fetch_feature_not_found(self, tmp_project_dir, create_roadmap):
        """Test fetching a non-existent feature."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        feature = fetcher.fetch_feature("nonexistent")

        assert feature is None

    def test_fetch_features_empty_roadmap(self, tmp_project_dir, create_roadmap):
        """Test fetching from roadmap with no features."""
        create_roadmap({"features": [], "phases": []})
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        features = fetcher.fetch_planned_features()

        assert len(features) == 0


# =============================================================================
# FeatureFetcher Tests - Missing/Invalid Files
# =============================================================================

class TestFeatureFetcherMissingFiles:
    """Tests for FeatureFetcher handling of missing/invalid files."""

    def test_fetch_missing_roadmap(self, tmp_project_dir):
        """Test fetching when roadmap.json doesn't exist."""
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        # Should return empty list, not raise error
        features = fetcher.fetch_planned_features()

        assert len(features) == 0

    def test_roadmap_exists_true(self, tmp_project_dir, create_roadmap):
        """Test roadmap_exists returns True when file exists."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        assert fetcher.roadmap_exists() is True

    def test_roadmap_exists_false(self, tmp_project_dir):
        """Test roadmap_exists returns False when file missing."""
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        assert fetcher.roadmap_exists() is False

    def test_fetch_invalid_json(self, tmp_project_dir):
        """Test fetching when roadmap.json has invalid JSON."""
        roadmap_path = tmp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        roadmap_path.parent.mkdir(parents=True, exist_ok=True)
        roadmap_path.write_text("{ invalid json }", encoding="utf-8")

        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        with pytest.raises(FeatureFetchError) as exc_info:
            fetcher.fetch_planned_features()

        assert "Invalid JSON" in str(exc_info.value)

    def test_fetch_permission_error(self, tmp_project_dir, create_roadmap):
        """Test fetching when roadmap.json is not readable."""
        roadmap_path = create_roadmap()

        # Make file unreadable (skip on Windows)
        try:
            roadmap_path.chmod(0o000)
        except OSError:
            pytest.skip("Cannot change file permissions on this platform")

        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        try:
            with pytest.raises(FeatureFetchError) as exc_info:
                fetcher.fetch_planned_features()
            assert "Error reading" in str(exc_info.value)
        finally:
            # Restore permissions for cleanup
            roadmap_path.chmod(0o644)


# =============================================================================
# FeatureFetcher Tests - Update Operations
# =============================================================================

class TestFeatureFetcherUpdate:
    """Tests for FeatureFetcher update operations."""

    def test_update_feature_status(self, tmp_project_dir, create_roadmap):
        """Test updating a feature's status."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        result = fetcher.update_feature_status("feature-1", FeatureStatus.IN_PROGRESS)

        assert result is True

        # Verify the change persisted
        feature = fetcher.fetch_feature("feature-1")
        assert feature.status == "in_progress"

    def test_update_feature_status_with_linked_spec(
        self, tmp_project_dir, create_roadmap
    ):
        """Test updating status with linked spec ID."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        result = fetcher.update_feature_status(
            "feature-1",
            FeatureStatus.IN_PROGRESS,
            linked_spec_id="spec-123",
        )

        assert result is True

        feature = fetcher.fetch_feature("feature-1")
        assert feature.linked_spec_id == "spec-123"

    def test_update_feature_not_found(self, tmp_project_dir, create_roadmap):
        """Test updating a non-existent feature returns False."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        result = fetcher.update_feature_status("nonexistent", "in_progress")

        assert result is False

    def test_update_feature_invalid_status(self, tmp_project_dir, create_roadmap):
        """Test updating with invalid status raises error."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        with pytest.raises(FeatureUpdateError) as exc_info:
            fetcher.update_feature_status("feature-1", "invalid_status")

        assert "Invalid status" in str(exc_info.value)

    def test_update_preserves_other_features(self, tmp_project_dir, create_roadmap):
        """Test that updating one feature doesn't affect others."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        # Update one feature
        fetcher.update_feature_status("feature-1", "in_progress")

        # Verify other features unchanged
        feature2 = fetcher.fetch_feature("feature-2")
        assert feature2.status == "planned"

        feature3 = fetcher.fetch_feature("feature-3")
        assert feature3.status == "in_progress"

    def test_update_atomic_write(self, tmp_project_dir, create_roadmap):
        """Test that updates are atomic (temp file approach)."""
        roadmap_path = create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        # Do an update
        fetcher.update_feature_status("feature-1", "in_progress")

        # Verify the file exists and is valid JSON
        with open(roadmap_path, encoding="utf-8") as f:
            data = json.load(f)

        assert "updatedAt" in data  # Should have been updated
        assert len(data["features"]) == 4

    def test_mark_in_progress(self, tmp_project_dir, create_roadmap):
        """Test mark_in_progress convenience method."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        result = fetcher.mark_in_progress("feature-1", linked_spec_id="spec-456")

        assert result is True
        feature = fetcher.fetch_feature("feature-1")
        assert feature.status == "in_progress"
        assert feature.linked_spec_id == "spec-456"

    def test_mark_done(self, tmp_project_dir, create_roadmap):
        """Test mark_done convenience method."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        result = fetcher.mark_done("feature-3")

        assert result is True
        feature = fetcher.fetch_feature("feature-3")
        assert feature.status == "done"

    def test_mark_under_review(self, tmp_project_dir, create_roadmap):
        """Test mark_under_review convenience method."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        result = fetcher.mark_under_review("feature-3")

        assert result is True
        feature = fetcher.fetch_feature("feature-3")
        assert feature.status == "under_review"


# =============================================================================
# FeatureFetcher Tests - Dependency Resolution
# =============================================================================

class TestFeatureFetcherDependencies:
    """Tests for FeatureFetcher dependency resolution."""

    def test_get_features_with_dependencies_met_no_deps(
        self, tmp_project_dir, create_roadmap
    ):
        """Test getting features with no dependencies."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        features = fetcher.get_features_with_dependencies_met()

        # feature-1 has no deps and is planned
        feature_ids = [f.id for f in features]
        assert "feature-1" in feature_ids

    def test_get_features_with_dependencies_met_with_completed(
        self, tmp_project_dir, sample_roadmap_data, create_roadmap
    ):
        """Test getting features with completed dependencies."""
        # Modify feature-1 to be done so feature-2's dep is met
        data = sample_roadmap_data.copy()
        data["features"][0]["status"] = "done"
        create_roadmap(data)

        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        features = fetcher.get_features_with_dependencies_met()

        # feature-2 depends on feature-1 which is now done
        feature_ids = [f.id for f in features]
        assert "feature-2" in feature_ids

    def test_get_features_with_dependencies_met_unmet_deps(
        self, tmp_project_dir, create_roadmap
    ):
        """Test features with unmet dependencies are excluded."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        features = fetcher.get_features_with_dependencies_met()

        # feature-2 depends on feature-1 which is planned (not done)
        feature_ids = [f.id for f in features]
        assert "feature-2" not in feature_ids

    def test_get_features_with_custom_completed_set(
        self, tmp_project_dir, create_roadmap
    ):
        """Test with custom completed feature IDs."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        # Pretend feature-1 is completed
        features = fetcher.get_features_with_dependencies_met(
            completed_feature_ids={"feature-1"}
        )

        # Now feature-2 should be included
        feature_ids = [f.id for f in features]
        assert "feature-2" in feature_ids


# =============================================================================
# FeatureFetcher Tests - Custom Path
# =============================================================================

class TestFeatureFetcherCustomPath:
    """Tests for FeatureFetcher with custom roadmap path."""

    def test_custom_roadmap_path(self, tmp_project_dir, sample_roadmap_data):
        """Test using a custom roadmap path."""
        custom_path = tmp_project_dir / "custom" / "location" / "roadmap.json"
        custom_path.parent.mkdir(parents=True)
        with open(custom_path, "w", encoding="utf-8") as f:
            json.dump(sample_roadmap_data, f)

        fetcher = FeatureFetcher(
            project_dir=tmp_project_dir,
            roadmap_path="custom/location/roadmap.json",
        )

        features = fetcher.fetch_planned_features()

        assert len(features) == 2


# =============================================================================
# Convenience Function Tests
# =============================================================================

class TestConvenienceFunctions:
    """Tests for module-level convenience functions."""

    def test_fetch_planned_features_function(self, tmp_project_dir, create_roadmap):
        """Test the fetch_planned_features convenience function."""
        create_roadmap()

        features = fetch_planned_features(tmp_project_dir)

        assert len(features) == 2
        assert isinstance(features[0], dict)
        assert features[0]["id"] == "feature-1"

    def test_update_feature_status_function(self, tmp_project_dir, create_roadmap):
        """Test the update_feature_status convenience function."""
        create_roadmap()

        result = update_feature_status(
            project_dir=tmp_project_dir,
            feature_id="feature-1",
            status="in_progress",
            linked_spec_id="spec-789",
        )

        assert result is True

        # Verify change
        features = fetch_planned_features(tmp_project_dir)
        feature_1 = [f for f in features if f["id"] == "feature-1"]
        # feature-1 should no longer be in planned list
        assert len(feature_1) == 0


# =============================================================================
# Enum Tests
# =============================================================================

class TestEnums:
    """Tests for feature enums."""

    def test_feature_status_values(self):
        """Test FeatureStatus enum values."""
        assert FeatureStatus.UNDER_REVIEW.value == "under_review"
        assert FeatureStatus.PLANNED.value == "planned"
        assert FeatureStatus.IN_PROGRESS.value == "in_progress"
        assert FeatureStatus.DONE.value == "done"

    def test_feature_priority_values(self):
        """Test FeaturePriority enum values (MoSCoW)."""
        assert FeaturePriority.MUST.value == "must"
        assert FeaturePriority.SHOULD.value == "should"
        assert FeaturePriority.COULD.value == "could"
        assert FeaturePriority.WONT.value == "wont"

    def test_feature_complexity_values(self):
        """Test FeatureComplexity enum values."""
        assert FeatureComplexity.LOW.value == "low"
        assert FeatureComplexity.MEDIUM.value == "medium"
        assert FeatureComplexity.HIGH.value == "high"

    def test_feature_impact_values(self):
        """Test FeatureImpact enum values."""
        assert FeatureImpact.LOW.value == "low"
        assert FeatureImpact.MEDIUM.value == "medium"
        assert FeatureImpact.HIGH.value == "high"


# =============================================================================
# Error Handling Edge Cases
# =============================================================================

class TestErrorHandling:
    """Tests for edge case error handling."""

    def test_update_missing_roadmap_file(self, tmp_project_dir):
        """Test updating when roadmap file doesn't exist."""
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        # Should return False since feature can't be found
        result = fetcher.update_feature_status("feature-1", "in_progress")
        assert result is False

    def test_load_roadmap_without_features_key(self, tmp_project_dir):
        """Test loading roadmap without 'features' key."""
        roadmap_path = tmp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        roadmap_path.parent.mkdir(parents=True, exist_ok=True)
        roadmap_path.write_text("{}", encoding="utf-8")

        fetcher = FeatureFetcher(project_dir=tmp_project_dir)
        features = fetcher.fetch_planned_features()

        assert len(features) == 0

    def test_save_roadmap_creates_directory(self, tmp_project_dir, sample_roadmap_data):
        """Test that save creates directory if needed."""
        # Don't create the directory initially
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        # First load will return empty (file doesn't exist)
        # Create a minimal roadmap first
        roadmap_path = tmp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        roadmap_path.parent.mkdir(parents=True, exist_ok=True)
        with open(roadmap_path, "w") as f:
            json.dump(sample_roadmap_data, f)

        # Now update should work
        result = fetcher.update_feature_status("feature-1", "in_progress")
        assert result is True

    def test_unexpected_error_during_fetch(self, tmp_project_dir, create_roadmap):
        """Test handling of unexpected errors during fetch."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        with patch.object(
            fetcher, "_load_roadmap", side_effect=RuntimeError("Unexpected error")
        ):
            with pytest.raises(FeatureFetchError) as exc_info:
                fetcher.fetch_planned_features()

            assert "Unexpected error" in str(exc_info.value)

    def test_unexpected_error_during_update(self, tmp_project_dir, create_roadmap):
        """Test handling of unexpected errors during update."""
        create_roadmap()
        fetcher = FeatureFetcher(project_dir=tmp_project_dir)

        with patch.object(
            fetcher, "_save_roadmap", side_effect=RuntimeError("Save failed")
        ):
            with pytest.raises(FeatureUpdateError) as exc_info:
                fetcher.update_feature_status("feature-1", "in_progress")

            assert "Unexpected error" in str(exc_info.value)


# =============================================================================
# Run tests with pytest
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
