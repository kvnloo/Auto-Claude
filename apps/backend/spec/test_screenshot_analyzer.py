#!/usr/bin/env python3
"""
Tests for Screenshot Analyzer
==============================

Comprehensive test suite for screenshot analysis service covering:
- Image validation (size, type, count limits)
- Base64 encoding validation
- Multimodal content building for vision API
- JSON response parsing
- Task generation logic
- Error handling
- Data class conversions
"""

from __future__ import annotations

import base64
import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.screenshot_analyzer import (
    ALLOWED_MIME_TYPES,
    DANGEROUS_FILENAME_PATTERNS,
    IMAGE_MAGIC_BYTES,
    MAX_FILE_SIZE_BYTES,
    MAX_FILENAME_LENGTH,
    MAX_SCREENSHOTS,
    SVG_MARKERS,
    AnalysisResult,
    ColorPalette,
    ExtractedComponent,
    GeneratedTask,
    ImageAttachment,
    LayoutInfo,
    ScreenshotAnalyzer,
    Typography,
    ValidationError,
    analyze_screenshots,
    decode_base64_safely,
    validate_content_size,
    validate_filename_security,
    validate_magic_bytes,
    validate_screenshot_uploads,
)


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def valid_image_data() -> str:
    """Create valid base64 encoded image data (1x1 pixel PNG)."""
    # Minimal valid PNG (1x1 transparent pixel)
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
def valid_image_attachment(valid_image_data: str) -> ImageAttachment:
    """Create a valid image attachment."""
    return ImageAttachment(
        id="test-uuid-123",
        filename="screenshot.png",
        mime_type="image/png",
        size=1024,
        data=valid_image_data,
        thumbnail=None,
    )


@pytest.fixture
def sample_analysis_response() -> dict:
    """Create a sample analysis response from Claude."""
    return {
        "analysis": {
            "image_count": 1,
            "primary_purpose": "dashboard",
        },
        "components": [
            {
                "type": "button",
                "name": "PrimaryButton",
                "description": "Main call-to-action button",
                "visual_details": {"color": "#007bff", "padding": "12px 24px"},
                "variants": ["primary", "secondary"],
                "states": ["default", "hover", "disabled"],
                "count_in_design": 3,
            },
            {
                "type": "card",
                "name": "DashboardCard",
                "description": "Statistics display card",
                "visual_details": {"border_radius": "8px"},
                "variants": [],
                "states": [],
                "count_in_design": 4,
            },
        ],
        "layout": {
            "type": "dashboard",
            "structure": "Grid layout with sidebar navigation",
            "grid": "12-column grid",
            "container_max_width": "1200px",
        },
        "colors": {
            "primary": "#007bff",
            "secondary": "#6c757d",
            "success": "#28a745",
            "warning": "#ffc107",
            "error": "#dc3545",
            "background": "#ffffff",
            "surface": "#f8f9fa",
            "text_primary": "#212529",
            "text_secondary": "#6c757d",
            "border": "#dee2e6",
        },
        "typography": {
            "heading_font": "Inter",
            "body_font": "Inter",
            "h1_size": "32px",
            "h2_size": "24px",
            "body_size": "16px",
            "small_size": "14px",
        },
        "tasks": [
            {
                "title": "Create PrimaryButton component",
                "description": "Implement a reusable button component with variants",
                "type": "component",
                "priority": "high",
                "implementation_details": {
                    "file_path": "components/PrimaryButton.tsx",
                    "props": ["variant", "onClick", "disabled"],
                },
                "acceptance_criteria": [
                    "Supports primary and secondary variants",
                    "Has hover and disabled states",
                ],
            },
        ],
        "warnings": ["Design uses custom fonts - verify licensing"],
        "questions": ["Should buttons have loading states?"],
    }


@pytest.fixture
def analyzer() -> ScreenshotAnalyzer:
    """Create a ScreenshotAnalyzer instance."""
    return ScreenshotAnalyzer()


# =============================================================================
# IMAGE ATTACHMENT DATA CLASS TESTS
# =============================================================================


class TestImageAttachment:
    """Test ImageAttachment data class."""

    def test_create_attachment(self, valid_image_data: str):
        """Can create an image attachment with all fields."""
        attachment = ImageAttachment(
            id="uuid-123",
            filename="test.png",
            mime_type="image/png",
            size=5000,
            data=valid_image_data,
            thumbnail="thumbnail-base64",
        )
        assert attachment.id == "uuid-123"
        assert attachment.filename == "test.png"
        assert attachment.mime_type == "image/png"
        assert attachment.size == 5000
        assert attachment.data == valid_image_data
        assert attachment.thumbnail == "thumbnail-base64"

    def test_thumbnail_optional(self, valid_image_data: str):
        """Thumbnail field is optional."""
        attachment = ImageAttachment(
            id="uuid-123",
            filename="test.png",
            mime_type="image/png",
            size=5000,
            data=valid_image_data,
        )
        assert attachment.thumbnail is None


# =============================================================================
# IMAGE VALIDATION TESTS
# =============================================================================


class TestImageValidation:
    """Test image validation logic."""

    def test_validate_empty_list(self, analyzer: ScreenshotAnalyzer):
        """Empty image list fails validation."""
        is_valid, errors, warnings = analyzer.validate_images([])
        assert is_valid is False
        assert len(errors) == 1
        assert "No images provided" in errors[0].error

    def test_validate_exceeds_max_count(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Exceeding max image count fails validation."""
        images = [
            ImageAttachment(
                id=f"uuid-{i}",
                filename=f"test{i}.png",
                mime_type="image/png",
                size=1024,
                data=valid_image_data,
            )
            for i in range(MAX_SCREENSHOTS + 1)
        ]
        is_valid, errors, warnings = analyzer.validate_images(images)
        assert is_valid is False
        assert any(f"Too many images: {MAX_SCREENSHOTS + 1}" in e.error for e in errors)

    def test_validate_invalid_mime_type(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Invalid MIME type fails validation."""
        image = ImageAttachment(
            id="uuid-123",
            filename="test.exe",
            mime_type="application/octet-stream",  # Not in allowed types
            size=1024,
            data=valid_image_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is False
        assert any("Invalid file type" in e.error for e in errors)

    def test_validate_file_too_large(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """File exceeding size limit fails validation."""
        image = ImageAttachment(
            id="uuid-123",
            filename="test.png",
            mime_type="image/png",
            size=MAX_FILE_SIZE_BYTES + 1,  # 10MB + 1 byte
            data=valid_image_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is False
        assert any("File too large" in e.error for e in errors)

    def test_validate_missing_data(self, analyzer: ScreenshotAnalyzer):
        """Missing image data fails validation."""
        image = ImageAttachment(
            id="uuid-123",
            filename="test.png",
            mime_type="image/png",
            size=1024,
            data="",  # Empty data
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is False
        assert any("Missing image data" in e.error for e in errors)

    def test_validate_invalid_base64(self, analyzer: ScreenshotAnalyzer):
        """Invalid base64 encoding fails validation."""
        image = ImageAttachment(
            id="uuid-123",
            filename="test.png",
            mime_type="image/png",
            size=1024,
            data="not-valid-base64!@#$",
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is False
        assert any("Invalid base64 encoding" in e.error for e in errors)

    def test_validate_valid_image(
        self, analyzer: ScreenshotAnalyzer, valid_image_attachment: ImageAttachment
    ):
        """Valid image passes validation."""
        is_valid, errors, warnings = analyzer.validate_images([valid_image_attachment])
        assert is_valid is True
        assert len(errors) == 0

    def test_validate_all_allowed_mime_types(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """PNG MIME types pass validation when content matches.

        Note: With magic bytes validation, we can only validate PNG with
        the valid_image_data fixture since it's actual PNG data.
        """
        # Test PNG variants which match the fixture data
        for mime_type in ["image/png"]:
            image = ImageAttachment(
                id="uuid-123",
                filename="test.img",
                mime_type=mime_type,
                size=1024,
                data=valid_image_data,
            )
            is_valid, errors, warnings = analyzer.validate_images([image])
            assert is_valid is True, f"MIME type {mime_type} should be valid"

    def test_validate_jpeg_with_jpeg_data(self, analyzer: ScreenshotAnalyzer):
        """JPEG MIME type passes with actual JPEG data."""
        # Create valid JPEG data (minimal JPEG)
        jpeg_data = base64.b64encode(
            b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
        ).decode()
        for mime_type in ["image/jpeg", "image/jpg"]:
            image = ImageAttachment(
                id="uuid-123",
                filename="test.jpg",
                mime_type=mime_type,
                size=110,
                data=jpeg_data,
            )
            is_valid, errors, warnings = analyzer.validate_images([image])
            assert is_valid is True, f"MIME type {mime_type} should be valid: {errors}"

    def test_validate_gif_with_gif_data(self, analyzer: ScreenshotAnalyzer):
        """GIF MIME type passes with actual GIF data."""
        gif_data = base64.b64encode(b"GIF89a" + b"\x00" * 100).decode()
        image = ImageAttachment(
            id="uuid-123",
            filename="test.gif",
            mime_type="image/gif",
            size=106,
            data=gif_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is True, f"GIF should be valid: {errors}"

    def test_validate_webp_with_webp_data(self, analyzer: ScreenshotAnalyzer):
        """WebP MIME type passes with actual WebP data."""
        webp_data = base64.b64encode(b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 100).decode()
        image = ImageAttachment(
            id="uuid-123",
            filename="test.webp",
            mime_type="image/webp",
            size=112,
            data=webp_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is True, f"WebP should be valid: {errors}"

    def test_validate_svg_with_svg_data(self, analyzer: ScreenshotAnalyzer):
        """SVG MIME type passes with actual SVG data."""
        svg_data = base64.b64encode(b'<svg xmlns="test"></svg>').decode()
        image = ImageAttachment(
            id="uuid-123",
            filename="test.svg",
            mime_type="image/svg+xml",
            size=24,
            data=svg_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is True, f"SVG should be valid: {errors}"

    def test_validate_multiple_images_partial_failure(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Multiple images with some invalid fails for those."""
        images = [
            ImageAttachment(
                id="uuid-1",
                filename="valid.png",
                mime_type="image/png",
                size=1024,
                data=valid_image_data,
            ),
            ImageAttachment(
                id="uuid-2",
                filename="invalid.pdf",
                mime_type="application/pdf",
                size=1024,
                data=valid_image_data,
            ),
            ImageAttachment(
                id="uuid-3",
                filename="toolarge.png",
                mime_type="image/png",
                size=MAX_FILE_SIZE_BYTES + 1,
                data=valid_image_data,
            ),
        ]
        is_valid, errors, warnings = analyzer.validate_images(images)
        assert is_valid is False
        assert len(errors) == 2  # Two invalid images
        assert any("uuid-2" in e.image_id for e in errors)
        assert any("uuid-3" in e.image_id for e in errors)


# =============================================================================
# MULTIMODAL CONTENT BUILDING TESTS
# =============================================================================


class TestMultimodalContentBuilding:
    """Test vision API message content construction."""

    def test_build_content_single_image(
        self, analyzer: ScreenshotAnalyzer, valid_image_attachment: ImageAttachment
    ):
        """Build content for single image."""
        # Mock the prompt template
        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze this UI:"
        ):
            content = analyzer._build_multimodal_content([valid_image_attachment])

        assert len(content) == 2  # Text + 1 image
        assert content[0]["type"] == "text"
        assert "Analyze this UI:" in content[0]["text"]
        assert content[1]["type"] == "image"
        assert content[1]["source"]["type"] == "base64"
        assert content[1]["source"]["media_type"] == "image/png"
        assert content[1]["source"]["data"] == valid_image_attachment.data

    def test_build_content_multiple_images(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Build content for multiple images."""
        images = [
            ImageAttachment(
                id=f"uuid-{i}",
                filename=f"screen{i}.png",
                mime_type="image/png",
                size=1024,
                data=valid_image_data,
            )
            for i in range(3)
        ]
        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze this UI:"
        ):
            content = analyzer._build_multimodal_content(images)

        assert len(content) == 4  # Text + 3 images
        assert content[0]["type"] == "text"
        for i in range(1, 4):
            assert content[i]["type"] == "image"

    def test_build_content_with_project_context(
        self, analyzer: ScreenshotAnalyzer, valid_image_attachment: ImageAttachment
    ):
        """Project context is included in prompt."""
        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze this UI:"
        ):
            content = analyzer._build_multimodal_content(
                [valid_image_attachment], project_context="React + Tailwind project"
            )

        assert "React + Tailwind project" in content[0]["text"]
        assert "PROJECT CONTEXT" in content[0]["text"]

    def test_build_content_normalizes_jpeg_mime_type(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """MIME type 'image/jpg' is normalized to 'image/jpeg'."""
        image = ImageAttachment(
            id="uuid-123",
            filename="test.jpg",
            mime_type="image/jpg",
            size=1024,
            data=valid_image_data,
        )
        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze this UI:"
        ):
            content = analyzer._build_multimodal_content([image])

        assert content[1]["source"]["media_type"] == "image/jpeg"

    def test_build_content_lists_filenames(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Screenshot filenames are listed in prompt."""
        images = [
            ImageAttachment(
                id="uuid-1",
                filename="homepage.png",
                mime_type="image/png",
                size=1024,
                data=valid_image_data,
            ),
            ImageAttachment(
                id="uuid-2",
                filename="dashboard.png",
                mime_type="image/png",
                size=1024,
                data=valid_image_data,
            ),
        ]
        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze this UI:"
        ):
            content = analyzer._build_multimodal_content(images)

        text = content[0]["text"]
        assert "homepage.png" in text
        assert "dashboard.png" in text
        assert "Analyzing 2 screenshot(s)" in text


# =============================================================================
# RESPONSE PARSING TESTS
# =============================================================================


class TestResponseParsing:
    """Test Claude response parsing logic."""

    def test_parse_valid_json_response(
        self, analyzer: ScreenshotAnalyzer, sample_analysis_response: dict
    ):
        """Parse valid JSON response."""
        response_text = json.dumps(sample_analysis_response)
        result = analyzer._parse_analysis_response(response_text)

        assert result.success is True
        assert len(result.components) == 2
        assert result.components[0].name == "PrimaryButton"
        assert result.components[0].type == "button"
        assert result.components[1].name == "DashboardCard"

    def test_parse_response_with_markdown_code_block(
        self, analyzer: ScreenshotAnalyzer, sample_analysis_response: dict
    ):
        """Parse JSON wrapped in markdown code block."""
        response_text = f"```json\n{json.dumps(sample_analysis_response)}\n```"
        result = analyzer._parse_analysis_response(response_text)

        assert result.success is True
        assert len(result.components) == 2

    def test_parse_response_with_plain_code_block(
        self, analyzer: ScreenshotAnalyzer, sample_analysis_response: dict
    ):
        """Parse JSON wrapped in plain code block."""
        response_text = f"```\n{json.dumps(sample_analysis_response)}\n```"
        result = analyzer._parse_analysis_response(response_text)

        assert result.success is True

    def test_parse_layout_info(
        self, analyzer: ScreenshotAnalyzer, sample_analysis_response: dict
    ):
        """Parse layout information."""
        response_text = json.dumps(sample_analysis_response)
        result = analyzer._parse_analysis_response(response_text)

        assert result.layout is not None
        assert result.layout.type == "dashboard"
        assert result.layout.grid == "12-column grid"
        assert result.layout.container_max_width == "1200px"

    def test_parse_color_palette(
        self, analyzer: ScreenshotAnalyzer, sample_analysis_response: dict
    ):
        """Parse color palette."""
        response_text = json.dumps(sample_analysis_response)
        result = analyzer._parse_analysis_response(response_text)

        assert result.colors is not None
        assert result.colors.primary == "#007bff"
        assert result.colors.secondary == "#6c757d"
        assert result.colors.background == "#ffffff"

    def test_parse_typography(
        self, analyzer: ScreenshotAnalyzer, sample_analysis_response: dict
    ):
        """Parse typography information."""
        response_text = json.dumps(sample_analysis_response)
        result = analyzer._parse_analysis_response(response_text)

        assert result.typography is not None
        assert result.typography.heading_font == "Inter"
        assert result.typography.body_font == "Inter"
        assert result.typography.h1_size == "32px"

    def test_parse_generated_tasks(
        self, analyzer: ScreenshotAnalyzer, sample_analysis_response: dict
    ):
        """Parse generated tasks."""
        response_text = json.dumps(sample_analysis_response)
        result = analyzer._parse_analysis_response(response_text)

        assert len(result.tasks) == 1
        assert result.tasks[0].title == "Create PrimaryButton component"
        assert result.tasks[0].type == "component"
        assert result.tasks[0].priority == "high"
        assert "file_path" in result.tasks[0].implementation_details
        assert len(result.tasks[0].acceptance_criteria) == 2

    def test_parse_warnings_and_questions(
        self, analyzer: ScreenshotAnalyzer, sample_analysis_response: dict
    ):
        """Parse warnings and questions."""
        response_text = json.dumps(sample_analysis_response)
        result = analyzer._parse_analysis_response(response_text)

        assert len(result.warnings) == 1
        assert "custom fonts" in result.warnings[0]
        assert len(result.questions) == 1
        assert "loading states" in result.questions[0]

    def test_parse_invalid_json_adds_warning(self, analyzer: ScreenshotAnalyzer):
        """Invalid JSON still succeeds with warning."""
        response_text = "This is not valid JSON"
        result = analyzer._parse_analysis_response(response_text)

        # Still marked as success but with warning
        assert result.success is True
        assert len(result.warnings) > 0
        assert any("not valid JSON" in w for w in result.warnings)
        assert "raw_response" in result.analysis_metadata

    def test_parse_partial_response(self, analyzer: ScreenshotAnalyzer):
        """Parse response with only some fields."""
        response_text = json.dumps({
            "components": [
                {"type": "button", "name": "Button", "description": "A button"},
            ],
        })
        result = analyzer._parse_analysis_response(response_text)

        assert result.success is True
        assert len(result.components) == 1
        assert result.layout is None
        assert result.colors is None
        assert result.typography is None

    def test_parse_empty_arrays(self, analyzer: ScreenshotAnalyzer):
        """Parse response with empty arrays."""
        response_text = json.dumps({
            "components": [],
            "tasks": [],
            "warnings": [],
            "questions": [],
        })
        result = analyzer._parse_analysis_response(response_text)

        assert result.success is True
        assert len(result.components) == 0
        assert len(result.tasks) == 0


# =============================================================================
# ANALYSIS RESULT TO DICT TESTS
# =============================================================================


class TestResultToDict:
    """Test AnalysisResult to dictionary conversion."""

    def test_to_dict_full_result(
        self, analyzer: ScreenshotAnalyzer, sample_analysis_response: dict
    ):
        """Convert full result to dictionary."""
        response_text = json.dumps(sample_analysis_response)
        result = analyzer._parse_analysis_response(response_text)
        result_dict = analyzer.to_dict(result)

        assert result_dict["success"] is True
        assert result_dict["error"] is None
        assert len(result_dict["components"]) == 2
        assert result_dict["layout"]["type"] == "dashboard"
        assert result_dict["colors"]["primary"] == "#007bff"
        assert result_dict["typography"]["heading_font"] == "Inter"

    def test_to_dict_empty_result(self, analyzer: ScreenshotAnalyzer):
        """Convert empty result to dictionary."""
        result = AnalysisResult(success=True)
        result_dict = analyzer.to_dict(result)

        assert result_dict["success"] is True
        assert result_dict["components"] == []
        assert result_dict["tasks"] == []
        assert result_dict["layout"] is None
        assert result_dict["colors"] is None

    def test_to_dict_error_result(self, analyzer: ScreenshotAnalyzer):
        """Convert error result to dictionary."""
        result = AnalysisResult(success=False, error="Something went wrong")
        result_dict = analyzer.to_dict(result)

        assert result_dict["success"] is False
        assert result_dict["error"] == "Something went wrong"


# =============================================================================
# ASYNC ANALYSIS TESTS
# =============================================================================


class TestAsyncAnalysis:
    """Test async analysis functionality."""

    @pytest.mark.asyncio
    async def test_analyze_validation_failure(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Analysis returns error on validation failure."""
        image = ImageAttachment(
            id="uuid-123",
            filename="test.pdf",
            mime_type="application/pdf",
            size=1024,
            data=valid_image_data,
        )
        result = await analyzer.analyze([image])

        assert result.success is False
        assert "Validation failed" in result.error

    @pytest.mark.asyncio
    async def test_analyze_empty_images(self, analyzer: ScreenshotAnalyzer):
        """Analysis returns error for empty images."""
        result = await analyzer.analyze([])

        assert result.success is False
        assert "No images provided" in result.error

    @pytest.mark.asyncio
    async def test_analyze_success_with_mock_api(
        self,
        analyzer: ScreenshotAnalyzer,
        valid_image_attachment: ImageAttachment,
        sample_analysis_response: dict,
    ):
        """Analysis succeeds with mocked API."""
        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze this UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(sample_analysis_response)
                ),
            ):
                result = await analyzer.analyze([valid_image_attachment])

        assert result.success is True
        assert len(result.components) == 2
        assert len(result.tasks) == 1

    @pytest.mark.asyncio
    async def test_analyze_with_project_context(
        self,
        analyzer: ScreenshotAnalyzer,
        valid_image_attachment: ImageAttachment,
        sample_analysis_response: dict,
    ):
        """Analysis includes project context."""
        with patch.object(
            analyzer, "_get_prompt_template", return_value="Analyze this UI:"
        ):
            with patch.object(
                analyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=analyzer._parse_analysis_response(
                    json.dumps(sample_analysis_response)
                ),
            ) as mock_api:
                result = await analyzer.analyze(
                    [valid_image_attachment], project_context="React + Tailwind"
                )

        assert result.success is True
        # Verify _build_multimodal_content was called (indirectly via _call_vision_api)
        mock_api.assert_called_once()


# =============================================================================
# VISION API CALL TESTS
# =============================================================================


class TestVisionAPICall:
    """Test vision API interaction."""

    @pytest.mark.asyncio
    async def test_call_vision_api_missing_sdk(self, analyzer: ScreenshotAnalyzer):
        """Returns error when SDK not installed."""
        with patch.dict("sys.modules", {"anthropic": None}):
            with patch("builtins.__import__", side_effect=ImportError):
                result = await analyzer._call_vision_api([], "claude-sonnet-4-20250514")

        assert result.success is False
        assert "not installed" in result.error

    @pytest.mark.asyncio
    async def test_call_vision_api_missing_api_key(self, analyzer: ScreenshotAnalyzer):
        """Returns error when API key missing."""
        # Remove only the specific API key environment variables while keeping system env
        env_without_keys = {
            k: v for k, v in os.environ.items()
            if k not in ("ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN")
        }
        with patch.dict("os.environ", env_without_keys, clear=True):
            result = await analyzer._call_vision_api(
                [], "claude-sonnet-4-20250514"
            )

        assert result.success is False
        assert "Missing API key" in result.error

    @pytest.mark.asyncio
    async def test_call_vision_api_success(
        self, analyzer: ScreenshotAnalyzer, sample_analysis_response: dict
    ):
        """Successful API call returns parsed result."""
        mock_response = MagicMock()
        mock_response.content = [
            MagicMock(text=json.dumps(sample_analysis_response))
        ]

        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)

        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            with patch("anthropic.AsyncAnthropic", return_value=mock_client):
                result = await analyzer._call_vision_api(
                    [{"type": "text", "text": "test"}],
                    "claude-sonnet-4-20250514",
                )

        assert result.success is True
        assert len(result.components) == 2


# =============================================================================
# CONVENIENCE FUNCTION TESTS
# =============================================================================


class TestConvenienceFunctions:
    """Test convenience functions."""

    @pytest.mark.asyncio
    async def test_analyze_screenshots_with_dicts(
        self, valid_image_data: str, sample_analysis_response: dict
    ):
        """analyze_screenshots works with dict input."""
        images = [
            {
                "id": "uuid-123",
                "filename": "test.png",
                "mime_type": "image/png",
                "size": 1024,
                "data": valid_image_data,
            }
        ]

        with patch.object(
            ScreenshotAnalyzer, "_get_prompt_template", return_value="Analyze:"
        ):
            with patch.object(
                ScreenshotAnalyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=ScreenshotAnalyzer()._parse_analysis_response(
                    json.dumps(sample_analysis_response)
                ),
            ):
                result = await analyze_screenshots(images)

        assert result["success"] is True

    @pytest.mark.asyncio
    async def test_analyze_screenshots_mimeType_alias(
        self, valid_image_data: str, sample_analysis_response: dict
    ):
        """analyze_screenshots handles mimeType alias."""
        images = [
            {
                "id": "uuid-123",
                "filename": "test.png",
                "mimeType": "image/png",  # Frontend format
                "size": 1024,
                "data": valid_image_data,
            }
        ]

        with patch.object(
            ScreenshotAnalyzer, "_get_prompt_template", return_value="Analyze:"
        ):
            with patch.object(
                ScreenshotAnalyzer,
                "_call_vision_api",
                new_callable=AsyncMock,
                return_value=ScreenshotAnalyzer()._parse_analysis_response(
                    json.dumps(sample_analysis_response)
                ),
            ):
                result = await analyze_screenshots(images)

        assert result["success"] is True

    def test_validate_screenshot_uploads_valid(self, valid_image_data: str):
        """validate_screenshot_uploads passes for valid images."""
        images = [
            {
                "id": "uuid-123",
                "filename": "test.png",
                "mime_type": "image/png",
                "size": 1024,
                "data": valid_image_data,
            }
        ]
        is_valid, errors = validate_screenshot_uploads(images)

        assert is_valid is True
        assert len(errors) == 0

    def test_validate_screenshot_uploads_invalid(self, valid_image_data: str):
        """validate_screenshot_uploads fails for invalid images."""
        images = [
            {
                "id": "uuid-123",
                "filename": "test.pdf",
                "mime_type": "application/pdf",
                "size": 1024,
                "data": valid_image_data,
            }
        ]
        is_valid, errors = validate_screenshot_uploads(images)

        assert is_valid is False
        assert len(errors) == 1
        assert errors[0]["image_id"] == "uuid-123"


# =============================================================================
# DATA CLASS TESTS
# =============================================================================


class TestDataClasses:
    """Test data class creation and defaults."""

    def test_extracted_component_defaults(self):
        """ExtractedComponent has correct defaults."""
        component = ExtractedComponent(
            type="button",
            name="Button",
            description="A button",
        )
        assert component.visual_details == {}
        assert component.variants == []
        assert component.states == []
        assert component.count_in_design == 1

    def test_generated_task_defaults(self):
        """GeneratedTask has correct defaults."""
        task = GeneratedTask(
            title="Task",
            description="Description",
            type="component",
            priority="medium",
        )
        assert task.implementation_details == {}
        assert task.acceptance_criteria == []

    def test_layout_info_defaults(self):
        """LayoutInfo has correct defaults."""
        layout = LayoutInfo(type="dashboard", structure="Grid layout")
        assert layout.grid is None
        assert layout.container_max_width is None

    def test_color_palette_defaults(self):
        """ColorPalette has all None defaults."""
        colors = ColorPalette()
        assert colors.primary is None
        assert colors.secondary is None
        assert colors.background is None

    def test_typography_defaults(self):
        """Typography has all None defaults."""
        typography = Typography()
        assert typography.heading_font is None
        assert typography.body_font is None
        assert typography.h1_size is None

    def test_analysis_result_defaults(self):
        """AnalysisResult has correct defaults."""
        result = AnalysisResult()
        assert result.success is False
        assert result.error is None
        assert result.components == []
        assert result.tasks == []
        assert result.warnings == []

    def test_validation_error_creation(self):
        """ValidationError stores all fields."""
        error = ValidationError(
            image_id="uuid-123",
            filename="test.png",
            error="File too large",
        )
        assert error.image_id == "uuid-123"
        assert error.filename == "test.png"
        assert error.error == "File too large"


# =============================================================================
# CONSTANTS TESTS
# =============================================================================


class TestConstants:
    """Test module constants."""

    def test_max_file_size(self):
        """Max file size is 10MB."""
        assert MAX_FILE_SIZE_BYTES == 10 * 1024 * 1024

    def test_max_screenshots(self):
        """Max screenshots is 10."""
        assert MAX_SCREENSHOTS == 10

    def test_allowed_mime_types(self):
        """All expected MIME types are allowed."""
        expected = {
            # Images
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/gif",
            "image/webp",
            "image/svg+xml",
            # Documents
            "application/pdf",
            # Archives
            "application/zip",
            "application/x-zip-compressed",
            "application/x-rar-compressed",
            "application/x-7z-compressed",
        }
        assert ALLOWED_MIME_TYPES == expected


# =============================================================================
# SECURITY TESTS
# =============================================================================


class TestFileSecurity:
    """Test file upload security."""

    def test_file_size_validation(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """File size limit is enforced."""
        # Just over 10MB
        image = ImageAttachment(
            id="uuid-123",
            filename="large.png",
            mime_type="image/png",
            size=MAX_FILE_SIZE_BYTES + 1,
            data=valid_image_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is False
        assert any("too large" in e.error.lower() for e in errors)

    def test_mime_type_validation(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Only image MIME types are allowed."""
        dangerous_types = [
            "application/javascript",
            "text/html",
            "application/x-php",
            "application/octet-stream",
            "application/pdf",
        ]
        for mime_type in dangerous_types:
            image = ImageAttachment(
                id="uuid-123",
                filename="test.bin",
                mime_type=mime_type,
                size=1024,
                data=valid_image_data,
            )
            is_valid, errors, warnings = analyzer.validate_images([image])
            assert is_valid is False, f"MIME type {mime_type} should be rejected"

    def test_base64_decoding_validation(self, analyzer: ScreenshotAnalyzer):
        """Invalid base64 is rejected."""
        image = ImageAttachment(
            id="uuid-123",
            filename="test.png",
            mime_type="image/png",
            size=1024,
            data="<script>alert('xss')</script>",
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is False

    def test_max_image_count_enforced(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Maximum image count is enforced."""
        images = [
            ImageAttachment(
                id=f"uuid-{i}",
                filename=f"image{i}.png",
                mime_type="image/png",
                size=1024,
                data=valid_image_data,
            )
            for i in range(MAX_SCREENSHOTS + 5)
        ]
        is_valid, errors, warnings = analyzer.validate_images(images)
        assert is_valid is False
        assert any("Too many images" in e.error for e in errors)

    def test_path_traversal_prevention(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Path traversal attempts in filenames are blocked."""
        dangerous_filenames = [
            "../../../etc/passwd.png",
            "..\\..\\windows\\system32.png",
            "/etc/passwd.png",
            "\\windows\\system32.png",
        ]
        for filename in dangerous_filenames:
            image = ImageAttachment(
                id="uuid-123",
                filename=filename,
                mime_type="image/png",
                size=1024,
                data=valid_image_data,
            )
            is_valid, errors, warnings = analyzer.validate_images([image])
            assert is_valid is False, f"Filename '{filename}' should be rejected"
            assert any("dangerous pattern" in e.error.lower() or "invalid filename" in e.error.lower() for e in errors)

    def test_null_byte_injection_prevention(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Null bytes in filenames are blocked."""
        image = ImageAttachment(
            id="uuid-123",
            filename="image\x00.php.png",
            mime_type="image/png",
            size=1024,
            data=valid_image_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is False
        assert any("dangerous pattern" in e.error.lower() or "invalid filename" in e.error.lower() for e in errors)

    def test_control_character_prevention(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Control characters in filenames are blocked."""
        # Test various control characters
        for char_code in [0x01, 0x0A, 0x0D, 0x1B]:  # SOH, LF, CR, ESC
            filename = f"image{chr(char_code)}test.png"
            image = ImageAttachment(
                id="uuid-123",
                filename=filename,
                mime_type="image/png",
                size=1024,
                data=valid_image_data,
            )
            is_valid, errors, warnings = analyzer.validate_images([image])
            assert is_valid is False, f"Control char 0x{char_code:02x} should be rejected"


class TestFilenameSecurity:
    """Test filename security validation function."""

    def test_valid_filename(self):
        """Valid filenames pass."""
        valid_names = [
            "screenshot.png",
            "my-image.jpg",
            "test_file_123.gif",
            "image (1).png",
            "日本語.png",
            "émoji-🎨.png",
        ]
        for name in valid_names:
            is_valid, error = validate_filename_security(name)
            assert is_valid is True, f"Filename '{name}' should be valid: {error}"

    def test_empty_filename(self):
        """Empty filename is rejected."""
        is_valid, error = validate_filename_security("")
        assert is_valid is False
        assert "empty" in error.lower()

    def test_path_traversal_blocked(self):
        """Path traversal patterns are blocked."""
        dangerous = [
            "../image.png",
            "../../etc/passwd",
            "foo/../bar.png",
        ]
        for name in dangerous:
            is_valid, error = validate_filename_security(name)
            assert is_valid is False, f"'{name}' should be blocked"

    def test_absolute_paths_blocked(self):
        """Absolute paths are blocked."""
        is_valid, error = validate_filename_security("/etc/passwd.png")
        assert is_valid is False

    def test_excessive_length_blocked(self):
        """Excessively long filenames are blocked."""
        long_name = "a" * (MAX_FILENAME_LENGTH + 1) + ".png"
        is_valid, error = validate_filename_security(long_name)
        assert is_valid is False
        assert "too long" in error.lower()


class TestMagicBytesValidation:
    """Test magic bytes validation for file type spoofing prevention."""

    def test_valid_png_magic_bytes(self):
        """Valid PNG magic bytes pass."""
        png_header = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        is_valid, error = validate_magic_bytes(png_header, "image/png")
        assert is_valid is True

    def test_valid_jpeg_magic_bytes(self):
        """Valid JPEG magic bytes pass."""
        jpeg_header = b"\xff\xd8\xff" + b"\x00" * 100
        is_valid, error = validate_magic_bytes(jpeg_header, "image/jpeg")
        assert is_valid is True

    def test_valid_gif_magic_bytes(self):
        """Valid GIF magic bytes pass."""
        # Test both GIF87a and GIF89a
        for signature in [b"GIF87a", b"GIF89a"]:
            gif_header = signature + b"\x00" * 100
            is_valid, error = validate_magic_bytes(gif_header, "image/gif")
            assert is_valid is True

    def test_valid_webp_magic_bytes(self):
        """Valid WebP magic bytes pass."""
        # WebP: RIFF....WEBP
        webp_header = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 100
        is_valid, error = validate_magic_bytes(webp_header, "image/webp")
        assert is_valid is True

    def test_valid_svg_content(self):
        """Valid SVG content passes."""
        svg_contents = [
            b'<?xml version="1.0"?><svg></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            b'<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg></svg>',
        ]
        for content in svg_contents:
            is_valid, error = validate_magic_bytes(content, "image/svg+xml")
            assert is_valid is True

    def test_spoofed_mime_type_blocked(self):
        """File claiming to be PNG but containing HTML is blocked."""
        html_content = b"<!DOCTYPE html><html><script>alert(1)</script></html>"
        is_valid, error = validate_magic_bytes(html_content, "image/png")
        assert is_valid is False
        assert "does not match" in error.lower()

    def test_javascript_disguised_as_image_blocked(self):
        """JavaScript disguised as image is blocked."""
        js_content = b"function exploit() { /* malicious */ }" + b"\x00" * 100
        is_valid, error = validate_magic_bytes(js_content, "image/png")
        assert is_valid is False

    def test_file_too_short_rejected(self):
        """File too short to validate is rejected."""
        is_valid, error = validate_magic_bytes(b"\x89PNG", "image/png")
        assert is_valid is False
        assert "too short" in error.lower()


class TestBase64Security:
    """Test safe base64 decoding."""

    def test_valid_base64_decodes(self):
        """Valid base64 decodes correctly."""
        original = b"Hello, World!"
        encoded = base64.b64encode(original).decode()
        decoded, error = decode_base64_safely(encoded)
        assert decoded == original
        assert error == ""

    def test_data_url_handled(self):
        """Data URL format is handled."""
        original = b"test data"
        encoded = base64.b64encode(original).decode()
        data_url = f"data:image/png;base64,{encoded}"
        decoded, error = decode_base64_safely(data_url)
        assert decoded == original

    def test_empty_data_rejected(self):
        """Empty data is rejected."""
        decoded, error = decode_base64_safely("")
        assert decoded is None
        assert "empty" in error.lower()

    def test_invalid_base64_rejected(self):
        """Invalid base64 is rejected."""
        decoded, error = decode_base64_safely("not valid base64!!!")
        assert decoded is None
        assert "invalid" in error.lower() or "error" in error.lower()

    def test_malformed_data_url_rejected(self):
        """Malformed data URL is rejected."""
        decoded, error = decode_base64_safely("data:image/png;base64")  # No comma
        assert decoded is None

    def test_excessive_padding_rejected(self):
        """Excessive base64 padding is rejected."""
        decoded, error = decode_base64_safely("dGVzdA====")  # 4 = signs
        assert decoded is None
        assert "padding" in error.lower()


class TestContentSizeValidation:
    """Test content size validation."""

    def test_valid_size_passes(self):
        """Valid size passes."""
        data = b"x" * 1000
        is_valid, error = validate_content_size(data, 1000)
        assert is_valid is True

    def test_undersized_report_allowed(self):
        """Slightly undersized report is allowed."""
        data = b"x" * 1000
        # Reported 800, actual 1000 - within 2x tolerance
        is_valid, error = validate_content_size(data, 800)
        assert is_valid is True

    def test_severely_oversized_actual_rejected(self):
        """Content much larger than reported is rejected."""
        data = b"x" * 10000
        # Claimed 1000, actual 10000 - way over 2x
        is_valid, error = validate_content_size(data, 1000)
        assert is_valid is False
        assert "mismatch" in error.lower()

    def test_exceeds_max_size_rejected(self):
        """Content exceeding max size is rejected."""
        # Create data larger than 10MB
        data = b"x" * (MAX_FILE_SIZE_BYTES + 1000)
        is_valid, error = validate_content_size(data, MAX_FILE_SIZE_BYTES + 1000)
        assert is_valid is False
        assert "too large" in error.lower()


class TestSecurityConstants:
    """Test security-related constants are properly defined."""

    def test_magic_bytes_defined(self):
        """Magic bytes are defined for main image types."""
        assert "image/png" in IMAGE_MAGIC_BYTES
        assert "image/jpeg" in IMAGE_MAGIC_BYTES
        assert "image/gif" in IMAGE_MAGIC_BYTES
        assert "image/webp" in IMAGE_MAGIC_BYTES

    def test_svg_markers_defined(self):
        """SVG markers are defined."""
        assert len(SVG_MARKERS) > 0
        assert any(b"svg" in marker.lower() for marker in SVG_MARKERS)

    def test_dangerous_patterns_defined(self):
        """Dangerous filename patterns are defined."""
        assert len(DANGEROUS_FILENAME_PATTERNS) > 0
        # Should include path traversal pattern (regex escaped as \.\.)
        assert any("\\." in p or ".." in p for p in DANGEROUS_FILENAME_PATTERNS)


# =============================================================================
# EDGE CASE TESTS
# =============================================================================


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_exact_max_file_size(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """File exactly at max size passes."""
        image = ImageAttachment(
            id="uuid-123",
            filename="maxsize.png",
            mime_type="image/png",
            size=MAX_FILE_SIZE_BYTES,  # Exactly 10MB
            data=valid_image_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is True

    def test_exact_max_screenshots(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Exactly max screenshots passes."""
        images = [
            ImageAttachment(
                id=f"uuid-{i}",
                filename=f"image{i}.png",
                mime_type="image/png",
                size=1024,
                data=valid_image_data,
            )
            for i in range(MAX_SCREENSHOTS)
        ]
        is_valid, errors, warnings = analyzer.validate_images(images)
        assert is_valid is True

    def test_special_characters_in_filename(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Special characters in filename are handled."""
        image = ImageAttachment(
            id="uuid-123",
            filename="screenshot (1) - copy.png",
            mime_type="image/png",
            size=1024,
            data=valid_image_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is True

    def test_unicode_in_filename(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Unicode in filename is handled."""
        image = ImageAttachment(
            id="uuid-123",
            filename="截图.png",
            mime_type="image/png",
            size=1024,
            data=valid_image_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is True

    def test_very_long_filename_at_limit(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Filename at max length limit is handled."""
        # MAX_FILENAME_LENGTH is 255, so use 251 chars + ".png" (4 chars) = 255
        image = ImageAttachment(
            id="uuid-123",
            filename="a" * 251 + ".png",
            mime_type="image/png",
            size=1024,
            data=valid_image_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is True

    def test_filename_exceeds_max_length_rejected(
        self, analyzer: ScreenshotAnalyzer, valid_image_data: str
    ):
        """Filename exceeding max length is rejected."""
        # 255 + 4 = 259 chars, exceeds limit
        image = ImageAttachment(
            id="uuid-123",
            filename="a" * 255 + ".png",
            mime_type="image/png",
            size=1024,
            data=valid_image_data,
        )
        is_valid, errors, warnings = analyzer.validate_images([image])
        assert is_valid is False
        assert any("too long" in e.error.lower() for e in errors)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
