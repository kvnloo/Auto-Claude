"""
Time Estimation Package
========================

Provides time estimation capabilities for task complexity assessment,
subtask planning, and progress tracking with historical data integration.
"""

from .time_estimator import TimeEstimate, TimeEstimator
from .historical_tracker import CompletionRecord, HistoricalTracker

__all__ = [
    "TimeEstimate",
    "TimeEstimator",
    "CompletionRecord",
    "HistoricalTracker",
]
