#!/usr/bin/env python3
"""
Unit tests for insights_runner.py

Tests the format_attachment_context function to ensure file attachments
are correctly formatted for the AI context.

Run with: python test_insights_runner.py -v
"""

import base64
import json
import os
import tempfile
import unittest


# ============================================
# Copy of functions from insights_runner.py
# (to avoid import issues with dependencies)
# ============================================

def is_text_file(mime_type: str, filename: str) -> bool:
    """Check if a file is text-based and should be included inline."""
    # Text MIME types
    text_mimes = [
        "text/",
        "application/json",
        "application/javascript",
        "application/typescript",
        "application/xml",
        "application/x-yaml",
        "application/x-sh",
        "application/x-python",
    ]

    if any(mime_type.startswith(m) for m in text_mimes):
        return True

    # Check by file extension
    text_extensions = {
        ".txt",
        ".md",
        ".py",
        ".js",
        ".ts",
        ".tsx",
        ".jsx",
        ".json",
        ".yaml",
        ".yml",
        ".xml",
        ".html",
        ".css",
        ".scss",
        ".less",
        ".sh",
        ".bash",
        ".zsh",
        ".fish",
        ".sql",
        ".graphql",
        ".env",
        ".gitignore",
        ".dockerfile",
        ".toml",
        ".ini",
        ".cfg",
        ".conf",
        ".log",
        ".csv",
        ".rst",
        ".tex",
        ".go",
        ".rs",
        ".java",
        ".kt",
        ".swift",
        ".c",
        ".cpp",
        ".h",
        ".hpp",
        ".cs",
        ".php",
        ".rb",
        ".pl",
        ".lua",
        ".vim",
        ".el",
        ".clj",
        ".hs",
        ".ex",
        ".exs",
        ".erl",
        ".r",
        ".m",
        ".makefile",
    }

    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in text_extensions


def format_attachment_context(attachments: list) -> str:
    """Format file attachments as context for the AI."""
    if not attachments:
        return ""

    context_parts = []
    context_parts.append("\n## Attached Files\n")
    context_parts.append(
        "The user has attached the following files to this message:\n"
    )

    for attachment in attachments:
        filename = attachment.get("filename", "unknown")
        mime_type = attachment.get("mimeType", "application/octet-stream")
        size = attachment.get("size", 0)
        data = attachment.get("data", "")

        # Format file size for readability
        if size < 1024:
            size_str = f"{size} bytes"
        elif size < 1024 * 1024:
            size_str = f"{size / 1024:.1f} KB"
        elif size < 1024 * 1024 * 1024:
            size_str = f"{size / (1024 * 1024):.1f} MB"
        else:
            size_str = f"{size / (1024 * 1024 * 1024):.1f} GB"

        context_parts.append(f"\n### {filename}\n")
        context_parts.append(f"- **Type**: {mime_type}\n")
        context_parts.append(f"- **Size**: {size_str}\n")

        # Include file content if it's a text-based file and we have data
        if data and is_text_file(mime_type, filename):
            try:
                # Decode base64 data
                decoded_data = base64.b64decode(data).decode("utf-8", errors="replace")
                # Truncate very long files
                max_chars = 50000
                if len(decoded_data) > max_chars:
                    decoded_data = (
                        decoded_data[:max_chars] + f"\n\n... (truncated, {size_str} total)"
                    )
                context_parts.append(f"\n**Content:**\n```\n{decoded_data}\n```\n")
            except Exception:
                context_parts.append("- *Content could not be decoded*\n")
        elif data:
            # For binary files, just note that content is available
            context_parts.append("- *Binary file content attached*\n")

    return "".join(context_parts)


# ============================================
# Test Cases
# ============================================


class TestIsTextFile(unittest.TestCase):
    """Test the is_text_file function."""

    def test_text_mime_types_detected(self):
        """Test that common text MIME types are detected."""
        text_cases = [
            ("text/plain", "file.txt"),
            ("text/html", "index.html"),
            ("text/css", "styles.css"),
            ("application/json", "data.json"),
            ("application/javascript", "script.js"),
            ("application/typescript", "code.ts"),
            ("application/xml", "config.xml"),
            ("application/x-yaml", "config.yaml"),
            ("application/x-sh", "script.sh"),
            ("application/x-python", "script.py"),
        ]
        for mime_type, filename in text_cases:
            with self.subTest(mime_type=mime_type, filename=filename):
                self.assertTrue(
                    is_text_file(mime_type, filename),
                    f"Expected {mime_type}/{filename} to be detected as text"
                )

    def test_text_extensions_detected(self):
        """Test that common text file extensions are detected."""
        text_extensions = [
            (".txt", "document.txt"),
            (".md", "README.md"),
            (".py", "script.py"),
            (".js", "app.js"),
            (".ts", "app.ts"),
            (".tsx", "Component.tsx"),
            (".jsx", "Component.jsx"),
            (".json", "package.json"),
            (".yaml", "config.yaml"),
            (".yml", "config.yml"),
            (".xml", "pom.xml"),
            (".html", "index.html"),
            (".css", "styles.css"),
            (".scss", "styles.scss"),
            (".sql", "query.sql"),
            (".go", "main.go"),
            (".rs", "lib.rs"),
            (".java", "Main.java"),
        ]
        for ext, filename in text_extensions:
            with self.subTest(ext=ext, filename=filename):
                # Use generic MIME type to test extension detection
                self.assertTrue(
                    is_text_file("application/octet-stream", filename),
                    f"Expected {filename} to be detected as text by extension"
                )

    def test_binary_files_not_detected_as_text(self):
        """Test that binary files are not detected as text."""
        binary_cases = [
            ("image/png", "image.png"),
            ("image/jpeg", "photo.jpg"),
            ("application/pdf", "document.pdf"),
            ("application/zip", "archive.zip"),
            ("video/mp4", "video.mp4"),
            ("audio/mpeg", "audio.mp3"),
            ("application/octet-stream", "data.bin"),
            ("application/octet-stream", "program.exe"),
        ]
        for mime_type, filename in binary_cases:
            with self.subTest(mime_type=mime_type, filename=filename):
                self.assertFalse(
                    is_text_file(mime_type, filename),
                    f"Expected {mime_type}/{filename} to NOT be detected as text"
                )


class TestFormatAttachmentContext(unittest.TestCase):
    """Test the format_attachment_context function."""

    def test_empty_attachments_returns_empty_string(self):
        """Test that empty attachments list returns empty string."""
        result = format_attachment_context([])
        self.assertEqual(result, "")

    def test_none_attachments_returns_empty_string(self):
        """Test that None attachments returns empty string (via truthiness)."""
        result = format_attachment_context(None)
        self.assertEqual(result, "")

    def test_text_file_content_included(self):
        """Test that text file content is decoded and included."""
        text_content = "Hello, this is test content!"
        base64_content = base64.b64encode(text_content.encode()).decode()

        attachments = [{
            "id": "file-123",
            "filename": "test.txt",
            "mimeType": "text/plain",
            "size": len(text_content),
            "data": base64_content
        }]

        result = format_attachment_context(attachments)

        # Verify structure
        self.assertIn("## Attached Files", result)
        self.assertIn("test.txt", result)
        self.assertIn("text/plain", result)
        # Verify content is included
        self.assertIn(text_content, result)
        self.assertIn("**Content:**", result)

    def test_binary_file_noted_without_content(self):
        """Test that binary files are noted but content not included."""
        binary_data = base64.b64encode(b"\x00\x01\x02\x03").decode()

        attachments = [{
            "id": "file-456",
            "filename": "image.png",
            "mimeType": "image/png",
            "size": 4,
            "data": binary_data
        }]

        result = format_attachment_context(attachments)

        # Verify structure
        self.assertIn("## Attached Files", result)
        self.assertIn("image.png", result)
        self.assertIn("image/png", result)
        # Verify binary is noted
        self.assertIn("Binary file content attached", result)
        # Verify binary data is NOT decoded into the context
        self.assertNotIn("\x00", result)

    def test_multiple_attachments(self):
        """Test handling of multiple attachments."""
        text_content1 = "File 1 content"
        text_content2 = "File 2 content"

        attachments = [
            {
                "id": "file-1",
                "filename": "file1.txt",
                "mimeType": "text/plain",
                "size": len(text_content1),
                "data": base64.b64encode(text_content1.encode()).decode()
            },
            {
                "id": "file-2",
                "filename": "file2.md",
                "mimeType": "text/markdown",
                "size": len(text_content2),
                "data": base64.b64encode(text_content2.encode()).decode()
            }
        ]

        result = format_attachment_context(attachments)

        # Verify both files are included
        self.assertIn("file1.txt", result)
        self.assertIn("file2.md", result)
        self.assertIn(text_content1, result)
        self.assertIn(text_content2, result)

    def test_file_size_formatting(self):
        """Test that file sizes are formatted correctly."""
        attachments = [
            {
                "id": "file-bytes",
                "filename": "small.txt",
                "mimeType": "text/plain",
                "size": 500,
                "data": base64.b64encode(b"x" * 500).decode()
            },
            {
                "id": "file-kb",
                "filename": "medium.txt",
                "mimeType": "text/plain",
                "size": 5000,
                "data": base64.b64encode(b"x" * 5000).decode()
            }
        ]

        result = format_attachment_context(attachments)

        # Verify size is shown
        self.assertIn("500 bytes", result)
        self.assertIn("KB", result)

    def test_missing_data_field(self):
        """Test handling of attachment without data field."""
        attachments = [{
            "id": "file-nodata",
            "filename": "nodata.txt",
            "mimeType": "text/plain",
            "size": 100
            # No 'data' field
        }]

        result = format_attachment_context(attachments)

        # Should still include file info without crashing
        self.assertIn("nodata.txt", result)
        self.assertIn("text/plain", result)
        # Should not include content section
        self.assertNotIn("**Content:**", result)

    def test_attachment_with_code_file(self):
        """Test Python/JavaScript code files are properly included."""
        python_code = """def hello():
    print("Hello, World!")

if __name__ == "__main__":
    hello()
"""
        attachments = [{
            "id": "file-py",
            "filename": "script.py",
            "mimeType": "text/x-python",
            "size": len(python_code),
            "data": base64.b64encode(python_code.encode()).decode()
        }]

        result = format_attachment_context(attachments)

        # Verify code is included
        self.assertIn("script.py", result)
        self.assertIn("def hello():", result)
        self.assertIn('print("Hello, World!")', result)

    def test_json_file_content(self):
        """Test JSON file content is properly included."""
        json_content = json.dumps({"name": "test", "value": 123}, indent=2)

        attachments = [{
            "id": "file-json",
            "filename": "config.json",
            "mimeType": "application/json",
            "size": len(json_content),
            "data": base64.b64encode(json_content.encode()).decode()
        }]

        result = format_attachment_context(attachments)

        # Verify JSON content is included
        self.assertIn("config.json", result)
        self.assertIn('"name"', result)
        self.assertIn('"test"', result)

    def test_large_file_truncation(self):
        """Test that very large files are truncated."""
        # Create content larger than the 50KB limit
        large_content = "x" * 60000

        attachments = [{
            "id": "file-large",
            "filename": "large.txt",
            "mimeType": "text/plain",
            "size": len(large_content),
            "data": base64.b64encode(large_content.encode()).decode()
        }]

        result = format_attachment_context(attachments)

        # Verify truncation message
        self.assertIn("truncated", result.lower())
        # Verify we don't have the full 60000 x characters
        self.assertLess(result.count("x"), 55000)


class TestAttachmentFileReading(unittest.TestCase):
    """Test the attachments file reading functionality."""

    def test_read_attachments_from_file(self):
        """Test that attachments can be read from a JSON file."""
        text_content = "Test file content for reading"
        attachments = [{
            "id": "file-read-test",
            "filename": "readme.txt",
            "mimeType": "text/plain",
            "size": len(text_content),
            "data": base64.b64encode(text_content.encode()).decode()
        }]

        # Write to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(attachments, f)
            temp_path = f.name

        try:
            # Read back
            with open(temp_path, encoding='utf-8') as f:
                loaded_attachments = json.load(f)

            # Format context
            result = format_attachment_context(loaded_attachments)

            # Verify
            self.assertIn("readme.txt", result)
            self.assertIn(text_content, result)
        finally:
            os.unlink(temp_path)


if __name__ == "__main__":
    unittest.main()
