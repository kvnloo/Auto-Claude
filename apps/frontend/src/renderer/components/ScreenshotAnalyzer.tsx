import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { Upload, X, AlertCircle, Image as ImageIcon, Loader2, Sparkles, FileText, Pencil, Check } from 'lucide-react';
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
}

/**
 * Screenshot analysis API configuration
 * Backend runs on port 8000 by default
 */
const SCREENSHOT_API_BASE_URL = 'http://localhost:8000';

/**
 * Analyze screenshots using the backend vision API
 */
async function analyzeScreenshotsAPI(
  images: ImageAttachment[],
  projectContext?: string
): Promise<{ tasks: GeneratedTask[]; warnings: string[] }> {
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
    warnings: data.warnings || []
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
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canAddMore = images.length < MAX_IMAGES_PER_TASK;
  const hasImages = images.length > 0;
  const canAnalyze = hasImages && !isAnalyzing && !disabled;

  /**
   * Process files and add them to the images array
   */
  const processFiles = useCallback(
    async (files: FileList | File[]) => {
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
            data: dataUrl.split(',')[1], // Store base64 without data URL prefix
            thumbnail
          });
        } catch {
          errors.push(`Failed to process "${file.name}"`);
        }
      }

      if (errors.length > 0) {
        setError(errors.join(' '));
      }

      if (newImages.length > 0) {
        setImages((prev) => [...prev, ...newImages]);
        // Clear previous analysis results when new images are added
        setGeneratedTasks([]);
      }
    },
    [images]
  );

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
    setError(null);
  }, []);

  /**
   * Analyze screenshots using vision API
   */
  const handleAnalyze = useCallback(async () => {
    if (!canAnalyze) return;

    setIsAnalyzing(true);
    setError(null);
    setWarnings([]);

    try {
      const result = await analyzeScreenshotsAPI(images);

      setGeneratedTasks(result.tasks);
      setWarnings(result.warnings);

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
            {generatedTasks.map((task) => (
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
