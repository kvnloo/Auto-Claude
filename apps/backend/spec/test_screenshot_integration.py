#!/usr/bin/env python3
"""
Integration Tests for Multi-Screenshot Context Analysis
========================================================

Tests for analyzing multiple screenshots together, including:
- Mobile + desktop responsive design scenarios
- Multi-page flow analysis
- Different state screenshots (hover, active, etc.)
- API endpoint integration with multiple images
- Task generation accounting for multiple contexts

These tests verify that the screenshot analyzer correctly combines
context from multiple images to generate coherent, responsive-aware tasks.
"""

from __future__ import annotations

import base64
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from services.screenshot_analyzer import (
    AnalysisResult,
    ExtractedComponent,
    GeneratedTask,
    ImageAttachment,
    LayoutInfo,
    ScreenshotAnalyzer,
    analyze_screenshots,
)


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def valid_png_data() -> str:
    """Create valid base64 encoded PNG data (1x1 pixel)."""
    png_bytes = bytes([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,  # IDAT chunk
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,  # IEND chunk
        0x42, 0x60, 0x82
    ])
    return base64.b64encode(png_bytes).decode('utf-8')


@pytest.fixture
def mobile_screenshot(valid_png_data: str) -> ImageAttachment:
    """Create a mobile screenshot attachment."""
    return ImageAttachment(
        id="mobile-uuid-001",
        filename="mobile-homepage.png",
        mime_type="image/png",
        size=1024,
        data=valid_png_data,
        thumbnail=None,
    )


@pytest.fixture
def desktop_screenshot(valid_png_data: str) -> ImageAttachment:
    """Create a desktop screenshot attachment."""
    return ImageAttachment(
        id="desktop-uuid-002",
        filename="desktop-homepage.png",
        mime_type="image/png",
        size=2048,
        data=valid_png_data,
        thumbnail=None,
    )


@pytest.fixture
def tablet_screenshot(valid_png_data: str) -> ImageAttachment:
    """Create a tablet screenshot attachment."""
    return ImageAttachment(
        id="tablet-uuid-003",
        filename="tablet-homepage.png",
        mime_type="image/png",
        size=1536,
        data=valid_png_data,
        thumbnail=None,
    )


@pytest.fixture
def hover_state_screenshot(valid_png_data: str) -> ImageAttachment:
    """Create a hover state screenshot attachment."""
    return ImageAttachment(
        id="hover-uuid-004",
        filename="button-hover-state.png",
        mime_type="image/png",
        size=512,
        data=valid_png_data,
        thumbnail=None,
    )


@pytest.fixture
def analyzer() -> ScreenshotAnalyzer:
    """Create a ScreenshotAnalyzer instance."""
    return ScreenshotAnalyzer()


@pytest.fixture
def responsive_analysis_response() -> dict:
    """Create a sample analysis response for responsive design."""
    return {
        "analysis": {
            "image_count": 2,
            "primary_purpose": "homepage",
            "responsive_design_detected": True,
            "breakpoints_identified": ["mobile", "desktop"],
        },
        "components": [
            {
                "type": "navigation",
                "name": "ResponsiveNavbar",
                "description": "Navigation bar that transforms to hamburger menu on mobile",
                "visual_details": {
                    "mobile": {"type": "hamburger-menu", "position": "top-right"},
                    "desktop": {"type": "horizontal-nav", "position": "top-center"},
                },
                "variants": ["mobile", "desktop"],
                "states": ["open", "closed"],
                "count_in_design": 1,
            },
            {
                "type": "grid",
                "name": "ProductGrid",
                "description": "Product listing grid with responsive columns",
                "visual_details": {
                    "mobile": {"columns": 1, "gap": "16px"},
                    "desktop": {"columns": 4, "gap": "24px"},
                },
                "variants": [],
                "states": [],
                "count_in_design": 1,
            },
            {
                "type": "button",
                "name": "CTAButton",
                "description": "Primary call-to-action button",
                "visual_details": {
                    "mobile": {"width": "100%"},
                    "desktop": {"width": "auto"},
                },
                "variants": ["primary", "secondary"],
                "states": ["default", "hover", "disabled"],
                "count_in_design": 3,
            },
        ],
        "layout": {
            "type": "responsive-landing",
            "structure": "Mobile: single column stack, Desktop: sidebar + main content",
            "grid": "CSS Grid with auto-fill",
            "container_max_width": "1280px",
        },
        "colors": {
            "primary": "#3B82F6",
            "secondary": "#10B981",
            "background": "#FFFFFF",
            "text_primary": "#1F2937",
        },
        "typography": {
            "heading_font": "Inter",
            "body_font": "Inter",
            "h1_size": "mobile: 24px, desktop: 48px",
            "body_size": "16px",
        },
        "tasks": [
            {
                "title": "Create ResponsiveNavbar component with mobile hamburger menu",
                "description": "Implement navigation that shows horizontal menu on desktop (>768px) and hamburger menu on mobile",
                "type": "component",
                "priority": "high",
                "implementation_details": {
                    "file_path": "components/ResponsiveNavbar.tsx",
                    "breakpoints": {"mobile": "max-width: 768px", "desktop": "min-width: 769px"},
                    "props": ["items", "logo", "onMenuToggle"],
                },
                "acceptance_criteria": [
                    "Horizontal nav visible on desktop",
                    "Hamburger icon visible on mobile",
                    "Smooth transition animation",
                    "Accessible keyboard navigation",
                ],
            },
            {
                "title": "Implement responsive ProductGrid with CSS Grid",
                "description": "Create product grid that shows 1 column on mobile and 4 columns on desktop",
                "type": "layout",
                "priority": "high",
                "implementation_details": {
                    "file_path": "components/ProductGrid.tsx",
                    "css_approach": "CSS Grid with grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))",
                },
                "acceptance_criteria": [
                    "Single column on screens < 640px",
                    "4 columns on screens >= 1024px",
                    "Consistent gap spacing across breakpoints",
                ],
            },
        ],
        "warnings": [
            "Mobile and desktop use different font sizes for headings - ensure consistent scale ratio",
        ],
        "questions": [
            "Should the hamburger menu animate with a slide-in or fade effect?",
        ],
    }


@pytest.fixture
def multi_state_analysis_response() -> dict:
    """Create a sample analysis response for multiple component states."""
    return {
        "analysis": {
            "image_count": 2,
            "primary_purpose": "button-states",
            "states_captured": ["default", "hover"],
        },
        "components": [
            {
                "type": "button",
                "name": "ActionButton",
                "description": "Button with multiple interaction states",
                "visual_details": {
                    "default": {"background": "#3B82F6", "shadow": "none"},
                    "hover": {"background": "#2563EB", "shadow": "md"},
                },
                "variants": ["primary"],
                "states": ["default", "hover", "active", "disabled"],
                "count_in_design": 1,
            },
        ],
        "tasks": [
            {
                "title": "Create ActionButton with hover state transitions",
                "description": "Implement button with smooth color and shadow transitions on hover",
                "type": "component",
                "priority": "medium",
                "implementation_details": {
                    "file_path": "components/ActionButton.tsx",
                    "transitions": "transition-all duration-200",
                },
                "acceptance_criteria": [
                    "Background darkens on hover",
                    "Shadow appears on hover",
                    "150-200ms transition duration",
                ],
            },
        ],
        "warnings": [],
        "questions": [],
    }


@pytest.fixture
def multi_page_analysis_response() -> dict:
    """Create a sample analysis response for multiple pages."""
    return {
        "analysis": {
            "image_count": 3,
            "primary_purpose": "user-flow",
            "pages_identified": ["login", "dashboard", "settings"],
        },
        "components": [
            {
                "type": "form",
                "name": "LoginForm",
                "description": "Login form with email and password fields",
                "visual_details": {},
                "variants": [],
                "states": ["empty", "filled", "error"],
                "count_in_design": 1,
            },
            {
                "type": "layout",
                "name": "DashboardLayout",
                "description": "Dashboard with sidebar and main content area",
                "visual_details": {},
                "variants": [],
                "states": [],
                "count_in_design": 1,
            },
            {
                "type": "form",
                "name": "SettingsForm",
                "description": "User settings form with multiple sections",
                "visual_details": {},
                "variants": [],
                "states": [],
                "count_in_design": 1,
            },
        ],
        "layout": {
            "type": "multi-page-app",
            "structure": "Login is standalone, Dashboard/Settings share sidebar layout",
            "grid": None,
            "container_max_width": "1200px",
        },
        "tasks": [
            {
                "title": "Create shared DashboardLayout component",
                "description": "Implement reusable layout with sidebar for Dashboard and Settings pages",
                "type": "layout",
                "priority": "high",
                "implementation_details": {
                    "file_path": "layouts/DashboardLayout.tsx",
                },
                "acceptance_criteria": [
                    "Sidebar with navigation links",
                    "Main content area with proper spacing",
                ],
            },
        ],
        "warnings": [],
        "questions": [],
    }


# =============================================================================
# MULTI-SCREENSHOT CONTENT BUILDING TESTS
# =============================================================================


class TestMultiScreenshotContentBuilding:
    """Test building multimodal content for multiple screenshots."""

    def test_build_content_with_mobile_and_desktop(
        self,
        analyzer: ScreenshotAnalyzer,
        mobile_screenshot: ImageAttachment,
        desktop_screenshot: ImageAttachment,
    ):
        """Build content for mobile + desktop responsive design analysis."""
        images = [mobile_screenshot, desktop_screenshot]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            content = analyzer._build_multimodal_content(images)

        # Should have text + 2 images
        assert len(content) == 3
        assert content[0]["type"] == "text"
        assert "Analyzing 2 screenshot(s)" in content[0]["text"]
        assert "mobile-homepage.png" in content[0]["text"]
        assert "desktop-homepage.png" in content[0]["text"]

        # Both images included
        assert content[1]["type"] == "image"
        assert content[2]["type"] == "image"

    def test_build_content_with_three_breakpoints(
        self,
        analyzer: ScreenshotAnalyzer,
        mobile_screenshot: ImageAttachment,
        tablet_screenshot: ImageAttachment,
        desktop_screenshot: ImageAttachment,
    ):
        """Build content for three breakpoint analysis."""
        images = [mobile_screenshot, tablet_screenshot, desktop_screenshot]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            content = analyzer._build_multimodal_content(images)

        assert len(content) == 4  # Text + 3 images
        text = content[0]["text"]
        assert "Analyzing 3 screenshot(s)" in text
        assert "mobile-homepage.png" in text
        assert "tablet-homepage.png" in text
        assert "desktop-homepage.png" in text

    def test_build_content_with_project_context_includes_responsive_hints(
        self,
        analyzer: ScreenshotAnalyzer,
        mobile_screenshot: ImageAttachment,
        desktop_screenshot: ImageAttachment,
    ):
        """Project context is included for responsive design hints."""
        images = [mobile_screenshot, desktop_screenshot]
        context = "React project with Tailwind CSS. Mobile-first design approach."

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            content = analyzer._build_multimodal_content(images, project_context=context)

        text = content[0]["text"]
        assert "React project with Tailwind CSS" in text
        assert "Mobile-first design approach" in text
        assert "PROJECT CONTEXT" in text


# =============================================================================
# MULTI-SCREENSHOT ANALYSIS TESTS
# =============================================================================


class TestMultiScreenshotAnalysis:
    """Test analyzing multiple screenshots together."""

    @pytest.mark.asyncio
    async def test_analyze_mobile_and_desktop_screenshots(
        self,
        analyzer: ScreenshotAnalyzer,
        mobile_screenshot: ImageAttachment,
        desktop_screenshot: ImageAttachment,
        responsive_analysis_response: dict,
    ):
        """Analyze mobile + desktop screenshots for responsive design."""
        images = [mobile_screenshot, desktop_screenshot]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(responsive_analysis_response)
                ),
            ):
                result = await analyzer.analyze(images)

        assert result.success is True
        assert len(result.components) == 3

        # Check responsive component detection
        nav_component = next(c for c in result.components if c.type == "navigation")
        assert "mobile" in nav_component.variants
        assert "desktop" in nav_component.variants
        assert "mobile" in nav_component.visual_details
        assert "desktop" in nav_component.visual_details

    @pytest.mark.asyncio
    async def test_analyze_multiple_states_screenshots(
        self,
        analyzer: ScreenshotAnalyzer,
        valid_png_data: str,
        multi_state_analysis_response: dict,
    ):
        """Analyze screenshots showing different component states."""
        images = [
            ImageAttachment(
                id="default-001",
                filename="button-default.png",
                mime_type="image/png",
                size=512,
                data=valid_png_data,
            ),
            ImageAttachment(
                id="hover-002",
                filename="button-hover.png",
                mime_type="image/png",
                size=512,
                data=valid_png_data,
            ),
        ]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(multi_state_analysis_response)
                ),
            ):
                result = await analyzer.analyze(images)

        assert result.success is True
        assert len(result.components) == 1

        button = result.components[0]
        assert "default" in button.states or "hover" in button.states
        assert "default" in button.visual_details
        assert "hover" in button.visual_details

    @pytest.mark.asyncio
    async def test_analyze_multi_page_screenshots(
        self,
        analyzer: ScreenshotAnalyzer,
        valid_png_data: str,
        multi_page_analysis_response: dict,
    ):
        """Analyze screenshots from different pages for shared components."""
        images = [
            ImageAttachment(
                id="login-001",
                filename="login-page.png",
                mime_type="image/png",
                size=1024,
                data=valid_png_data,
            ),
            ImageAttachment(
                id="dashboard-002",
                filename="dashboard-page.png",
                mime_type="image/png",
                size=2048,
                data=valid_png_data,
            ),
            ImageAttachment(
                id="settings-003",
                filename="settings-page.png",
                mime_type="image/png",
                size=1536,
                data=valid_png_data,
            ),
        ]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(multi_page_analysis_response)
                ),
            ):
                result = await analyzer.analyze(images)

        assert result.success is True
        assert len(result.components) == 3

        # Check layout detection
        assert result.layout is not None
        assert result.layout.type == "multi-page-app"
        assert "sidebar" in result.layout.structure.lower()


# =============================================================================
# RESPONSIVE TASK GENERATION TESTS
# =============================================================================


class TestResponsiveTaskGeneration:
    """Test that generated tasks account for responsive design."""

    @pytest.mark.asyncio
    async def test_tasks_include_responsive_breakpoints(
        self,
        analyzer: ScreenshotAnalyzer,
        mobile_screenshot: ImageAttachment,
        desktop_screenshot: ImageAttachment,
        responsive_analysis_response: dict,
    ):
        """Generated tasks include breakpoint-specific implementation details."""
        images = [mobile_screenshot, desktop_screenshot]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(responsive_analysis_response)
                ),
            ):
                result = await analyzer.analyze(images)

        assert result.success is True
        assert len(result.tasks) >= 1

        # Check for responsive implementation details
        nav_task = next(
            (t for t in result.tasks if "navbar" in t.title.lower()),
            None,
        )
        assert nav_task is not None
        assert "breakpoints" in nav_task.implementation_details

    @pytest.mark.asyncio
    async def test_tasks_include_mobile_first_guidance(
        self,
        analyzer: ScreenshotAnalyzer,
        mobile_screenshot: ImageAttachment,
        desktop_screenshot: ImageAttachment,
        responsive_analysis_response: dict,
    ):
        """Tasks include mobile-first implementation approach when detected."""
        images = [mobile_screenshot, desktop_screenshot]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(responsive_analysis_response)
                ),
            ):
                result = await analyzer.analyze(images)

        # Check tasks have acceptance criteria for different screen sizes
        for task in result.tasks:
            criteria_text = " ".join(task.acceptance_criteria)
            # At least one task should mention screen sizes or breakpoints
            has_responsive_criteria = any(
                word in criteria_text.lower()
                for word in ["mobile", "desktop", "screen", "column"]
            )
            if has_responsive_criteria:
                break
        else:
            pytest.fail("No task with responsive acceptance criteria found")

    @pytest.mark.asyncio
    async def test_warnings_include_responsive_considerations(
        self,
        analyzer: ScreenshotAnalyzer,
        mobile_screenshot: ImageAttachment,
        desktop_screenshot: ImageAttachment,
        responsive_analysis_response: dict,
    ):
        """Warnings flag responsive design inconsistencies."""
        images = [mobile_screenshot, desktop_screenshot]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(responsive_analysis_response)
                ),
            ):
                result = await analyzer.analyze(images)

        # Should have warning about font size differences
        assert len(result.warnings) >= 1
        font_warning = next(
            (w for w in result.warnings if "font" in w.lower()),
            None,
        )
        assert font_warning is not None


# =============================================================================
# CONVENIENCE FUNCTION TESTS
# =============================================================================


class TestAnalyzeScreenshotsFunction:
    """Test the analyze_screenshots convenience function with multiple images."""

    @pytest.mark.asyncio
    async def test_analyze_screenshots_with_multiple_dicts(
        self,
        valid_png_data: str,
        responsive_analysis_response: dict,
    ):
        """analyze_screenshots works with multiple dict inputs."""
        images = [
            {
                "id": "mobile-001",
                "filename": "mobile.png",
                "mime_type": "image/png",
                "size": 1024,
                "data": valid_png_data,
            },
            {
                "id": "desktop-002",
                "filename": "desktop.png",
                "mime_type": "image/png",
                "size": 2048,
                "data": valid_png_data,
            },
        ]

        with patch.object(
            ScreenshotAnalyzer, "_get_prompt_template", return_value="Analyze:"
        ):
            with patch.object(
                ScreenshotAnalyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=ScreenshotAnalyzer()._parse_analysis_response(
                    json.dumps(responsive_analysis_response)
                ),
            ):
                result = await analyze_screenshots(
                    images, project_context="Responsive React app"
                )

        assert result["success"] is True
        assert len(result["components"]) == 3
        assert len(result["tasks"]) >= 1

    @pytest.mark.asyncio
    async def test_analyze_screenshots_with_camelCase_mimeType(
        self,
        valid_png_data: str,
        responsive_analysis_response: dict,
    ):
        """analyze_screenshots handles mimeType alias for multiple images."""
        images = [
            {
                "id": "img-001",
                "filename": "mobile.png",
                "mimeType": "image/png",  # Frontend format
                "size": 1024,
                "data": valid_png_data,
            },
            {
                "id": "img-002",
                "filename": "desktop.png",
                "mimeType": "image/png",
                "size": 2048,
                "data": valid_png_data,
            },
        ]

        with patch.object(
            ScreenshotAnalyzer, "_get_prompt_template", return_value="Analyze:"
        ):
            with patch.object(
                ScreenshotAnalyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=ScreenshotAnalyzer()._parse_analysis_response(
                    json.dumps(responsive_analysis_response)
                ),
            ):
                result = await analyze_screenshots(images)

        assert result["success"] is True


# =============================================================================
# API ENDPOINT INTEGRATION TESTS
# =============================================================================


class TestAPIEndpointIntegration:
    """Test API endpoint with multiple screenshots."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create test client for API."""
        from api.screenshot_routes import app
        return TestClient(app)

    def test_api_accepts_multiple_images(
        self,
        client: TestClient,
        valid_png_data: str,
        responsive_analysis_response: dict,
    ):
        """API endpoint accepts multiple images in request."""
        request_data = {
            "images": [
                {
                    "id": "mobile-001",
                    "filename": "mobile.png",
                    "mimeType": "image/png",
                    "size": 1024,
                    "data": valid_png_data,
                },
                {
                    "id": "desktop-002",
                    "filename": "desktop.png",
                    "mimeType": "image/png",
                    "size": 2048,
                    "data": valid_png_data,
                },
            ],
            "project_context": "React + Tailwind responsive design",
        }

        with patch.object(
            ScreenshotAnalyzer, "_get_prompt_template", return_value="Analyze:"
        ):
            with patch.object(
                ScreenshotAnalyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=ScreenshotAnalyzer()._parse_analysis_response(
                    json.dumps(responsive_analysis_response)
                ),
            ):
                response = client.post(
                    "/api/screenshot-analysis",
                    json=request_data,
                )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["components"]) == 3
        assert len(data["tasks"]) >= 1

    def test_api_validates_all_images(
        self,
        client: TestClient,
        valid_png_data: str,
    ):
        """API validates all images and returns errors for invalid ones."""
        request_data = {
            "images": [
                {
                    "id": "valid-001",
                    "filename": "valid.png",
                    "mimeType": "image/png",
                    "size": 1024,
                    "data": valid_png_data,
                },
                {
                    "id": "invalid-002",
                    "filename": "invalid.pdf",
                    "mimeType": "application/pdf",  # Invalid type
                    "size": 1024,
                    "data": valid_png_data,
                },
            ],
        }

        response = client.post(
            "/api/screenshot-analysis",
            json=request_data,
        )

        assert response.status_code == 400
        data = response.json()["detail"]
        assert data["success"] is False
        assert len(data["validation_errors"]) >= 1
        assert any("invalid-002" in e["image_id"] for e in data["validation_errors"])

    def test_api_rejects_more_than_max_images(
        self,
        client: TestClient,
        valid_png_data: str,
    ):
        """API rejects requests with more than 10 images."""
        request_data = {
            "images": [
                {
                    "id": f"img-{i:03d}",
                    "filename": f"screenshot{i}.png",
                    "mimeType": "image/png",
                    "size": 1024,
                    "data": valid_png_data,
                }
                for i in range(11)  # 11 images, exceeds limit of 10
            ],
        }

        response = client.post(
            "/api/screenshot-analysis",
            json=request_data,
        )

        assert response.status_code == 400
        data = response.json()["detail"]
        assert data["success"] is False
        assert any(
            "too many" in e["error"].lower()
            for e in data["validation_errors"]
        )


# =============================================================================
# EDGE CASE TESTS
# =============================================================================


class TestMultiScreenshotEdgeCases:
    """Test edge cases for multi-screenshot analysis."""

    @pytest.mark.asyncio
    async def test_analyze_duplicate_filenames(
        self,
        analyzer: ScreenshotAnalyzer,
        valid_png_data: str,
        responsive_analysis_response: dict,
    ):
        """Handle screenshots with same filename gracefully."""
        images = [
            ImageAttachment(
                id="uuid-001",
                filename="screenshot.png",
                mime_type="image/png",
                size=1024,
                data=valid_png_data,
            ),
            ImageAttachment(
                id="uuid-002",
                filename="screenshot.png",  # Same filename, different ID
                mime_type="image/png",
                size=2048,
                data=valid_png_data,
            ),
        ]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(responsive_analysis_response)
                ),
            ):
                result = await analyzer.analyze(images)

        # Should succeed - IDs are different
        assert result.success is True

    @pytest.mark.asyncio
    async def test_analyze_mixed_image_types(
        self,
        analyzer: ScreenshotAnalyzer,
        responsive_analysis_response: dict,
    ):
        """Handle mix of PNG and JPEG screenshots."""
        # Create valid JPEG data
        jpeg_bytes = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
        jpeg_data = base64.b64encode(jpeg_bytes).decode()

        # Create valid PNG data
        png_bytes = bytes([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
            0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
            0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
            0x42, 0x60, 0x82
        ])
        png_data = base64.b64encode(png_bytes).decode()

        images = [
            ImageAttachment(
                id="png-001",
                filename="mobile.png",
                mime_type="image/png",
                size=len(png_bytes),
                data=png_data,
            ),
            ImageAttachment(
                id="jpeg-002",
                filename="desktop.jpg",
                mime_type="image/jpeg",
                size=len(jpeg_bytes),
                data=jpeg_data,
            ),
        ]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(responsive_analysis_response)
                ),
            ):
                result = await analyzer.analyze(images)

        assert result.success is True

    @pytest.mark.asyncio
    async def test_analyze_max_screenshots(
        self,
        analyzer: ScreenshotAnalyzer,
        valid_png_data: str,
        responsive_analysis_response: dict,
    ):
        """Successfully analyze exactly 10 screenshots (the limit)."""
        images = [
            ImageAttachment(
                id=f"uuid-{i:03d}",
                filename=f"page{i}.png",
                mime_type="image/png",
                size=1024,
                data=valid_png_data,
            )
            for i in range(10)
        ]

        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(responsive_analysis_response)
                ),
            ):
                result = await analyzer.analyze(images)

        assert result.success is True

    def test_validation_fails_over_max_screenshots(
        self,
        analyzer: ScreenshotAnalyzer,
        valid_png_data: str,
    ):
        """Validation fails for more than 10 screenshots."""
        images = [
            ImageAttachment(
                id=f"uuid-{i:03d}",
                filename=f"page{i}.png",
                mime_type="image/png",
                size=1024,
                data=valid_png_data,
            )
            for i in range(11)  # One more than limit
        ]

        is_valid, errors = analyzer.validate_images(images)

        assert is_valid is False
        assert any("Too many images" in e.error for e in errors)


# =============================================================================
# RESULT SERIALIZATION TESTS
# =============================================================================


class TestResultSerialization:
    """Test that multi-screenshot results serialize correctly."""

    def test_to_dict_preserves_responsive_details(
        self,
        analyzer: ScreenshotAnalyzer,
        responsive_analysis_response: dict,
    ):
        """Serialized result preserves responsive design details."""
        result = analyzer._parse_analysis_response(
            json.dumps(responsive_analysis_response)
        )
        result_dict = analyzer.to_dict(result)

        # Check components preserve variant details
        nav_component = next(
            c for c in result_dict["components"] if c["type"] == "navigation"
        )
        assert "mobile" in nav_component["variants"]
        assert "desktop" in nav_component["variants"]
        assert "mobile" in nav_component["visual_details"]
        assert "desktop" in nav_component["visual_details"]

    def test_to_dict_includes_metadata(
        self,
        analyzer: ScreenshotAnalyzer,
        responsive_analysis_response: dict,
    ):
        """Serialized result includes analysis metadata."""
        result = analyzer._parse_analysis_response(
            json.dumps(responsive_analysis_response)
        )
        result_dict = analyzer.to_dict(result)

        metadata = result_dict["analysis_metadata"]
        assert metadata["image_count"] == 2
        assert metadata["responsive_design_detected"] is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
