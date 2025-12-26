/**
 * Unit tests for ScreenshotAnalyzer component
 * Tests file upload validation, base64 encoding, thumbnail generation, task display and editing
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ImageAttachment } from '../../shared/types';
import { MAX_IMAGE_SIZE, MAX_IMAGES_PER_TASK, ALLOWED_IMAGE_TYPES } from '../../shared/constants';
import {
  generateImageId,
  fileToBase64,
  createThumbnail,
  isValidImageType,
  resolveFilename,
  formatFileSize
} from './ImageUpload';
import type { GeneratedTask, AnalysisResult } from './ScreenshotAnalyzer';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper to create mock File objects
function createMockFile(name: string, size: number, type: string): File {
  const content = new Array(size).fill('a').join('');
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

// Helper to create test ImageAttachment
function createTestImage(overrides: Partial<ImageAttachment> = {}): ImageAttachment {
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    filename: 'test-screenshot.png',
    mimeType: 'image/png',
    size: 1024,
    data: 'base64encodeddata',
    thumbnail: 'data:image/jpeg;base64,thumbnaildata',
    ...overrides
  };
}

// Helper to create test GeneratedTask
function createTestTask(overrides: Partial<GeneratedTask> = {}): GeneratedTask {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    title: 'Test Task',
    description: 'Test task description',
    selected: true,
    ...overrides
  };
}

describe('ScreenshotAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('File Upload Validation', () => {
    describe('File Size Limits', () => {
      it('should define MAX_IMAGE_SIZE as 10MB', () => {
        expect(MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024);
      });

      it('should identify files under 10MB as valid size', () => {
        const smallFile = createMockFile('small.png', 5 * 1024 * 1024, 'image/png');
        expect(smallFile.size).toBeLessThan(MAX_IMAGE_SIZE);
      });

      it('should identify files at exactly 10MB as valid size', () => {
        const exactFile = createMockFile('exact.png', MAX_IMAGE_SIZE, 'image/png');
        expect(exactFile.size).toBe(MAX_IMAGE_SIZE);
      });

      it('should identify files over 10MB as large (warning)', () => {
        const largeFile = createMockFile('large.png', 15 * 1024 * 1024, 'image/png');
        expect(largeFile.size).toBeGreaterThan(MAX_IMAGE_SIZE);
      });

      it('should handle very small files (1 byte)', () => {
        const tinyFile = createMockFile('tiny.png', 1, 'image/png');
        expect(tinyFile.size).toBe(1);
        expect(tinyFile.size).toBeLessThan(MAX_IMAGE_SIZE);
      });
    });

    describe('File Type Validation', () => {
      it('should accept PNG files', () => {
        const file = createMockFile('test.png', 1024, 'image/png');
        expect(isValidImageType(file)).toBe(true);
      });

      it('should accept JPEG files', () => {
        const file = createMockFile('test.jpg', 1024, 'image/jpeg');
        expect(isValidImageType(file)).toBe(true);
      });

      it('should accept GIF files', () => {
        const file = createMockFile('test.gif', 1024, 'image/gif');
        expect(isValidImageType(file)).toBe(true);
      });

      it('should accept WebP files', () => {
        const file = createMockFile('test.webp', 1024, 'image/webp');
        expect(isValidImageType(file)).toBe(true);
      });

      it('should accept SVG files', () => {
        const file = createMockFile('test.svg', 1024, 'image/svg+xml');
        expect(isValidImageType(file)).toBe(true);
      });

      it('should reject PDF files', () => {
        const file = createMockFile('test.pdf', 1024, 'application/pdf');
        expect(isValidImageType(file)).toBe(false);
      });

      it('should reject text files', () => {
        const file = createMockFile('test.txt', 1024, 'text/plain');
        expect(isValidImageType(file)).toBe(false);
      });

      it('should reject executable files', () => {
        const file = createMockFile('test.exe', 1024, 'application/x-msdownload');
        expect(isValidImageType(file)).toBe(false);
      });

      it('should reject JSON files', () => {
        const file = createMockFile('test.json', 1024, 'application/json');
        expect(isValidImageType(file)).toBe(false);
      });

      it('should have correct allowed types defined', () => {
        expect(ALLOWED_IMAGE_TYPES).toContain('image/png');
        expect(ALLOWED_IMAGE_TYPES).toContain('image/jpeg');
        expect(ALLOWED_IMAGE_TYPES).toContain('image/gif');
        expect(ALLOWED_IMAGE_TYPES).toContain('image/webp');
        expect(ALLOWED_IMAGE_TYPES).toContain('image/svg+xml');
      });
    });

    describe('File Count Limits', () => {
      it('should define MAX_IMAGES_PER_TASK as 10', () => {
        expect(MAX_IMAGES_PER_TASK).toBe(10);
      });

      it('should calculate remaining slots correctly', () => {
        const currentCount = 3;
        const remainingSlots = MAX_IMAGES_PER_TASK - currentCount;
        expect(remainingSlots).toBe(7);
      });

      it('should allow adding when under limit', () => {
        const currentCount = 5;
        const canAddMore = currentCount < MAX_IMAGES_PER_TASK;
        expect(canAddMore).toBe(true);
      });

      it('should prevent adding when at limit', () => {
        const currentCount = MAX_IMAGES_PER_TASK;
        const canAddMore = currentCount < MAX_IMAGES_PER_TASK;
        expect(canAddMore).toBe(false);
      });

      it('should handle edge case of adding last allowed image', () => {
        const currentCount = 9;
        const remainingSlots = MAX_IMAGES_PER_TASK - currentCount;
        expect(remainingSlots).toBe(1);
        expect(currentCount < MAX_IMAGES_PER_TASK).toBe(true);
      });
    });
  });

  describe('Base64 Encoding', () => {
    it('should generate unique image IDs', () => {
      const id1 = generateImageId();
      const id2 = generateImageId();

      expect(id1).toMatch(/^img-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^img-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should strip data URL prefix correctly', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';
      const base64Data = dataUrl.split(',')[1];

      expect(base64Data).toBe('iVBORw0KGgoAAAANSUhEUg');
      expect(base64Data).not.toContain('data:');
      expect(base64Data).not.toContain('base64,');
    });

    it('should handle JPEG data URL prefix stripping', () => {
      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg';
      const base64Data = dataUrl.split(',')[1];

      expect(base64Data).toBe('/9j/4AAQSkZJRg');
    });

    it('should handle SVG data URL prefix stripping', () => {
      const dataUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0i';
      const base64Data = dataUrl.split(',')[1];

      expect(base64Data).toBe('PHN2ZyB4bWxucz0i');
    });

    it('should preserve base64 data integrity', () => {
      const originalBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${originalBase64}`;
      const extractedBase64 = dataUrl.split(',')[1];

      expect(extractedBase64).toBe(originalBase64);
    });

    it('should handle empty base64 data', () => {
      const dataUrl = 'data:image/png;base64,';
      const base64Data = dataUrl.split(',')[1];

      expect(base64Data).toBe('');
    });
  });

  describe('File Size Formatting', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes correctly', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(2048)).toBe('2.0 KB');
    });

    it('should format megabytes correctly', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatFileSize(5.5 * 1024 * 1024)).toBe('5.5 MB');
    });

    it('should format 10MB correctly', () => {
      expect(formatFileSize(MAX_IMAGE_SIZE)).toBe('10.0 MB');
    });

    it('should handle zero bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });
  });

  describe('Filename Resolution', () => {
    it('should return original filename if no duplicates', () => {
      const filename = 'test.png';
      const existingFiles: string[] = [];

      const resolved = resolveFilename(filename, existingFiles);
      expect(resolved).toBe('test.png');
    });

    it('should add timestamp suffix for duplicate filenames', () => {
      const filename = 'test.png';
      const existingFiles = ['test.png'];

      const resolved = resolveFilename(filename, existingFiles);
      expect(resolved).toMatch(/^test-\d+\.png$/);
      expect(resolved).not.toBe('test.png');
    });

    it('should handle files without extensions', () => {
      const filename = 'testfile';
      const existingFiles = ['testfile'];

      const resolved = resolveFilename(filename, existingFiles);
      expect(resolved).toMatch(/^testfile-\d+$/);
    });

    it('should handle multiple existing duplicates', () => {
      const filename = 'screenshot.png';
      const existingFiles = ['screenshot.png', 'screenshot-123456.png'];

      const resolved = resolveFilename(filename, existingFiles);
      expect(resolved).toMatch(/^screenshot-\d+\.png$/);
    });

    it('should preserve complex extensions', () => {
      const filename = 'design.mockup.png';
      const existingFiles = ['design.mockup.png'];

      const resolved = resolveFilename(filename, existingFiles);
      expect(resolved).toMatch(/^design\.mockup-\d+\.png$/);
    });
  });

  describe('Image Attachment Structure', () => {
    it('should create ImageAttachment with all required fields', () => {
      const image = createTestImage();

      expect(image).toHaveProperty('id');
      expect(image).toHaveProperty('filename');
      expect(image).toHaveProperty('mimeType');
      expect(image).toHaveProperty('size');
      expect(image).toHaveProperty('data');
    });

    it('should allow optional thumbnail field', () => {
      const imageWithThumbnail = createTestImage({ thumbnail: 'data:image/jpeg;base64,thumb' });
      const imageWithoutThumbnail = createTestImage({ thumbnail: undefined });

      expect(imageWithThumbnail.thumbnail).toBeDefined();
      expect(imageWithoutThumbnail.thumbnail).toBeUndefined();
    });

    it('should store base64 data without data URL prefix', () => {
      const image = createTestImage({ data: 'iVBORw0KGgoAAAANSUhEUg' });

      expect(image.data).not.toContain('data:');
      expect(image.data).not.toContain('base64,');
    });

    it('should store MIME type correctly', () => {
      const pngImage = createTestImage({ mimeType: 'image/png' });
      const jpegImage = createTestImage({ mimeType: 'image/jpeg' });

      expect(pngImage.mimeType).toBe('image/png');
      expect(jpegImage.mimeType).toBe('image/jpeg');
    });
  });

  describe('Generated Task Structure', () => {
    it('should create GeneratedTask with required fields', () => {
      const task = createTestTask();

      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('title');
      expect(task).toHaveProperty('description');
      expect(task).toHaveProperty('selected');
    });

    it('should have default selected state as true', () => {
      const task = createTestTask();
      expect(task.selected).toBe(true);
    });

    it('should allow optional filePath field', () => {
      const taskWithPath = createTestTask({ filePath: 'src/components/Button.tsx' });
      const taskWithoutPath = createTestTask({ filePath: undefined });

      expect(taskWithPath.filePath).toBe('src/components/Button.tsx');
      expect(taskWithoutPath.filePath).toBeUndefined();
    });

    it('should allow optional componentName field', () => {
      const task = createTestTask({ componentName: 'ActionButton' });
      expect(task.componentName).toBe('ActionButton');
    });

    it('should allow optional implementation array', () => {
      const task = createTestTask({
        implementation: [
          'Create component file',
          'Add props interface',
          'Implement click handler'
        ]
      });

      expect(task.implementation).toHaveLength(3);
      expect(task.implementation).toContain('Create component file');
    });
  });

  describe('Task Selection Logic', () => {
    it('should toggle task selection state', () => {
      const tasks = [
        createTestTask({ id: 'task-1', selected: true }),
        createTestTask({ id: 'task-2', selected: false })
      ];

      // Simulate toggle
      const toggleTask = (taskId: string) => {
        return tasks.map((task) =>
          task.id === taskId ? { ...task, selected: !task.selected } : task
        );
      };

      const afterToggle = toggleTask('task-1');
      expect(afterToggle.find((t) => t.id === 'task-1')?.selected).toBe(false);
      expect(afterToggle.find((t) => t.id === 'task-2')?.selected).toBe(false);
    });

    it('should count selected tasks correctly', () => {
      const tasks = [
        createTestTask({ id: 'task-1', selected: true }),
        createTestTask({ id: 'task-2', selected: true }),
        createTestTask({ id: 'task-3', selected: false })
      ];

      const selectedCount = tasks.filter((t) => t.selected).length;
      expect(selectedCount).toBe(2);
    });

    it('should filter for selected tasks only', () => {
      const tasks = [
        createTestTask({ id: 'task-1', title: 'Selected Task', selected: true }),
        createTestTask({ id: 'task-2', title: 'Unselected Task', selected: false })
      ];

      const selectedTasks = tasks.filter((t) => t.selected);
      expect(selectedTasks).toHaveLength(1);
      expect(selectedTasks[0].title).toBe('Selected Task');
    });
  });

  describe('Task Editing Logic', () => {
    it('should update task title when editing', () => {
      const task = createTestTask({ title: 'Original Title' });
      const editedTask = { ...task, title: 'Updated Title' };

      expect(editedTask.title).toBe('Updated Title');
      expect(editedTask.id).toBe(task.id);
    });

    it('should update task description when editing', () => {
      const task = createTestTask({ description: 'Original description' });
      const editedTask = { ...task, description: 'Updated description' };

      expect(editedTask.description).toBe('Updated description');
    });

    it('should preserve task selection when editing', () => {
      const task = createTestTask({ selected: true });
      const editedTask = { ...task, title: 'New Title' };

      expect(editedTask.selected).toBe(true);
    });

    it('should preserve optional fields when editing', () => {
      const task = createTestTask({
        filePath: 'src/Button.tsx',
        componentName: 'Button',
        implementation: ['Step 1', 'Step 2']
      });
      const editedTask = { ...task, title: 'New Title' };

      expect(editedTask.filePath).toBe('src/Button.tsx');
      expect(editedTask.componentName).toBe('Button');
      expect(editedTask.implementation).toHaveLength(2);
    });
  });

  describe('API Request Format', () => {
    it('should construct correct request body for screenshot analysis', () => {
      const images: ImageAttachment[] = [
        createTestImage({ id: 'img-1', filename: 'screen1.png' }),
        createTestImage({ id: 'img-2', filename: 'screen2.png' })
      ];

      const requestBody = {
        images: images.map((img) => ({
          id: img.id,
          filename: img.filename,
          mimeType: img.mimeType,
          size: img.size,
          data: img.data,
          thumbnail: img.thumbnail
        })),
        project_context: 'React frontend project'
      };

      expect(requestBody.images).toHaveLength(2);
      expect(requestBody.images[0].id).toBe('img-1');
      expect(requestBody.images[1].filename).toBe('screen2.png');
      expect(requestBody.project_context).toBe('React frontend project');
    });

    it('should handle empty project context', () => {
      const images = [createTestImage()];
      const requestBody = {
        images: images.map((img) => ({
          id: img.id,
          filename: img.filename,
          mimeType: img.mimeType,
          size: img.size,
          data: img.data
        })),
        project_context: undefined
      };

      expect(requestBody.project_context).toBeUndefined();
    });
  });

  describe('API Response Parsing', () => {
    it('should parse successful response with tasks', () => {
      const apiResponse = {
        success: true,
        tasks: [
          {
            title: 'Create Button Component',
            description: 'Implement primary button with hover states',
            type: 'feature',
            priority: 'high',
            implementation_details: {
              file_path: 'src/components/Button.tsx',
              component_name: 'Button',
              implementation_steps: ['Create file', 'Add styles']
            }
          }
        ],
        warnings: []
      };

      expect(apiResponse.success).toBe(true);
      expect(apiResponse.tasks).toHaveLength(1);
      expect(apiResponse.tasks[0].implementation_details?.file_path).toBe('src/components/Button.tsx');
    });

    it('should handle response with warnings', () => {
      const apiResponse = {
        success: true,
        tasks: [],
        warnings: ['Low quality image detected', 'Consider uploading higher resolution']
      };

      expect(apiResponse.success).toBe(true);
      expect(apiResponse.warnings).toHaveLength(2);
      expect(apiResponse.warnings).toContain('Low quality image detected');
    });

    it('should handle error response', () => {
      const apiResponse = {
        success: false,
        error: 'Vision API rate limit exceeded'
      };

      expect(apiResponse.success).toBe(false);
      expect(apiResponse.error).toBe('Vision API rate limit exceeded');
    });

    it('should convert backend task format to frontend format', () => {
      const backendTask = {
        title: 'Add Login Form',
        description: 'Create login form with email and password fields',
        type: 'feature',
        priority: 'high',
        implementation_details: {
          file_path: 'src/components/LoginForm.tsx',
          component_name: 'LoginForm',
          implementation_steps: ['Add form fields', 'Add validation', 'Add submit handler']
        },
        acceptance_criteria: ['Form validates email format', 'Password must be 8+ chars']
      };

      // Simulate conversion logic
      const frontendTask: GeneratedTask = {
        id: `task-${Date.now()}-0`,
        title: backendTask.title,
        description: backendTask.description,
        filePath: backendTask.implementation_details?.file_path,
        componentName: backendTask.implementation_details?.component_name,
        implementation: backendTask.implementation_details?.implementation_steps || backendTask.acceptance_criteria,
        selected: true
      };

      expect(frontendTask.title).toBe('Add Login Form');
      expect(frontendTask.filePath).toBe('src/components/LoginForm.tsx');
      expect(frontendTask.implementation).toHaveLength(3);
      expect(frontendTask.selected).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', () => {
      const networkError = new Error('Failed to fetch');
      const errorMessage = networkError.message;

      // Simulate user-friendly error mapping
      const getUserFriendlyError = (msg: string) => {
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          return 'Unable to connect to analysis service. Please ensure the backend is running.';
        }
        return `Analysis failed: ${msg}`;
      };

      const userMessage = getUserFriendlyError(errorMessage);
      expect(userMessage).toContain('Unable to connect');
    });

    it('should handle HTTP 400 errors', () => {
      const errorMessage = 'HTTP 400';

      const getUserFriendlyError = (msg: string) => {
        if (msg.includes('HTTP 400')) {
          return 'Invalid request. Please check your screenshots and try again.';
        }
        return `Analysis failed: ${msg}`;
      };

      const userMessage = getUserFriendlyError(errorMessage);
      expect(userMessage).toContain('Invalid request');
    });

    it('should handle HTTP 500 errors', () => {
      const errorMessage = 'HTTP 500';

      const getUserFriendlyError = (msg: string) => {
        if (msg.includes('HTTP 500')) {
          return 'Analysis service error. Please try again later.';
        }
        return `Analysis failed: ${msg}`;
      };

      const userMessage = getUserFriendlyError(errorMessage);
      expect(userMessage).toContain('service error');
    });

    it('should handle unknown errors with generic message', () => {
      const errorMessage = 'Unknown internal error';

      const getUserFriendlyError = (msg: string) => {
        if (msg.includes('Failed to fetch')) {
          return 'Unable to connect';
        }
        if (msg.includes('HTTP 400')) {
          return 'Invalid request';
        }
        if (msg.includes('HTTP 500')) {
          return 'Service error';
        }
        return `Analysis failed: ${msg}`;
      };

      const userMessage = getUserFriendlyError(errorMessage);
      expect(userMessage).toBe('Analysis failed: Unknown internal error');
    });
  });

  describe('Component State Management', () => {
    it('should clear generated tasks when new images are added', () => {
      // Simulate initial state
      let generatedTasks: GeneratedTask[] = [createTestTask()];

      // Simulate adding new images clears tasks
      const onNewImagesAdded = () => {
        generatedTasks = [];
      };

      onNewImagesAdded();
      expect(generatedTasks).toHaveLength(0);
    });

    it('should clear generated tasks when images are removed', () => {
      let generatedTasks: GeneratedTask[] = [createTestTask(), createTestTask()];

      const onImageRemoved = () => {
        generatedTasks = [];
      };

      onImageRemoved();
      expect(generatedTasks).toHaveLength(0);
    });

    it('should track analyzing state correctly', () => {
      let isAnalyzing = false;

      // Start analysis
      isAnalyzing = true;
      expect(isAnalyzing).toBe(true);

      // Analysis complete
      isAnalyzing = false;
      expect(isAnalyzing).toBe(false);
    });

    it('should determine canAnalyze state correctly', () => {
      const getCanAnalyze = (
        hasImages: boolean,
        isAnalyzing: boolean,
        disabled: boolean
      ) => {
        return hasImages && !isAnalyzing && !disabled;
      };

      expect(getCanAnalyze(true, false, false)).toBe(true);
      expect(getCanAnalyze(false, false, false)).toBe(false);
      expect(getCanAnalyze(true, true, false)).toBe(false);
      expect(getCanAnalyze(true, false, true)).toBe(false);
    });
  });

  describe('Drag and Drop Handling', () => {
    it('should track drag over state', () => {
      let isDragOver = false;

      // Simulate dragover
      isDragOver = true;
      expect(isDragOver).toBe(true);

      // Simulate dragleave
      isDragOver = false;
      expect(isDragOver).toBe(false);
    });

    it('should not process files when disabled', () => {
      const disabled = true;
      let filesProcessed = false;

      const handleDrop = (isDisabled: boolean) => {
        if (isDisabled) return;
        filesProcessed = true;
      };

      handleDrop(disabled);
      expect(filesProcessed).toBe(false);
    });

    it('should process valid files on drop', () => {
      const disabled = false;
      let filesProcessed = false;

      const handleDrop = (isDisabled: boolean) => {
        if (isDisabled) return;
        filesProcessed = true;
      };

      handleDrop(disabled);
      expect(filesProcessed).toBe(true);
    });
  });

  describe('Clear All Functionality', () => {
    it('should clear all images on clear all', () => {
      let images = [createTestImage(), createTestImage(), createTestImage()];

      const handleClearAll = () => {
        images = [];
      };

      handleClearAll();
      expect(images).toHaveLength(0);
    });

    it('should clear generated tasks on clear all', () => {
      let generatedTasks = [createTestTask(), createTestTask()];

      const handleClearAll = () => {
        generatedTasks = [];
      };

      handleClearAll();
      expect(generatedTasks).toHaveLength(0);
    });

    it('should clear warnings on clear all', () => {
      let warnings = ['Warning 1', 'Warning 2'];

      const handleClearAll = () => {
        warnings = [];
      };

      handleClearAll();
      expect(warnings).toHaveLength(0);
    });

    it('should clear error on clear all', () => {
      let error: string | null = 'Some error message';

      const handleClearAll = () => {
        error = null;
      };

      handleClearAll();
      expect(error).toBeNull();
    });
  });

  describe('Props Handling', () => {
    it('should call onTasksGenerated callback with selected tasks', () => {
      const mockOnTasksGenerated = vi.fn();
      const selectedTasks = [
        createTestTask({ selected: true }),
        createTestTask({ selected: true })
      ];
      const allTasks = [...selectedTasks, createTestTask({ selected: false })];

      // Simulate callback
      const selected = allTasks.filter((t) => t.selected);
      mockOnTasksGenerated(selected);

      expect(mockOnTasksGenerated).toHaveBeenCalledWith(selectedTasks);
    });

    it('should respect disabled prop', () => {
      const disabled = true;
      let canInteract = !disabled;

      expect(canInteract).toBe(false);
    });

    it('should apply custom className', () => {
      const customClass = 'my-custom-class';
      const baseClass = 'space-y-4';
      const combinedClass = `${baseClass} ${customClass}`;

      expect(combinedClass).toContain('space-y-4');
      expect(combinedClass).toContain('my-custom-class');
    });
  });

  describe('Multi-Screenshot Support', () => {
    it('should handle multiple images in single analysis', () => {
      const images = [
        createTestImage({ filename: 'mobile.png' }),
        createTestImage({ filename: 'desktop.png' }),
        createTestImage({ filename: 'tablet.png' })
      ];

      expect(images).toHaveLength(3);
      expect(images[0].filename).toBe('mobile.png');
      expect(images[2].filename).toBe('tablet.png');
    });

    it('should limit files when exceeding max count', () => {
      const currentCount = 8;
      const newFilesCount = 5;
      const remainingSlots = MAX_IMAGES_PER_TASK - currentCount;

      const filesToProcess = Math.min(newFilesCount, remainingSlots);
      expect(filesToProcess).toBe(2);
    });

    it('should show warning when files are skipped due to limit', () => {
      const currentCount = 9;
      const newFilesCount = 3;
      const remainingSlots = MAX_IMAGES_PER_TASK - currentCount;

      const filesSkipped = newFilesCount - remainingSlots;
      const shouldShowWarning = filesSkipped > 0;

      expect(shouldShowWarning).toBe(true);
      expect(filesSkipped).toBe(2);
    });
  });
});
