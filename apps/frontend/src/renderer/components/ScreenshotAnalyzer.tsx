import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { Upload, X, AlertCircle, Image as ImageIcon, Loader2, Sparkles, FileText, Pencil, Check, HelpCircle, Layers, Copy } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import type { ImageAttachment } from '../../shared/types';
import {
  MAX_IMAGE_SIZE,
  MAX_IMAGES_PER_TASK,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_IMAGE_TYPES_DISPLAY
} from '../../shared/constants';
import {
  generateImageId,
  fileToBase64,
  createThumbnail,
  isValidImageType,
  resolveFilename,
  formatFileSize
} from './ImageUpload';

/**
 * Minimum recommended image dimensions for quality analysis
 */
const MIN_RECOMMENDED_WIDTH = 400;
const MIN_RECOMMENDED_HEIGHT = 300;

/**
 * Threshold for considering designs as complex (many components)
 */
const COMPLEX_DESIGN_THRESHOLD = 20;

/**
 * Hash a string using simple djb2 algorithm for duplicate detection
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return hash.toString(16);
}

/**
 * Get image dimensions from base64 data
 */
async function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Check if image might be a duplicate based on content hash
 */
function detectDuplicate(
  newData: string,
  existingImages: ImageAttachment[]
): ImageAttachment | null {
  const newHash = simpleHash(newData.substring(0, 10000)); // Hash first 10KB for speed

  for (const existing of existingImages) {
    if (!existing.data) continue;
    const existingHash = simpleHash(existing.data.substring(0, 10000));
    if (newHash === existingHash) {
      return existing;
    }
  }

  return null;
}

/**
 * Generated task from screenshot analysis
 */
export interface GeneratedTask {
  id: string;
  title: string;
  description: string;
  filePath?: string;
  componentName?: string;
  implementation?: string[];
  selected: boolean;
}

/**
 * Analysis result from the backend
 */
export interface AnalysisResult {
  components: Array<{
    name: string;
    type: string;
    position?: string;
    attributes?: Record<string, string>;
  }>;
  layout?: {
    type: string;
    structure: string;
  };
  colors?: string[];
  typography?: string[];
  tasks: GeneratedTask[];
}

/**
 * Backend API response types
 */
interface BackendTaskResponse {
  title: string;
  description: string;
  type: string;
  priority: string;
  implementation_details?: {
    file_path?: string;
    component_name?: string;
    implementation_steps?: string[];
  };
  acceptance_criteria?: string[];
}

interface BackendAnalysisResponse {
  success: boolean;
  error?: string;
  components?: Array<{
    type: string;
    name: string;
    description: string;
  }>;
  tasks?: BackendTaskResponse[];
  warnings?: string[];
  questions?: string[];
  analysis?: {
    screenshot_count?: number;
    screenshot_type?: string;
    overall_style?: string;
    is_ui_design?: boolean;
    image_quality?: 'low' | 'medium' | 'high';
    component_count?: number;
  };
}

/**
 * Duplicate detection confirmation state
 */
interface DuplicateConfirmation {
  filename: string;
  existingFilename: string;
  file: File;
  dataUrl: string;
}

/**
 * Screenshot analysis API configuration
 * Backend runs on port 8000 by default
 */
const SCREENSHOT_API_BASE_URL = 'http://localhost:8000';

/**
 * Analysis API response with all edge case data
 */
interface AnalysisAPIResult {
  tasks: GeneratedTask[];
  warnings: string[];
  questions: string[];
  isUiDesign: boolean;
  componentCount: number;
}

/**
 * Analyze screenshots using the backend vision API
 */
async function analyzeScreenshotsAPI(
  images: ImageAttachment[],
  projectContext?: string
): Promise<AnalysisAPIResult> {
  const requestBody = {
    images: images.map((img) => ({
      id: img.id,
      filename: img.filename,
      mimeType: img.mimeType,
      size: img.size,
      data: img.data,
      thumbnail: img.thumbnail
    })),
    project_context: projectContext
  };

  const response = await fetch(`${SCREENSHOT_API_BASE_URL}/api/screenshot-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData?.detail?.error || errorData?.error || `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  const data: BackendAnalysisResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Analysis failed');
  }

  // Check for non-UI design (backend may flag this in analysis)
  const isUiDesign = data.analysis?.is_ui_design !== false;
  if (!isUiDesign) {
    throw new Error('The image does not appear to be a UI design. Please upload a design mockup or screenshot.');
  }

  // Convert backend tasks to frontend GeneratedTask format
  const tasks: GeneratedTask[] = (data.tasks || []).map((task, index) => ({
    id: `task-${Date.now()}-${index}`,
    title: task.title,
    description: task.description,
    filePath: task.implementation_details?.file_path,
    componentName: task.implementation_details?.component_name,
    implementation: task.implementation_details?.implementation_steps || task.acceptance_criteria,
    selected: true
  }));

  return {
    tasks,
    warnings: data.warnings || [],
    questions: data.questions || [],
    isUiDesign,
    componentCount: data.components?.length || tasks.length
  };
}

interface ScreenshotAnalyzerProps {
  onTasksGenerated?: (tasks: GeneratedTask[]) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * ScreenshotAnalyzer component for uploading design screenshots
 * and generating implementation tasks using AI vision analysis.
 *
 * Features:
 * - Drag-and-drop file upload with validation
 * - Multiple screenshot support for context assembly
 * - Loading state during analysis
 * - Generated task display with selection capability
 */
export function ScreenshotAnalyzer({
  onTasksGenerated,
  disabled = false,
  className
}: ScreenshotAnalyzerProps) {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [generatedTasks, setGeneratedTasks] = useState<GeneratedTask[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [duplicateConfirmation, setDuplicateConfirmation] = useState<DuplicateConfirmation | null>(null);
  const [lowQualityWarnings, setLowQualityWarnings] = useState<string[]>([]);
  const [isComplexDesign, setIsComplexDesign] = useState(false);
  const [taskBatchIndex, setTaskBatchIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canAddMore = images.length < MAX_IMAGES_PER_TASK;
  const hasImages = images.length > 0;
  const canAnalyze = hasImages && !isAnalyzing && !disabled;

  /**
   * Process files and add them to the images array
   */
  const processFiles = useCallback(
    async (files: FileList | File[], skipDuplicateCheck = false) => {
      setError(null);
      const fileArray = Array.from(files);

      // Check how many more images we can add
      const remainingSlots = MAX_IMAGES_PER_TASK - images.length;
      if (remainingSlots <= 0) {
        setError(`Maximum of ${MAX_IMAGES_PER_TASK} screenshots allowed`);
        return;
      }

      // Limit files to remaining slots
      const filesToProcess = fileArray.slice(0, remainingSlots);
      if (fileArray.length > remainingSlots) {
        setError(`Only ${remainingSlots} more screenshot(s) can be added. Some files were skipped.`);
      }

      const newImages: ImageAttachment[] = [];
      const existingFilenames = images.map((img) => img.filename);
      const errors: string[] = [];
      const qualityWarnings: string[] = [];

      for (const file of filesToProcess) {
        // Validate file type
        if (!isValidImageType(file)) {
          errors.push(`"${file.name}" is not a valid image type. Allowed: ${ALLOWED_IMAGE_TYPES_DISPLAY}`);
          continue;
        }

        // Warn about large files (but still allow - per spec)
        if (file.size > MAX_IMAGE_SIZE) {
          errors.push(`"${file.name}" is larger than 10MB. Consider compressing it for better performance.`);
        }

        try {
          const dataUrl = await fileToBase64(file);
          const base64Data = dataUrl.split(',')[1];

          // Check for duplicate uploads (unless explicitly skipped)
          if (!skipDuplicateCheck) {
            const existingDuplicate = detectDuplicate(base64Data, images);
            if (existingDuplicate) {
              // Ask user if this is intentional
              setDuplicateConfirmation({
                filename: file.name,
                existingFilename: existingDuplicate.filename,
                file,
                dataUrl
              });
              return; // Stop processing, wait for user confirmation
            }
          }

          // Check image dimensions for quality warning
          try {
            const dimensions = await getImageDimensions(dataUrl);
            if (dimensions.width < MIN_RECOMMENDED_WIDTH || dimensions.height < MIN_RECOMMENDED_HEIGHT) {
              qualityWarnings.push(
                `"${file.name}" has low resolution (${dimensions.width}×${dimensions.height}). Consider uploading a higher resolution image for better analysis.`
              );
            }
          } catch {
            // Ignore dimension check errors - not critical
          }

          const thumbnail = await createThumbnail(dataUrl);
          const resolvedFilename = resolveFilename(file.name, [
            ...existingFilenames,
            ...newImages.map((img) => img.filename)
          ]);

          newImages.push({
            id: generateImageId(),
            filename: resolvedFilename,
            mimeType: file.type,
            size: file.size,
            data: base64Data,
            thumbnail
          });
        } catch {
          errors.push(`Failed to process "${file.name}"`);
        }
      }

      if (errors.length > 0) {
        setError(errors.join(' '));
      }

      if (qualityWarnings.length > 0) {
        setLowQualityWarnings((prev) => [...prev, ...qualityWarnings]);
      }

      if (newImages.length > 0) {
        setImages((prev) => [...prev, ...newImages]);
        // Clear previous analysis results when new images are added
        setGeneratedTasks([]);
        setQuestions([]);
        setIsComplexDesign(false);
        setTaskBatchIndex(0);
      }
    },
    [images]
  );

  /**
   * Confirm adding duplicate image (intentional duplicate for different states)
   */
  const handleConfirmDuplicate = useCallback(async () => {
    if (!duplicateConfirmation) return;

    const { file, dataUrl } = duplicateConfirmation;
    setDuplicateConfirmation(null);

    try {
      const base64Data = dataUrl.split(',')[1];
      const thumbnail = await createThumbnail(dataUrl);
      const existingFilenames = images.map((img) => img.filename);
      const resolvedFilename = resolveFilename(file.name, existingFilenames);

      const newImage: ImageAttachment = {
        id: generateImageId(),
        filename: resolvedFilename,
        mimeType: file.type,
        size: file.size,
        data: base64Data,
        thumbnail
      };

      setImages((prev) => [...prev, newImage]);
      setGeneratedTasks([]);
      setQuestions([]);
    } catch {
      setError('Failed to add duplicate image');
    }
  }, [duplicateConfirmation, images]);

  /**
   * Cancel adding duplicate image
   */
  const handleCancelDuplicate = useCallback(() => {
    setDuplicateConfirmation(null);
  }, []);

  /**
   * Handle file input change
   */
  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        processFiles(files);
      }
      // Reset input to allow selecting the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [processFiles]
  );

  /**
   * Handle drag events
   */
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (disabled) return;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        processFiles(files);
      }
    },
    [disabled, processFiles]
  );

  /**
   * Remove an image
   */
  const handleRemove = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((img) => img.id !== imageId));
    setError(null);
    // Clear analysis results when images change
    setGeneratedTasks([]);
  }, []);

  /**
   * Open file picker
   */
  const handleClick = useCallback(() => {
    if (!disabled && canAddMore) {
      fileInputRef.current?.click();
    }
  }, [disabled, canAddMore]);

  /**
   * Clear all images
   */
  const handleClearAll = useCallback(() => {
    setImages([]);
    setGeneratedTasks([]);
    setWarnings([]);
    setQuestions([]);
    setLowQualityWarnings([]);
    setError(null);
    setIsComplexDesign(false);
    setTaskBatchIndex(0);
    setDuplicateConfirmation(null);
  }, []);

  /**
   * Analyze screenshots using vision API
   */
  const handleAnalyze = useCallback(async () => {
    if (!canAnalyze) return;

    setIsAnalyzing(true);
    setError(null);
    setWarnings([]);
    setQuestions([]);
    setIsComplexDesign(false);

    try {
      const result = await analyzeScreenshotsAPI(images);

      setGeneratedTasks(result.tasks);
      setWarnings(result.warnings);

      // Extract questions from backend response for ambiguous components
      if (result.questions && result.questions.length > 0) {
        setQuestions(result.questions);
      }

      // Check if design has many components (complex design)
      if (result.tasks.length >= COMPLEX_DESIGN_THRESHOLD) {
        setIsComplexDesign(true);
        // Add a warning about the complex design
        setWarnings((prev) => [
          ...prev,
          `This design contains ${result.tasks.length} tasks. Consider implementing in batches for easier management.`
        ]);
      }

      if (result.tasks.length > 0) {
        onTasksGenerated?.(result.tasks.filter((t) => t.selected));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      // Provide user-friendly error messages
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
        setError('Unable to connect to analysis service. Please ensure the backend is running on port 8000.');
      } else if (errorMessage.includes('HTTP 400')) {
        setError('Invalid request. Please check your screenshots and try again.');
      } else if (errorMessage.includes('HTTP 500')) {
        setError('Analysis service error. Please try again later.');
      } else if (errorMessage.includes('not a UI design') || errorMessage.includes('non-UI')) {
        setError('The uploaded image does not appear to be a UI design. Please upload a design mockup, wireframe, or screenshot of a user interface.');
      } else {
        setError(`Analysis failed: ${errorMessage}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [canAnalyze, images, onTasksGenerated]);

  /**
   * Toggle task selection
   */
  const handleToggleTask = useCallback((taskId: string) => {
    setGeneratedTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, selected: !task.selected } : task
      )
    );
  }, []);

  /**
   * Start editing a task
   */
  const handleStartEdit = useCallback((task: GeneratedTask) => {
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
    setEditingDescription(task.description);
  }, []);

  /**
   * Save task edits
   */
  const handleSaveEdit = useCallback(() => {
    if (!editingTaskId) return;

    setGeneratedTasks((prev) =>
      prev.map((task) =>
        task.id === editingTaskId
          ? { ...task, title: editingTitle, description: editingDescription }
          : task
      )
    );
    setEditingTaskId(null);
    setEditingTitle('');
    setEditingDescription('');
  }, [editingTaskId, editingTitle, editingDescription]);

  /**
   * Cancel task editing
   */
  const handleCancelEdit = useCallback(() => {
    setEditingTaskId(null);
    setEditingTitle('');
    setEditingDescription('');
  }, []);

  /**
   * Use selected tasks
   */
  const handleUseSelectedTasks = useCallback(() => {
    const selectedTasks = generatedTasks.filter((t) => t.selected);
    onTasksGenerated?.(selectedTasks);
  }, [generatedTasks, onTasksGenerated]);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Upload zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-6 transition-all cursor-pointer',
          'flex flex-col items-center justify-center gap-2 text-center',
          isDragOver && !disabled
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/50',
          disabled && 'opacity-50 cursor-not-allowed',
          !canAddMore && 'opacity-50 cursor-not-allowed',
          isAnalyzing && 'pointer-events-none'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          multiple
          onChange={handleFileChange}
          disabled={disabled || !canAddMore || isAnalyzing}
          className="hidden"
        />

        <div
          className={cn(
            'p-3 rounded-full transition-colors',
            isDragOver && !disabled ? 'bg-primary/10' : 'bg-muted'
          )}
        >
          <Upload
            className={cn(
              'h-6 w-6',
              isDragOver && !disabled ? 'text-primary' : 'text-muted-foreground'
            )}
          />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {canAddMore
              ? 'Drop design screenshots here or click to browse'
              : 'Maximum screenshots reached'}
          </p>
          <p className="text-xs text-muted-foreground">
            {canAddMore
              ? `${ALLOWED_IMAGE_TYPES_DISPLAY} up to 10MB each (${images.length}/${MAX_IMAGES_PER_TASK})`
              : `${MAX_IMAGES_PER_TASK} screenshots maximum`}
          </p>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Duplicate upload confirmation */}
      {duplicateConfirmation && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Copy className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Duplicate Screenshot Detected
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                "{duplicateConfirmation.filename}" appears to be the same as "{duplicateConfirmation.existingFilename}".
                Is this intentional (e.g., different states of the same component)?
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancelDuplicate}
            >
              Skip This File
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleConfirmDuplicate}
            >
              Yes, Add Anyway
            </Button>
          </div>
        </div>
      )}

      {/* Low quality image warnings */}
      {lowQualityWarnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-300/50 p-3 text-sm">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium">
            <AlertCircle className="h-4 w-4" />
            Image Quality Warning
          </div>
          <ul className="ml-6 list-disc space-y-0.5">
            {lowQualityWarnings.map((warning, idx) => (
              <li key={idx} className="text-xs text-amber-600 dark:text-amber-300">
                {warning}
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-600 dark:text-amber-300 italic">
            Low resolution images may result in less accurate analysis. Consider uploading higher resolution screenshots.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLowQualityWarnings([])}
            className="self-end text-amber-700 dark:text-amber-400 hover:text-amber-800"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Screenshot previews */}
      {images.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Uploaded Screenshots ({images.length})
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleClearAll();
              }}
              disabled={disabled || isAnalyzing}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4 mr-1" />
              Clear All
            </Button>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {images.map((image) => (
              <div
                key={image.id}
                className="relative group rounded-lg border border-border bg-card overflow-hidden"
              >
                {/* Thumbnail or placeholder */}
                <div className="aspect-square flex items-center justify-center bg-muted">
                  {image.thumbnail ? (
                    <img
                      src={image.thumbnail}
                      alt={image.filename}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>

                {/* File info overlay */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                  <p className="text-[10px] text-white font-medium truncate">
                    {image.filename}
                  </p>
                  <p className="text-[9px] text-white/70">{formatFileSize(image.size)}</p>
                </div>

                {/* Remove button */}
                {!disabled && !isAnalyzing && (
                  <Button
                    variant="destructive"
                    size="icon"
                    className={cn(
                      'absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity',
                      'rounded-full'
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(image.id);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}

                {/* Large file warning indicator */}
                {image.size > MAX_IMAGE_SIZE && (
                  <div
                    className="absolute top-1 left-1 p-0.5 rounded-full bg-warning/90"
                    title="Large file - consider compressing"
                  >
                    <AlertCircle className="h-3 w-3 text-warning-foreground" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Analyze button */}
          <Button
            onClick={(e) => {
              e.stopPropagation();
              handleAnalyze();
            }}
            disabled={!canAnalyze}
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing Screenshots...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Analyze Screenshots
              </>
            )}
          </Button>
        </div>
      )}

      {/* Warnings from analysis */}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg bg-warning/10 border border-warning/30 p-3 text-sm text-warning-foreground">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            Analysis Warnings
          </div>
          <ul className="ml-6 list-disc space-y-0.5">
            {warnings.map((warning, idx) => (
              <li key={idx} className="text-xs text-warning-foreground/80">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Questions for ambiguous components */}
      {questions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-300/50 p-3 text-sm">
          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-medium">
            <HelpCircle className="h-4 w-4" />
            Clarification Needed
          </div>
          <p className="text-xs text-blue-600 dark:text-blue-300">
            The AI identified some components that may need clarification for accurate implementation:
          </p>
          <ul className="ml-4 space-y-1.5">
            {questions.map((question, idx) => (
              <li key={idx} className="text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
                <span className="text-blue-500 font-medium shrink-0">Q{idx + 1}:</span>
                <span>{question}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-blue-500 dark:text-blue-400 italic mt-1">
            You can edit the generated tasks below to provide additional context, or continue with the AI's best interpretation.
          </p>
        </div>
      )}

      {/* Complex design notice with batch navigation */}
      {isComplexDesign && generatedTasks.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-300/50 p-3 text-sm">
          <div className="flex items-center gap-2 text-purple-700 dark:text-purple-400 font-medium">
            <Layers className="h-4 w-4" />
            Complex Design Detected
          </div>
          <p className="text-xs text-purple-600 dark:text-purple-300">
            This design contains {generatedTasks.length} tasks. We recommend implementing in batches
            of {Math.min(10, Math.ceil(generatedTasks.length / 2))} tasks at a time for easier management.
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-purple-600 dark:text-purple-400">
              Viewing batch {taskBatchIndex + 1} of {Math.ceil(generatedTasks.length / 10)}
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTaskBatchIndex(Math.max(0, taskBatchIndex - 1))}
                disabled={taskBatchIndex === 0}
                className="h-6 px-2 text-purple-700 dark:text-purple-400"
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTaskBatchIndex(Math.min(Math.ceil(generatedTasks.length / 10) - 1, taskBatchIndex + 1))}
                disabled={taskBatchIndex >= Math.ceil(generatedTasks.length / 10) - 1}
                className="h-6 px-2 text-purple-700 dark:text-purple-400"
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsComplexDesign(false)}
                className="h-6 px-2 text-purple-700 dark:text-purple-400"
              >
                Show All
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Generated tasks */}
      {generatedTasks.length > 0 && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Generated Tasks ({generatedTasks.filter((t) => t.selected).length} selected)
            </p>
          </div>

          <div className="space-y-2">
            {(isComplexDesign
              ? generatedTasks.slice(taskBatchIndex * 10, (taskBatchIndex + 1) * 10)
              : generatedTasks
            ).map((task) => (
              <div
                key={task.id}
                className={cn(
                  'rounded-lg border p-3 transition-colors',
                  task.selected
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border bg-card/50'
                )}
              >
                {editingTaskId === task.id ? (
                  // Edit mode
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      className="w-full px-2 py-1 text-sm font-medium bg-background border border-border rounded"
                      placeholder="Task title"
                    />
                    <textarea
                      value={editingDescription}
                      onChange={(e) => setEditingDescription(e.target.value)}
                      className="w-full px-2 py-1 text-sm bg-background border border-border rounded resize-none"
                      rows={2}
                      placeholder="Task description"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelEdit}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveEdit}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <div className="flex items-start gap-3">
                    {/* Selection checkbox */}
                    <button
                      type="button"
                      onClick={() => handleToggleTask(task.id)}
                      className={cn(
                        'mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                        task.selected
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'border-muted-foreground/50 hover:border-primary'
                      )}
                    >
                      {task.selected && <Check className="h-3 w-3" />}
                    </button>

                    {/* Task content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{task.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {task.description}
                      </p>
                      {task.filePath && (
                        <p className="text-[10px] text-primary/70 mt-1 font-mono">
                          {task.filePath}
                        </p>
                      )}
                      {task.implementation && task.implementation.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {task.implementation.slice(0, 3).map((item, idx) => (
                            <li
                              key={idx}
                              className="text-[10px] text-muted-foreground flex items-start gap-1"
                            >
                              <span className="text-primary/50">•</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Edit button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => handleStartEdit(task)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Use selected tasks button */}
          {onTasksGenerated && (
            <Button
              onClick={handleUseSelectedTasks}
              disabled={generatedTasks.filter((t) => t.selected).length === 0}
              variant="outline"
              className="w-full"
            >
              Use Selected Tasks ({generatedTasks.filter((t) => t.selected).length})
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
