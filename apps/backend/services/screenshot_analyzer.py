#!/usr/bin/env python3
"""
Screenshot Analyzer Service
===========================

Analyzes design screenshots using Claude's vision capabilities to extract
UI components, layout structure, and generate actionable implementation tasks.

This service integrates with the Claude API to perform multimodal analysis
of uploaded screenshots, converting visual designs into specific development tasks.

Usage:
    from services.screenshot_analyzer import analyze_screenshots, ScreenshotAnalyzer

    # Using the convenience function
    result = await analyze_screenshots(images, project_context)

    # Using the class directly
    analyzer = ScreenshotAnalyzer()
    result = await analyzer.analyze(images, project_context)
"""

import base64
import binascii
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# =============================================================================
# CONSTANTS
# =============================================================================

# Maximum file size for screenshots (10MB)
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

# Maximum number of screenshots per analysis
MAX_SCREENSHOTS = 10

# Maximum filename length
MAX_FILENAME_LENGTH = 255

# Maximum file size for PDFs/archives (20MB)
MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024

# Allowed MIME types for screenshots and attachments
ALLOWED_MIME_TYPES = frozenset([
    # Images
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    # Documents
    "application/pdf",
    # Archives (can contain multiple images)
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
])

# File magic bytes (file signatures) for content validation
# Maps MIME type to list of possible magic byte sequences
FILE_MAGIC_BYTES: dict[str, list[bytes]] = {
    # Images
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/jpg": [b"\xff\xd8\xff"],  # Same as jpeg
    "image/gif": [b"GIF87a", b"GIF89a"],
    "image/webp": [b"RIFF"],  # WebP starts with RIFF, then has WEBP after size
    # Documents
    "application/pdf": [b"%PDF-"],
    # Archives
    "application/zip": [b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"],
    "application/x-zip-compressed": [b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"],
    "application/x-rar-compressed": [b"Rar!\x1a\x07\x00", b"Rar!\x1a\x07\x01\x00"],
    "application/x-7z-compressed": [b"7z\xbc\xaf'\x1c"],
}
# Backward compatibility alias
IMAGE_MAGIC_BYTES = FILE_MAGIC_BYTES
# SVG is text-based, so we check for XML/SVG markers instead
SVG_MARKERS = [b"<?xml", b"<svg", b"<!DOCTYPE svg"]

# Dangerous patterns in filenames (security: prevent path traversal)
DANGEROUS_FILENAME_PATTERNS = [
    r"\.\.",           # Parent directory traversal
    r"^/",             # Absolute path
    r"^\\",            # Windows absolute path
    r"[\x00-\x1f]",    # Control characters including null bytes
    r"[<>:\"|?*]",     # Windows reserved characters
]

# Path to the prompt template
PROMPT_TEMPLATE_PATH = Path(__file__).parent.parent / "prompts" / "screenshot_analysis.txt"

# Minimum recommended image dimensions for quality analysis
MIN_RECOMMENDED_WIDTH = 400
MIN_RECOMMENDED_HEIGHT = 300

# Minimum file size that suggests reasonable quality (50KB)
MIN_REASONABLE_FILE_SIZE = 50 * 1024

# Threshold for complex designs (many tasks)
COMPLEX_DESIGN_THRESHOLD = 20


# =============================================================================
# SECURITY VALIDATION FUNCTIONS
# =============================================================================


def validate_filename_security(filename: str) -> tuple[bool, str]:
    """
    Validate filename for security issues.

    Checks for:
    - Path traversal attempts (..)
    - Absolute paths
    - Control characters (including null bytes)
    - Reserved characters
    - Excessive length

    Args:
        filename: The filename to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not filename:
        return False, "Filename is empty"

    if len(filename) > MAX_FILENAME_LENGTH:
        return False, f"Filename too long: {len(filename)} exceeds {MAX_FILENAME_LENGTH}"

    for pattern in DANGEROUS_FILENAME_PATTERNS:
        if re.search(pattern, filename):
            return False, f"Filename contains dangerous pattern: {filename}"

    return True, ""


def validate_magic_bytes(data: bytes, mime_type: str) -> tuple[bool, str]:
    """
    Validate that file content matches claimed MIME type via magic bytes.

    This prevents file type spoofing where an attacker claims a file is
    an image but the actual content is something else (like HTML/JS).

    Args:
        data: Raw decoded file bytes
        mime_type: Claimed MIME type

    Returns:
        Tuple of (is_valid, error_message)
    """
    if len(data) < 8:
        return False, "File content too short to validate"

    # Handle SVG separately (text-based)
    if mime_type == "image/svg+xml":
        # Check for SVG markers in first 1024 bytes
        header = data[:1024]
        for marker in SVG_MARKERS:
            if marker.lower() in header.lower():
                return True, ""
        return False, "File content does not appear to be SVG"

    # Check binary file magic bytes
    if mime_type in FILE_MAGIC_BYTES:
        magic_sequences = FILE_MAGIC_BYTES[mime_type]
        for magic in magic_sequences:
            if data.startswith(magic):
                # Special case for WebP: verify WEBP signature at offset 8
                if mime_type == "image/webp":
                    if len(data) >= 12 and data[8:12] == b"WEBP":
                        return True, ""
                    # Allow if it starts with RIFF but can't verify WEBP
                    # (file might be truncated for size check)
                    if len(data) < 12:
                        return True, ""
                else:
                    return True, ""

        return False, f"File content does not match {mime_type} signature"

    # Unknown MIME type - allow but warn
    return True, ""


def decode_base64_safely(data: str) -> tuple[bytes | None, str]:
    """
    Safely decode base64 data with security checks.

    Args:
        data: Base64 encoded string

    Returns:
        Tuple of (decoded_bytes or None, error_message)
    """
    if not data:
        return None, "Empty data"

    # Check for data URL prefix and strip it if present
    if data.startswith("data:"):
        # Extract base64 portion after comma
        parts = data.split(",", 1)
        if len(parts) != 2:
            return None, "Invalid data URL format"
        data = parts[1]

    # Remove any whitespace (base64 shouldn't have it but be lenient)
    data = data.strip()

    # Check for suspiciously large padding
    if data.endswith("===="):
        return None, "Invalid base64 padding"

    try:
        decoded = base64.b64decode(data, validate=True)
        return decoded, ""
    except binascii.Error as e:
        return None, f"Invalid base64 encoding: {e}"
    except ValueError as e:
        return None, f"Base64 decode error: {e}"


def detect_low_quality_image(data: bytes, reported_size: int, filename: str) -> str | None:
    """
    Detect potential low-quality images based on file size.

    Very small images or heavily compressed images may not provide
    enough detail for accurate analysis.

    Args:
        data: Decoded file bytes
        reported_size: Reported file size
        filename: Filename for warning message

    Returns:
        Warning message if low quality detected, None otherwise
    """
    actual_size = len(data) if data else reported_size

    # Very small files are likely low quality
    if actual_size < MIN_REASONABLE_FILE_SIZE:
        size_kb = actual_size / 1024
        return (
            f'"{filename}" is very small ({size_kb:.1f}KB). '
            "Consider uploading a higher resolution screenshot for better analysis."
        )

    return None


def validate_content_size(decoded_data: bytes, reported_size: int) -> tuple[bool, str]:
    """
    Validate that decoded content size is consistent with reported size.

    This detects potential size manipulation attacks where the reported
    size differs significantly from actual content.

    Args:
        decoded_data: Decoded file bytes
        reported_size: Size reported by the client

    Returns:
        Tuple of (is_valid, error_message)
    """
    actual_size = len(decoded_data)

    # Allow some tolerance for base64 encoding overhead differences
    # Base64 adds ~33% overhead, but reported size should be close to actual
    # We allow up to 50% difference to account for thumbnail vs full image
    # and encoding variations
    if reported_size > 0:
        # If actual size is much larger than reported, that's suspicious
        if actual_size > reported_size * 2:
            return False, f"Content size mismatch: actual {actual_size} >> reported {reported_size}"

    # Check against maximum size using actual decoded size
    if actual_size > MAX_FILE_SIZE_BYTES:
        size_mb = actual_size / (1024 * 1024)
        return False, f"Decoded content too large: {size_mb:.1f}MB exceeds 10MB limit"

    return True, ""


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class ImageAttachment:
    """
    Represents an uploaded image attachment for analysis.

    Matches the frontend ImageAttachment type structure.

    Attributes:
        id: Unique identifier (UUID)
        filename: Original filename
        mime_type: MIME type (e.g., 'image/png')
        size: Size in bytes
        data: Base64 encoded image data (without data URL prefix)
        thumbnail: Optional base64 thumbnail for preview
    """

    id: str
    filename: str
    mime_type: str
    size: int
    data: str
    thumbnail: str | None = None


@dataclass
class ExtractedComponent:
    """
    A UI component extracted from screenshot analysis.

    Attributes:
        type: Component type (button, input, card, etc.)
        name: Suggested component name (PascalCase)
        description: What the component does
        visual_details: Styling details (colors, spacing, etc.)
        variants: Possible variants (primary, secondary, etc.)
        states: Interactive states (hover, disabled, etc.)
        count_in_design: Number of times this component appears
    """

    type: str
    name: str
    description: str
    visual_details: dict[str, Any] = field(default_factory=dict)
    variants: list[str] = field(default_factory=list)
    states: list[str] = field(default_factory=list)
    count_in_design: int = 1


@dataclass
class GeneratedTask:
    """
    An implementation task generated from screenshot analysis.

    Attributes:
        title: Task title (imperative, specific)
        description: Detailed description of what to implement
        type: Task type (component, layout, feature, etc.)
        priority: Priority level (high, medium, low)
        implementation_details: Specific implementation guidance
        acceptance_criteria: What defines "done"
    """

    title: str
    description: str
    type: str
    priority: str
    implementation_details: dict[str, Any] = field(default_factory=dict)
    acceptance_criteria: list[str] = field(default_factory=list)


@dataclass
class LayoutInfo:
    """
    Layout structure extracted from screenshots.

    Attributes:
        type: Layout type (sidebar-layout, dashboard, etc.)
        structure: Description of layout structure
        grid: Grid system details
        container_max_width: Maximum container width
    """

    type: str
    structure: str
    grid: str | None = None
    container_max_width: str | None = None


@dataclass
class ColorPalette:
    """
    Color palette extracted from screenshots.

    Attributes:
        primary: Primary brand color
        secondary: Secondary accent color
        success: Success state color
        warning: Warning state color
        error: Error state color
        background: Page background color
        surface: Surface/card background color
        text_primary: Primary text color
        text_secondary: Secondary text color
        border: Border color
    """

    primary: str | None = None
    secondary: str | None = None
    success: str | None = None
    warning: str | None = None
    error: str | None = None
    background: str | None = None
    surface: str | None = None
    text_primary: str | None = None
    text_secondary: str | None = None
    border: str | None = None


@dataclass
class Typography:
    """
    Typography patterns extracted from screenshots.

    Attributes:
        heading_font: Font family for headings
        body_font: Font family for body text
        h1_size: Heading 1 font size
        h2_size: Heading 2 font size
        body_size: Body text font size
        small_size: Small text font size
    """

    heading_font: str | None = None
    body_font: str | None = None
    h1_size: str | None = None
    h2_size: str | None = None
    body_size: str | None = None
    small_size: str | None = None


@dataclass
class AnalysisResult:
    """
    Complete result of screenshot analysis.

    Attributes:
        success: Whether analysis completed successfully
        error: Error message if analysis failed
        components: Extracted UI components
        layout: Layout structure information
        colors: Extracted color palette
        typography: Typography patterns
        tasks: Generated implementation tasks
        warnings: Any warnings from analysis
        questions: Clarifying questions for user
        analysis_metadata: Additional metadata about the analysis
    """

    success: bool = False
    error: str | None = None
    components: list[ExtractedComponent] = field(default_factory=list)
    layout: LayoutInfo | None = None
    colors: ColorPalette | None = None
    typography: Typography | None = None
    tasks: list[GeneratedTask] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)
    analysis_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ValidationError:
    """
    Validation error for screenshot uploads.

    Attributes:
        image_id: ID of the problematic image
        filename: Filename of the problematic image
        error: Error description
    """

    image_id: str
    filename: str
    error: str


# =============================================================================
# SCREENSHOT ANALYZER
# =============================================================================


class ScreenshotAnalyzer:
    """
    Analyzes design screenshots to extract components and generate tasks.

    Uses Claude's vision capabilities to understand UI designs and
    convert them into actionable development tasks.
    """

    def __init__(self) -> None:
        """Initialize the screenshot analyzer."""
        self._prompt_template: str | None = None

    def _get_prompt_template(self) -> str:
        """
        Load the vision prompt template.

        Returns:
            The prompt template string

        Raises:
            FileNotFoundError: If prompt template doesn't exist
        """
        if self._prompt_template is None:
            if not PROMPT_TEMPLATE_PATH.exists():
                raise FileNotFoundError(
                    f"Screenshot analysis prompt template not found: {PROMPT_TEMPLATE_PATH}"
                )
            self._prompt_template = PROMPT_TEMPLATE_PATH.read_text(encoding="utf-8")
        return self._prompt_template

    def validate_images(
        self, images: list[ImageAttachment]
    ) -> tuple[bool, list[ValidationError], list[str]]:
        """
        Validate uploaded images for analysis with comprehensive security checks.

        Security validations performed:
        - Maximum image count enforcement
        - MIME type allowlist validation
        - File size limits (reported and actual)
        - Filename security (path traversal, control chars)
        - Base64 encoding validation
        - Magic bytes verification (content matches claimed type)
        - Content size consistency check

        Also detects edge cases:
        - Low quality/small images (warning only)

        Args:
            images: List of ImageAttachment objects to validate

        Returns:
            Tuple of (is_valid, errors, warnings)
        """
        errors: list[ValidationError] = []
        warnings: list[str] = []

        if not images:
            errors.append(
                ValidationError(
                    image_id="",
                    filename="",
                    error="No images provided for analysis",
                )
            )
            return False, errors, warnings

        if len(images) > MAX_SCREENSHOTS:
            errors.append(
                ValidationError(
                    image_id="",
                    filename="",
                    error=f"Too many images: {len(images)} exceeds maximum of {MAX_SCREENSHOTS}",
                )
            )
            return False, errors, warnings

        for image in images:
            # Security: Validate filename for path traversal and injection
            filename_valid, filename_error = validate_filename_security(image.filename)
            if not filename_valid:
                errors.append(
                    ValidationError(
                        image_id=image.id,
                        filename=image.filename,
                        error=f"Invalid filename: {filename_error}",
                    )
                )
                continue  # Skip further validation for this image

            # Check MIME type against allowlist
            if image.mime_type not in ALLOWED_MIME_TYPES:
                errors.append(
                    ValidationError(
                        image_id=image.id,
                        filename=image.filename,
                        error=f"Invalid file type: {image.mime_type}. Allowed: PNG, JPEG, GIF, WebP, SVG, PDF, ZIP, RAR, 7Z",
                    )
                )
                continue

            # Check reported file size (different limits for different file types)
            is_image = image.mime_type.startswith("image/")
            max_size = MAX_FILE_SIZE_BYTES if is_image else MAX_ATTACHMENT_SIZE_BYTES
            max_size_mb = max_size / (1024 * 1024)
            if image.size > max_size:
                size_mb = image.size / (1024 * 1024)
                errors.append(
                    ValidationError(
                        image_id=image.id,
                        filename=image.filename,
                        error=f"File too large: {size_mb:.1f}MB exceeds maximum of {max_size_mb:.0f}MB",
                    )
                )
                continue

            # Check base64 data exists
            if not image.data:
                errors.append(
                    ValidationError(
                        image_id=image.id,
                        filename=image.filename,
                        error="Missing image data",
                    )
                )
                continue

            # Security: Safely decode base64 with validation
            decoded_data, decode_error = decode_base64_safely(image.data)
            if decoded_data is None:
                errors.append(
                    ValidationError(
                        image_id=image.id,
                        filename=image.filename,
                        error=f"Invalid base64 encoding: {decode_error}",
                    )
                )
                continue

            # Security: Validate actual content size
            size_valid, size_error = validate_content_size(decoded_data, image.size)
            if not size_valid:
                errors.append(
                    ValidationError(
                        image_id=image.id,
                        filename=image.filename,
                        error=size_error,
                    )
                )
                continue

            # Security: Validate magic bytes (content matches claimed MIME type)
            magic_valid, magic_error = validate_magic_bytes(decoded_data, image.mime_type)
            if not magic_valid:
                errors.append(
                    ValidationError(
                        image_id=image.id,
                        filename=image.filename,
                        error=f"Content validation failed: {magic_error}",
                    )
                )
                continue

            # Edge case: Check for low quality images (warning only, not a validation error)
            quality_warning = detect_low_quality_image(decoded_data, image.size, image.filename)
            if quality_warning:
                warnings.append(quality_warning)

        return len(errors) == 0, errors, warnings

    def _build_multimodal_content(
        self, images: list[ImageAttachment], project_context: str | None = None
    ) -> list[dict[str, Any]]:
        """
        Build multimodal message content with images for the vision API.

        Args:
            images: List of validated ImageAttachment objects
            project_context: Optional project context to include

        Returns:
            List of content blocks for the message
        """
        content: list[dict[str, Any]] = []

        # Add text prompt first
        prompt_template = self._get_prompt_template()

        # Build the text prompt with optional project context
        text_prompt = prompt_template
        if project_context:
            text_prompt = f"{text_prompt}\n\n## PROJECT CONTEXT\n\n{project_context}"

        text_prompt += f"\n\n## SCREENSHOTS PROVIDED\n\nAnalyzing {len(images)} screenshot(s):"
        for i, img in enumerate(images, 1):
            text_prompt += f"\n{i}. {img.filename} ({img.mime_type})"

        content.append({
            "type": "text",
            "text": text_prompt,
        })

        # Add each image as a content block
        for image in images:
            # Normalize MIME type (jpeg vs jpg)
            media_type = image.mime_type
            if media_type == "image/jpg":
                media_type = "image/jpeg"

            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": image.data,
                },
            })

        return content

    def _parse_analysis_response(self, response_text: str) -> AnalysisResult:
        """
        Parse the JSON response from Claude into structured result.

        Args:
            response_text: Raw response text from Claude

        Returns:
            Parsed AnalysisResult
        """
        result = AnalysisResult(success=True)

        try:
            # Try to extract JSON from the response
            # Claude may wrap the JSON in markdown code blocks
            json_text = response_text.strip()

            # Remove markdown code block if present
            if json_text.startswith("```json"):
                json_text = json_text[7:]
            elif json_text.startswith("```"):
                json_text = json_text[3:]

            if json_text.endswith("```"):
                json_text = json_text[:-3]

            json_text = json_text.strip()

            # Parse the JSON
            data = json.loads(json_text)

            # Extract analysis metadata
            if "analysis" in data:
                result.analysis_metadata = data["analysis"]

            # Extract components
            if "components" in data:
                for comp in data["components"]:
                    result.components.append(
                        ExtractedComponent(
                            type=comp.get("type", "unknown"),
                            name=comp.get("name", "Component"),
                            description=comp.get("description", ""),
                            visual_details=comp.get("visual_details", {}),
                            variants=comp.get("variants", []),
                            states=comp.get("states", []),
                            count_in_design=comp.get("count_in_design", 1),
                        )
                    )

            # Extract layout
            if "layout" in data and isinstance(data["layout"], dict):
                layout_data = data["layout"]
                result.layout = LayoutInfo(
                    type=layout_data.get("type", "unknown"),
                    structure=layout_data.get("structure", ""),
                    grid=layout_data.get("grid"),
                    container_max_width=layout_data.get("container_max_width"),
                )

            # Extract colors
            if "colors" in data and isinstance(data["colors"], dict):
                colors_data = data["colors"]
                result.colors = ColorPalette(
                    primary=colors_data.get("primary"),
                    secondary=colors_data.get("secondary"),
                    success=colors_data.get("success"),
                    warning=colors_data.get("warning"),
                    error=colors_data.get("error"),
                    background=colors_data.get("background"),
                    surface=colors_data.get("surface"),
                    text_primary=colors_data.get("text_primary"),
                    text_secondary=colors_data.get("text_secondary"),
                    border=colors_data.get("border"),
                )

            # Extract typography
            if "typography" in data and isinstance(data["typography"], dict):
                typo_data = data["typography"]
                result.typography = Typography(
                    heading_font=typo_data.get("heading_font"),
                    body_font=typo_data.get("body_font"),
                    h1_size=typo_data.get("h1_size"),
                    h2_size=typo_data.get("h2_size"),
                    body_size=typo_data.get("body_size"),
                    small_size=typo_data.get("small_size"),
                )

            # Extract tasks
            if "tasks" in data:
                for task in data["tasks"]:
                    result.tasks.append(
                        GeneratedTask(
                            title=task.get("title", "Untitled Task"),
                            description=task.get("description", ""),
                            type=task.get("type", "component"),
                            priority=task.get("priority", "medium"),
                            implementation_details=task.get("implementation_details", {}),
                            acceptance_criteria=task.get("acceptance_criteria", []),
                        )
                    )

            # Extract warnings and questions
            result.warnings = data.get("warnings", [])
            result.questions = data.get("questions", [])

        except json.JSONDecodeError as e:
            # If JSON parsing fails, try to extract useful info anyway
            result.success = True  # Still consider it a success
            result.warnings.append(f"Response was not valid JSON: {str(e)}")
            result.analysis_metadata["raw_response"] = response_text

        return result

    async def analyze(
        self,
        images: list[ImageAttachment],
        project_context: str | None = None,
        model: str = "claude-sonnet-4-20250514",
    ) -> AnalysisResult:
        """
        Analyze screenshots to extract components and generate tasks.

        Args:
            images: List of ImageAttachment objects to analyze
            project_context: Optional project context (tech stack, conventions, etc.)
            model: Claude model to use for analysis

        Returns:
            AnalysisResult with extracted components and generated tasks
        """
        # Validate images first
        is_valid, validation_errors, validation_warnings = self.validate_images(images)
        if not is_valid:
            error_messages = [f"{e.filename}: {e.error}" for e in validation_errors]
            return AnalysisResult(
                success=False,
                error=f"Validation failed: {'; '.join(error_messages)}",
            )

        try:
            # Build multimodal content
            content = self._build_multimodal_content(images, project_context)

            # Call Claude API with vision
            result = await self._call_vision_api(content, model)

            # Add validation warnings to result warnings
            if validation_warnings:
                result.warnings = validation_warnings + result.warnings

            # Add complex design warning if applicable
            if len(result.tasks) >= COMPLEX_DESIGN_THRESHOLD:
                result.warnings.insert(
                    0,
                    f"This design contains {len(result.tasks)} components/tasks. "
                    "Consider implementing in batches for easier management."
                )

            return result

        except Exception as e:
            return AnalysisResult(
                success=False,
                error=f"Analysis failed: {str(e)}",
            )

    async def _call_vision_api(
        self, content: list[dict[str, Any]], model: str
    ) -> AnalysisResult:
        """
        Call Claude's vision API with multimodal content.

        This method uses the Anthropic SDK directly for vision API calls,
        as the Claude Agent SDK may not fully support vision capabilities.

        Args:
            content: Multimodal content blocks (text + images)
            model: Model to use

        Returns:
            Parsed AnalysisResult
        """
        # Try to import anthropic SDK for vision support
        try:
            import anthropic
        except ImportError:
            return AnalysisResult(
                success=False,
                error="Anthropic SDK not installed. Run: pip install anthropic",
            )

        # Get API key from environment
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            # Try OAuth token as fallback (for claude-agent-sdk compatibility)
            api_key = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")

        if not api_key:
            return AnalysisResult(
                success=False,
                error="Missing API key. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN",
            )

        # Create client with optional base URL
        base_url = os.environ.get("ANTHROPIC_BASE_URL")
        client_kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url

        client = anthropic.AsyncAnthropic(**client_kwargs)

        try:
            # Call the messages API with vision support
            response = await client.messages.create(
                model=model,
                max_tokens=8192,
                messages=[
                    {
                        "role": "user",
                        "content": content,
                    }
                ],
            )

            # Extract text from response
            response_text = ""
            for block in response.content:
                if hasattr(block, "text"):
                    response_text += block.text

            # Parse the response
            return self._parse_analysis_response(response_text)

        except anthropic.APIError as e:
            return AnalysisResult(
                success=False,
                error=f"API error: {str(e)}",
            )

    def to_dict(self, result: AnalysisResult) -> dict[str, Any]:
        """
        Convert AnalysisResult to dictionary for JSON serialization.

        Args:
            result: AnalysisResult to convert

        Returns:
            Dictionary representation
        """
        return {
            "success": result.success,
            "error": result.error,
            "components": [
                {
                    "type": c.type,
                    "name": c.name,
                    "description": c.description,
                    "visual_details": c.visual_details,
                    "variants": c.variants,
                    "states": c.states,
                    "count_in_design": c.count_in_design,
                }
                for c in result.components
            ],
            "layout": {
                "type": result.layout.type,
                "structure": result.layout.structure,
                "grid": result.layout.grid,
                "container_max_width": result.layout.container_max_width,
            }
            if result.layout
            else None,
            "colors": {
                "primary": result.colors.primary,
                "secondary": result.colors.secondary,
                "success": result.colors.success,
                "warning": result.colors.warning,
                "error": result.colors.error,
                "background": result.colors.background,
                "surface": result.colors.surface,
                "text_primary": result.colors.text_primary,
                "text_secondary": result.colors.text_secondary,
                "border": result.colors.border,
            }
            if result.colors
            else None,
            "typography": {
                "heading_font": result.typography.heading_font,
                "body_font": result.typography.body_font,
                "h1_size": result.typography.h1_size,
                "h2_size": result.typography.h2_size,
                "body_size": result.typography.body_size,
                "small_size": result.typography.small_size,
            }
            if result.typography
            else None,
            "tasks": [
                {
                    "title": t.title,
                    "description": t.description,
                    "type": t.type,
                    "priority": t.priority,
                    "implementation_details": t.implementation_details,
                    "acceptance_criteria": t.acceptance_criteria,
                }
                for t in result.tasks
            ],
            "warnings": result.warnings,
            "questions": result.questions,
            "analysis_metadata": result.analysis_metadata,
        }


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================


async def analyze_screenshots(
    images: list[dict[str, Any]] | list[ImageAttachment],
    project_context: str | None = None,
    model: str = "claude-sonnet-4-20250514",
) -> dict[str, Any]:
    """
    Analyze screenshots and generate implementation tasks.

    This is the main entry point for screenshot analysis. It accepts either
    raw dictionaries (from API requests) or ImageAttachment objects.

    Args:
        images: List of image attachments (dicts or ImageAttachment objects)
        project_context: Optional project context (tech stack, conventions, etc.)
        model: Claude model to use for analysis

    Returns:
        Dictionary with analysis results including components and tasks

    Example:
        >>> images = [
        ...     {
        ...         "id": "uuid-123",
        ...         "filename": "homepage.png",
        ...         "mime_type": "image/png",
        ...         "size": 500000,
        ...         "data": "base64encodeddata...",
        ...     }
        ... ]
        >>> result = await analyze_screenshots(images, "React + Tailwind project")
        >>> print(result["tasks"])
    """
    # Convert dicts to ImageAttachment if needed
    attachments: list[ImageAttachment] = []
    for img in images:
        if isinstance(img, ImageAttachment):
            attachments.append(img)
        elif isinstance(img, dict):
            attachments.append(
                ImageAttachment(
                    id=img.get("id", ""),
                    filename=img.get("filename", "unknown"),
                    mime_type=img.get("mime_type", img.get("mimeType", "image/png")),
                    size=img.get("size", 0),
                    data=img.get("data", ""),
                    thumbnail=img.get("thumbnail"),
                )
            )

    # Perform analysis
    analyzer = ScreenshotAnalyzer()
    result = await analyzer.analyze(attachments, project_context, model)

    # Convert to dictionary
    return analyzer.to_dict(result)


def validate_screenshot_uploads(
    images: list[dict[str, Any]] | list[ImageAttachment],
) -> tuple[bool, list[dict[str, str]]]:
    """
    Validate screenshot uploads before analysis.

    Args:
        images: List of image attachments to validate

    Returns:
        Tuple of (is_valid, errors)

    Example:
        >>> is_valid, errors = validate_screenshot_uploads(images)
        >>> if not is_valid:
        ...     for error in errors:
        ...         print(f"{error['filename']}: {error['error']}")
    """
    # Convert dicts to ImageAttachment if needed
    attachments: list[ImageAttachment] = []
    for img in images:
        if isinstance(img, ImageAttachment):
            attachments.append(img)
        elif isinstance(img, dict):
            attachments.append(
                ImageAttachment(
                    id=img.get("id", ""),
                    filename=img.get("filename", "unknown"),
                    mime_type=img.get("mime_type", img.get("mimeType", "image/png")),
                    size=img.get("size", 0),
                    data=img.get("data", ""),
                    thumbnail=img.get("thumbnail"),
                )
            )

    analyzer = ScreenshotAnalyzer()
    is_valid, errors, _warnings = analyzer.validate_images(attachments)

    return is_valid, [
        {"image_id": e.image_id, "filename": e.filename, "error": e.error}
        for e in errors
    ]


# =============================================================================
# CLI
# =============================================================================


def main() -> None:
    """CLI entry point for testing."""
    import argparse

    parser = argparse.ArgumentParser(description="Screenshot analyzer")
    parser.add_argument("image", type=Path, nargs="+", help="Path to screenshot file(s)")
    parser.add_argument("--context", type=str, help="Project context")
    parser.add_argument("--model", type=str, default="claude-sonnet-4-20250514", help="Model to use")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    # Load images
    images: list[ImageAttachment] = []
    for path in args.image:
        if not path.exists():
            print(f"Error: File not found: {path}")
            return

        # Determine MIME type from extension
        ext = path.suffix.lower()
        mime_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
        }
        mime_type = mime_types.get(ext, "image/png")

        # Read and encode file
        data = base64.b64encode(path.read_bytes()).decode("utf-8")

        images.append(
            ImageAttachment(
                id=str(len(images) + 1),
                filename=path.name,
                mime_type=mime_type,
                size=path.stat().st_size,
                data=data,
            )
        )

    # Run analysis
    async def run_analysis() -> dict[str, Any]:
        return await analyze_screenshots(images, args.context, args.model)

    # Import anyio only when CLI is used
    import anyio

    result = anyio.run(run_analysis)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if result.get("success"):
            print(f"\n=== Analysis Complete ===")
            print(f"Components found: {len(result.get('components', []))}")
            print(f"Tasks generated: {len(result.get('tasks', []))}")

            if result.get("tasks"):
                print("\n=== Generated Tasks ===")
                for i, task in enumerate(result["tasks"], 1):
                    print(f"\n{i}. [{task['priority'].upper()}] {task['title']}")
                    print(f"   Type: {task['type']}")
                    print(f"   {task['description'][:100]}...")

            if result.get("warnings"):
                print("\n=== Warnings ===")
                for warning in result["warnings"]:
                    print(f"  - {warning}")

            if result.get("questions"):
                print("\n=== Clarifying Questions ===")
                for question in result["questions"]:
                    print(f"  ? {question}")
        else:
            print(f"Error: {result.get('error')}")


if __name__ == "__main__":
    main()
