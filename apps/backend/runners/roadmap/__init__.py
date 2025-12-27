"""
Roadmap Generation Package
==========================

This package provides AI-powered roadmap generation for projects.
It orchestrates multiple phases to analyze projects and generate strategic feature roadmaps.

Also includes feature fetching for autonomous mode:
- FeatureFetcher: Fetch and update roadmap features
- RoadmapFeature: Feature data model
- fetch_planned_features: Convenience function for fetching planned features
- update_feature_status: Convenience function for updating feature status
"""

from .feature_fetcher import (
    FeatureFetcher,
    FeatureFetchError,
    FeatureStatus,
    FeatureUpdateError,
    RoadmapFeature,
    fetch_planned_features,
    update_feature_status,
)
from .models import RoadmapConfig, RoadmapPhaseResult
from .orchestrator import RoadmapOrchestrator

__all__ = [
    # Roadmap generation
    "RoadmapConfig",
    "RoadmapPhaseResult",
    "RoadmapOrchestrator",
    # Feature fetching for autonomous mode
    "FeatureFetcher",
    "FeatureFetchError",
    "FeatureStatus",
    "FeatureUpdateError",
    "RoadmapFeature",
    "fetch_planned_features",
    "update_feature_status",
]
