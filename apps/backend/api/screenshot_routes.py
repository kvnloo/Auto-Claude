#!/usr/bin/env python3
"""
Screenshot Analysis API Routes
==============================

Provides REST API endpoints for screenshot-to-task conversion using
Claude's vision capabilities.

Endpoints:
    POST /api/screenshot-analysis - Analyze screenshots and generate tasks

Usage:
    from api.screenshot_routes import router
    app.include_router(router)

    # Or run standalone:
    uvicorn api.screenshot_routes:app --reload --port 8000
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, status
from pydantic import BaseModel, Field

from services.screenshot_analyzer import (
    AnalysisResult,
    ScreenshotAnalyzer,
    analyze_screenshots,
    validate_screenshot_uploads,
)


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================


class ImageAttachmentRequest(BaseModel):
    """
    Image attachment for screenshot analysis request.

    Matches the frontend ImageAttachment type.

    Attributes:
        id: Unique identifier (UUID)
        filename: Original filename
        mime_type: MIME type (e.g., 'image/png')
        mimeType: Alias for mime_type (frontend compatibility)
        size: Size in bytes
        data: Base64 encoded image data (without data URL prefix)
        thumbnail: Optional base64 thumbnail
    """

    id: str = Field(description="Unique identifier for the image")
    filename: str = Field(description="Original filename")
    mime_type: str | None = Field(
        default=None, alias="mimeType", description="MIME type"
    )
    size: int = Field(description="File size in bytes")
    data: str = Field(description="Base64 encoded image data")
    thumbnail: str | None = Field(default=None, description="Optional thumbnail")

    class Config:
        populate_by_name = True

    def get_mime_type(self) -> str:
        """Get MIME type, supporting both field names."""
        return self.mime_type or "image/png"


class ScreenshotAnalysisRequest(BaseModel):
    """
    Request body for screenshot analysis.

    Attributes:
        images: List of image attachments to analyze
        project_context: Optional project context (tech stack, conventions)
        model: Optional model to use for analysis
    """

    images: list[ImageAttachmentRequest] = Field(
        description="List of images to analyze"
    )
    project_context: str | None = Field(
        default=None, description="Project context (tech stack, conventions)"
    )
    model: str | None = Field(
        default=None, description="Claude model to use for analysis"
    )


class ValidationErrorResponse(BaseModel):
    """
    Validation error details.

    Attributes:
        image_id: ID of the problematic image
        filename: Filename of the problematic image
        error: Error description
    """

    image_id: str
    filename: str
    error: str


class ErrorResponse(BaseModel):
    """
    Standard error response.

    Attributes:
        success: Always False for errors
        error: Error message
        validation_errors: Optional list of validation errors
    """

    success: bool = False
    error: str
    validation_errors: list[ValidationErrorResponse] | None = None


class ExtractedComponentResponse(BaseModel):
    """
    UI component extracted from screenshot analysis.

    Attributes:
        type: Component type (button, input, card, etc.)
        name: Suggested component name
        description: What the component does
        visual_details: Styling details
        variants: Possible variants
        states: Interactive states
        count_in_design: Number of times this component appears
    """

    type: str
    name: str
    description: str
    visual_details: dict[str, Any] = Field(default_factory=dict)
    variants: list[str] = Field(default_factory=list)
    states: list[str] = Field(default_factory=list)
    count_in_design: int = 1


class GeneratedTaskResponse(BaseModel):
    """
    Implementation task generated from screenshot analysis.

    Attributes:
        title: Task title
        description: Detailed description
        type: Task type (component, layout, feature)
        priority: Priority level
        implementation_details: Specific implementation guidance
        acceptance_criteria: What defines "done"
    """

    title: str
    description: str
    type: str
    priority: str
    implementation_details: dict[str, Any] = Field(default_factory=dict)
    acceptance_criteria: list[str] = Field(default_factory=list)


class LayoutInfoResponse(BaseModel):
    """Layout structure information."""

    type: str
    structure: str
    grid: str | None = None
    container_max_width: str | None = None


class ColorPaletteResponse(BaseModel):
    """Extracted color palette."""

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


class TypographyResponse(BaseModel):
    """Typography patterns."""

    heading_font: str | None = None
    body_font: str | None = None
    h1_size: str | None = None
    h2_size: str | None = None
    body_size: str | None = None
    small_size: str | None = None


class ScreenshotAnalysisResponse(BaseModel):
    """
    Complete response from screenshot analysis.

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
        analysis_metadata: Additional metadata
    """

    success: bool
    error: str | None = None
    components: list[ExtractedComponentResponse] = Field(default_factory=list)
    layout: LayoutInfoResponse | None = None
    colors: ColorPaletteResponse | None = None
    typography: TypographyResponse | None = None
    tasks: list[GeneratedTaskResponse] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    analysis_metadata: dict[str, Any] = Field(default_factory=dict)


# =============================================================================
# ROUTER
# =============================================================================


router = APIRouter(prefix="/api", tags=["screenshot-analysis"])


@router.post(
    "/screenshot-analysis",
    response_model=ScreenshotAnalysisResponse,
    responses={
        200: {
            "description": "Analysis completed successfully",
            "model": ScreenshotAnalysisResponse,
        },
        400: {
            "description": "Validation error (no images, invalid format, etc.)",
            "model": ErrorResponse,
        },
        500: {
            "description": "Analysis failed due to server error",
            "model": ErrorResponse,
        },
    },
    summary="Analyze screenshots and generate tasks",
    description="""
    Analyzes uploaded design screenshots using Claude's vision capabilities
    to extract UI components, layout structure, color schemes, and typography.
    Generates specific, actionable implementation tasks.

    **Request:**
    - `images`: Array of base64-encoded images (max 10, each max 10MB)
    - `project_context`: Optional context about the project
    - `model`: Optional Claude model to use

    **Response:**
    - `components`: Extracted UI components with visual details
    - `layout`: Page layout structure
    - `colors`: Extracted color palette
    - `typography`: Font patterns
    - `tasks`: Generated implementation tasks with specific details
    """,
)
async def analyze_screenshot(
    request: ScreenshotAnalysisRequest,
) -> ScreenshotAnalysisResponse:
    """
    Analyze screenshots and generate implementation tasks.

    This endpoint accepts base64-encoded screenshots and uses Claude's
    vision API to extract UI components and generate specific development
    tasks with implementation details.

    Args:
        request: ScreenshotAnalysisRequest with images and optional context

    Returns:
        ScreenshotAnalysisResponse with components and tasks

    Raises:
        HTTPException: 400 for validation errors, 500 for analysis failures
    """
    # Validate that images were provided
    if not request.images:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "success": False,
                "error": "No images provided for analysis",
                "validation_errors": [
                    {
                        "image_id": "",
                        "filename": "",
                        "error": "No images provided for analysis",
                    }
                ],
            },
        )

    # Convert request images to dict format for the analyzer
    images_data: list[dict[str, Any]] = []
    for img in request.images:
        images_data.append(
            {
                "id": img.id,
                "filename": img.filename,
                "mime_type": img.get_mime_type(),
                "size": img.size,
                "data": img.data,
                "thumbnail": img.thumbnail,
            }
        )

    # Validate the images before analysis
    is_valid, validation_errors = validate_screenshot_uploads(images_data)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "success": False,
                "error": "Image validation failed",
                "validation_errors": validation_errors,
            },
        )

    try:
        # Perform the analysis
        model = request.model or "claude-sonnet-4-20250514"
        result = await analyze_screenshots(
            images=images_data,
            project_context=request.project_context,
            model=model,
        )

        # Check if analysis was successful
        if not result.get("success", False):
            error_msg = result.get("error", "Analysis failed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "success": False,
                    "error": error_msg,
                },
            )

        # Build response
        return ScreenshotAnalysisResponse(
            success=True,
            components=[
                ExtractedComponentResponse(**comp) for comp in result.get("components", [])
            ],
            layout=LayoutInfoResponse(**result["layout"])
            if result.get("layout")
            else None,
            colors=ColorPaletteResponse(**result["colors"])
            if result.get("colors")
            else None,
            typography=TypographyResponse(**result["typography"])
            if result.get("typography")
            else None,
            tasks=[
                GeneratedTaskResponse(**task) for task in result.get("tasks", [])
            ],
            warnings=result.get("warnings", []),
            questions=result.get("questions", []),
            analysis_metadata=result.get("analysis_metadata", {}),
        )

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Catch any other errors
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": f"Analysis failed: {str(e)}",
            },
        )


@router.get(
    "/screenshot-analysis/health",
    summary="Health check for screenshot analysis service",
    description="Returns OK if the service is running and dependencies are available.",
)
async def health_check() -> dict[str, str]:
    """
    Health check endpoint.

    Returns:
        Dict with status "ok"
    """
    return {"status": "ok", "service": "screenshot-analysis"}


# =============================================================================
# STANDALONE APP
# =============================================================================


def create_app() -> FastAPI:
    """
    Create the FastAPI application.

    Returns:
        Configured FastAPI app
    """
    app = FastAPI(
        title="Screenshot Analysis API",
        description="API for analyzing design screenshots and generating implementation tasks",
        version="1.0.0",
    )

    # Add CORS middleware for frontend access
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include the router
    app.include_router(router)

    return app


# Create app instance for uvicorn
app = create_app()


# =============================================================================
# CLI
# =============================================================================


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api.screenshot_routes:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
