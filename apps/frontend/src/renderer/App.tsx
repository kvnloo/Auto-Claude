import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2, Download, RefreshCw, AlertCircle } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy
} from '@dnd-kit/sortable';
import { TooltipProvider } from './components/ui/tooltip';
import { Button } from './components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './components/ui/tooltip';
import { Sidebar, type SidebarView } from './components/Sidebar';
import { KanbanBoard } from './components/KanbanBoard';
import { TaskDetailModal } from './components/task-detail/TaskDetailModal';
import { TaskCreationWizard } from './components/TaskCreationWizard';
import { AppSettingsDialog, type AppSection } from './components/settings/AppSettings';
import type { ProjectSettingsSection } from './components/settings/ProjectSettingsContent';
import { TerminalGrid } from './components/TerminalGrid';
import { Roadmap } from './components/Roadmap';
import { Context } from './components/Context';
import { Ideation } from './components/Ideation';
import { Insights } from './components/Insights';
import { GitHubIssues } from './components/GitHubIssues';
import { GitHubPRs } from './components/github-prs';
import { Changelog } from './components/Changelog';
import { Worktrees } from './components/Worktrees';
import { CodebaseExplorer } from './components/explorer/CodebaseExplorer';
import { WelcomeScreen } from './components/WelcomeScreen';
import { RateLimitModal } from './components/RateLimitModal';
import { SDKRateLimitModal } from './components/SDKRateLimitModal';
import { OnboardingWizard } from './components/onboarding';
import { AppUpdateNotification } from './components/AppUpdateNotification';
import { UsageIndicator } from './components/UsageIndicator';
import { ProactiveSwapListener } from './components/ProactiveSwapListener';
import { GitHubSetupModal } from './components/GitHubSetupModal';
import { useProjectStore, loadProjects, addProject, initializeProject } from './stores/project-store';
import { useTaskStore, loadTasks } from './stores/task-store';
import { useSettingsStore, loadSettings } from './stores/settings-store';
import { useTerminalStore, restoreTerminalSessions } from './stores/terminal-store';
import { initializeGitHubListeners } from './stores/github';
import { useIpcListeners } from './hooks/useIpc';
import { COLOR_THEMES, UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_DEFAULT } from '../shared/constants';
import type { Task, Project, ColorTheme } from '../shared/types';
import { ProjectTabBar } from './components/ProjectTabBar';

export function App() {
  // Load IPC listeners for real-time updates
  useIpcListeners();

  // Stores
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const getProjectTabs = useProjectStore((state) => state.getProjectTabs);
  const openProjectIds = useProjectStore((state) => state.openProjectIds);
  const openProjectTab = useProjectStore((state) => state.openProjectTab);
  const closeProjectTab = useProjectStore((state) => state.closeProjectTab);
  const setActiveProject = useProjectStore((state) => state.setActiveProject);
  const reorderTabs = useProjectStore((state) => state.reorderTabs);
  const tasks = useTaskStore((state) => state.tasks);
  const settings = useSettingsStore((state) => state.settings);
  const settingsLoading = useSettingsStore((state) => state.isLoading);

  // UI State
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isNewTaskDialogOpen, setIsNewTaskDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<AppSection | undefined>(undefined);
  const [settingsInitialProjectSection, setSettingsInitialProjectSection] = useState<ProjectSettingsSection | undefined>(undefined);
  const [activeView, setActiveView] = useState<SidebarView>('kanban');
  const [isOnboardingWizardOpen, setIsOnboardingWizardOpen] = useState(false);

  // Initialize dialog state
  const [showInitDialog, setShowInitDialog] = useState(false);
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initSuccess, setInitSuccess] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [skippedInitProjectId, setSkippedInitProjectId] = useState<string | null>(null);

  // GitHub setup state (shown after Auto Claude init)
  const [showGitHubSetup, setShowGitHubSetup] = useState(false);
  const [gitHubSetupProject, setGitHubSetupProject] = useState<Project | null>(null);

  // Setup drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    })
  );

  // Track dragging state for overlay
  const [activeDragProject, setActiveDragProject] = useState<Project | null>(null);

  // Get tabs and selected project
  const projectTabs = getProjectTabs();
  const selectedProject = projects.find((p) => p.id === (activeProjectId || selectedProjectId));

  // Initial load
  useEffect(() => {
    loadProjects();
    loadSettings();
    // Initialize global GitHub listeners (PR reviews, etc.) so they persist across navigation
    initializeGitHubListeners();
  }, []);

  // Restore tab state and open tabs for loaded projects
  useEffect(() => {
    console.log('[App] Tab restore useEffect triggered:', {
      projectsCount: projects.length,
      openProjectIds,
      activeProjectId,
      selectedProjectId,
      projectTabsCount: projectTabs.length,
      projectTabIds: projectTabs.map(p => p.id)
    });

    if (projects.length > 0) {
      // Check openProjectIds (persisted state) instead of projectTabs (computed)
      // to avoid race condition where projectTabs is empty before projects load
      if (openProjectIds.length === 0) {
        // No tabs persisted at all, open the first available project
        const projectToOpen = activeProjectId || selectedProjectId || projects[0].id;
        console.log('[App] No tabs persisted, opening project:', projectToOpen);
        // Verify the project exists before opening
        if (projects.some(p => p.id === projectToOpen)) {
          openProjectTab(projectToOpen);
          setActiveProject(projectToOpen);
        } else {
          // Fallback to first project if stored IDs are invalid
          console.log('[App] Project not found, falling back to first project:', projects[0].id);
          openProjectTab(projects[0].id);
          setActiveProject(projects[0].id);
        }
        return;
      }
      console.log('[App] Tabs already persisted, checking active project');
      // If there's an active project but no tabs open for it, open a tab
      // Note: Use openProjectIds instead of projectTabs to avoid re-render loop
      // (projectTabs creates a new array on every render)
      if (activeProjectId && !openProjectIds.includes(activeProjectId)) {
        console.log('[App] Active project has no tab, opening:', activeProjectId);
        openProjectTab(activeProjectId);
      }
      // If there's a selected project but no active project, make it active
      else if (selectedProjectId && !activeProjectId) {
        console.log('[App] No active project, using selected:', selectedProjectId);
        setActiveProject(selectedProjectId);
        openProjectTab(selectedProjectId);
      } else {
        console.log('[App] Tab state is valid, no action needed');
      }
    }
  }, [projects, activeProjectId, selectedProjectId, openProjectIds, openProjectTab, setActiveProject]);

  // Track if settings have been loaded at least once
  const [settingsHaveLoaded, setSettingsHaveLoaded] = useState(false);

  // Mark settings as loaded when loading completes
  useEffect(() => {
    if (!settingsLoading && !settingsHaveLoaded) {
      setSettingsHaveLoaded(true);
    }
  }, [settingsLoading, settingsHaveLoaded]);

  // First-run detection - show onboarding wizard if not completed
  // Only check AFTER settings have been loaded from disk to avoid race condition
  useEffect(() => {
    if (settingsHaveLoaded && settings.onboardingCompleted === false) {
      setIsOnboardingWizardOpen(true);
    }
  }, [settingsHaveLoaded, settings.onboardingCompleted]);

  // Sync i18n language with settings
  const { t, i18n } = useTranslation('dialogs');
  useEffect(() => {
    if (settings.language && settings.language !== i18n.language) {
      i18n.changeLanguage(settings.language);
    }
  }, [settings.language, i18n]);

  // Listen for open-app-settings events (e.g., from project settings)
  useEffect(() => {
    const handleOpenAppSettings = (event: Event) => {
      const customEvent = event as CustomEvent<AppSection>;
      const section = customEvent.detail;
      if (section) {
        setSettingsInitialSection(section);
      }
      setIsSettingsDialogOpen(true);
    };

    window.addEventListener('open-app-settings', handleOpenAppSettings);
    return () => {
      window.removeEventListener('open-app-settings', handleOpenAppSettings);
    };
  }, []);

  // Listen for app updates - auto-open settings to 'updates' section when update is ready
  useEffect(() => {
    // When an update is downloaded and ready to install, open settings to updates section
    const cleanupDownloaded = window.electronAPI.onAppUpdateDownloaded(() => {
      console.warn('[App] Update downloaded, opening settings to updates section');
      setSettingsInitialSection('updates');
      setIsSettingsDialogOpen(true);
    });

    return () => {
      cleanupDownloaded();
    };
  }, []);

  // Reset init success flag when selected project changes
  // This allows the init dialog to show for new/different projects
  useEffect(() => {
    setInitSuccess(false);
    setInitError(null);
  }, [selectedProjectId]);

  // Check if selected project needs initialization (e.g., .auto-claude folder was deleted)
  useEffect(() => {
    // Don't show dialog while initialization is in progress
    if (isInitializing) return;

    // Don't reopen dialog after successful initialization
    // (project update with autoBuildPath may not have propagated yet)
    if (initSuccess) return;

    if (selectedProject && !selectedProject.autoBuildPath && skippedInitProjectId !== selectedProject.id) {
      // Project exists but isn't initialized - show init dialog
      setPendingProject(selectedProject);
      setInitError(null); // Clear any previous errors
      setInitSuccess(false); // Reset success flag
      setShowInitDialog(true);
    }
  }, [selectedProject, skippedInitProjectId, isInitializing, initSuccess]);

  // Global keyboard shortcut: Cmd/Ctrl+T to add project (when not on terminals view)
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Skip if in input fields
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Cmd/Ctrl+T: Add new project (only when not on terminals view)
      if ((e.ctrlKey || e.metaKey) && e.key === 't' && activeView !== 'terminals') {
        e.preventDefault();
        try {
          const path = await window.electronAPI.selectDirectory();
          if (path) {
            const project = await addProject(path);
            if (project) {
              openProjectTab(project.id);
              if (!project.autoBuildPath) {
                setPendingProject(project);
                setInitError(null);
                setInitSuccess(false);
                setShowInitDialog(true);
              }
            }
          }
        } catch (error) {
          console.error('Failed to add project:', error);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView, openProjectTab]);

  // Load tasks when project changes
  useEffect(() => {
    const currentProjectId = activeProjectId || selectedProjectId;
    if (currentProjectId) {
      loadTasks(currentProjectId);
      setSelectedTask(null); // Clear selection on project change
    } else {
      useTaskStore.getState().clearTasks();
    }

    // Handle terminals on project change - DON'T destroy, just restore if needed
    // Terminals are now filtered by projectPath in TerminalGrid, so each project
    // sees only its own terminals. PTY processes stay alive across project switches.
    if (selectedProject?.path) {
      restoreTerminalSessions(selectedProject.path).catch((err) => {
        console.error('[App] Failed to restore sessions:', err);
      });
    }
  }, [activeProjectId, selectedProjectId, selectedProject?.path, selectedProject?.name]);

  // Apply theme on load
  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = () => {
      // Apply light/dark mode
      if (settings.theme === 'dark') {
        root.classList.add('dark');
      } else if (settings.theme === 'light') {
        root.classList.remove('dark');
      } else {
        // System preference
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }
    };

    // Apply color theme via data-theme attribute
    // Validate colorTheme against known themes, fallback to 'default' if invalid
    const validThemeIds = COLOR_THEMES.map((t) => t.id);
    const rawColorTheme = settings.colorTheme ?? 'default';
    const colorTheme: ColorTheme = validThemeIds.includes(rawColorTheme as ColorTheme)
      ? (rawColorTheme as ColorTheme)
      : 'default';

    if (colorTheme === 'default') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', colorTheme);
    }

    applyTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (settings.theme === 'system') {
        applyTheme();
      }
    };
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [settings.theme, settings.colorTheme]);

  // Apply UI scale
  useEffect(() => {
    const root = document.documentElement;
    const scale = settings.uiScale ?? UI_SCALE_DEFAULT;
    const clampedScale = Math.max(UI_SCALE_MIN, Math.min(scale, UI_SCALE_MAX));
    root.style.setProperty('--ui-scale', clampedScale.toString());
  }, [settings.uiScale]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <TooltipProvider>
        <div className="app-container">
          {/* Main content area */}
          <div className="flex h-screen flex-col">
            {/* Top bar - tabs and controls */}
            <div className="border-b border-border bg-background">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <ProjectTabBar
                    tabs={projectTabs}
                    activeTabId={activeProjectId || selectedProjectId}
                    onTabClick={setActiveProject}
                    onTabClose={closeProjectTab}
                    onReorder={handleTabReorder}
                  />
                </div>
                {/* Top right controls */}
                <div className="flex items-center gap-1 px-3 py-2">
                  {/* Language selector */}
                  {/* Settings button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSettingsInitialSection(undefined);
                          setIsSettingsDialogOpen(true);
                        }}
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Settings</TooltipContent>
                  </Tooltip>

                  {/* Usage indicator */}
                  <UsageIndicator />

                  {/* Update notification */}
                  <AppUpdateNotification />
                </div>
              </div>
            </div>

            {/* Main content */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left sidebar */}
              {selectedProject && (
                <div className="border-r border-border">
                  <Sidebar
                    activeView={activeView}
                    onViewChange={setActiveView}
                    selectedTask={selectedTask}
                    onTaskSelect={setSelectedTask}
                    onNewTaskClick={() => setIsNewTaskDialogOpen(true)}
                    onOpenProjectSettings={() => {
                      setSettingsInitialProjectSection('settings');
                      setIsSettingsDialogOpen(true);
                    }}
                  />
                </div>
              )}

              {/* Right content area */}
              <div className="flex-1 overflow-auto">
                {!selectedProject ? (
                  <WelcomeScreen />
                ) : (
                  <>
                    {activeView === 'kanban' && <KanbanBoard />}
                    {activeView === 'roadmap' && <Roadmap />}
                    {activeView === 'context' && <Context />}
                    {activeView === 'ideation' && <Ideation />}
                    {activeView === 'insights' && <Insights />}
                    {activeView === 'github-issues' && <GitHubIssues />}
                    {activeView === 'github-prs' && <GitHubPRs />}
                    {activeView === 'changelog' && <Changelog />}
                    {activeView === 'worktrees' && <Worktrees />}
                    {activeView === 'explorer' && <CodebaseExplorer />}
                    {activeView === 'terminals' && <TerminalGrid />}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Modals and Dialogs */}
          <TaskDetailModal open={!!selectedTask} task={selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)} />

          <TaskCreationWizard open={isNewTaskDialogOpen} onOpenChange={setIsNewTaskDialogOpen} />

          {/* Settings Dialog */}
          <AppSettingsDialog open={isSettingsDialogOpen} onOpenChange={setIsSettingsDialogOpen} initialSection={settingsInitialSection} initialProjectSection={settingsInitialProjectSection} />

          {/* Project Initialization Dialog */}
          <Dialog open={showInitDialog} onOpenChange={setShowInitDialog}>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Initialize Project</DialogTitle>
                <DialogDescription>
                  This project needs to be initialized with the Auto Claude build system to enable advanced features like codebase analysis and automated insights.
                </DialogDescription>
              </DialogHeader>

              {initError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <div>{initError}</div>
                </div>
              )}

              {initSuccess && (
                <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
                  ✓ Project initialized successfully!
                </div>
              )}

              {!initSuccess && (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Auto Claude will:</p>
                  <ul className="list-inside space-y-1 ml-2">
                    <li>✓ Create a build cache (.auto-claude folder)</li>
                    <li>✓ Index your codebase for analysis</li>
                    <li>✓ Enable intelligent code insights</li>
                  </ul>
                </div>
              )}

              <DialogFooter className="gap-2 sm:gap-0">
                {!initSuccess && (
                  <>
                    <Button variant="outline" onClick={() => handleSkipInit(pendingProject)} disabled={isInitializing}>
                      Skip for Now
                    </Button>
                    <Button onClick={() => handleInitProject(pendingProject)} disabled={isInitializing} className="gap-2">
                      {isInitializing && <RefreshCw className="h-4 w-4 animate-spin" />}
                      {isInitializing ? 'Initializing...' : 'Initialize Project'}
                    </Button>
                  </>
                )}

                {initSuccess && (
                  <>
                    {pendingProject && !pendingProject.gitHubToken && (
                      <Button onClick={() => handleSetupGitHub(pendingProject)} className="gap-2">
                        <Download className="h-4 w-4" />
                        Connect GitHub (Optional)
                      </Button>
                    )}
                    <Button onClick={() => handleInitDialogClose()}>Done</Button>
                  </>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* GitHub Setup Modal (shown after successful init) */}
          {gitHubSetupProject && (
            <GitHubSetupModal
              project={gitHubSetupProject}
              onClose={() => {
                setShowGitHubSetup(false);
                setGitHubSetupProject(null);
              }}
            />
          )}

          {/* Onboarding Wizard */}
          <OnboardingWizard open={isOnboardingWizardOpen} onOpenChange={setIsOnboardingWizardOpen} />

          {/* Rate Limit Modal */}
          <RateLimitModal />

          {/* SDK Rate Limit Modal */}
          <SDKRateLimitModal />

          {/* Proactive Swap Listener (background monitoring for swap space issues) */}
          <ProactiveSwapListener />
        </div>

        <DragOverlay>
          {activeDragProject ? <ProjectTabBar.DragOverlay project={activeDragProject} /> : null}
        </DragOverlay>
      </TooltipProvider>
    </DndContext>
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragProject(null);

    if (!over || active.id === over.id) return;

    const activeIndex = projectTabs.findIndex((tab) => tab.id === active.id);
    const overIndex = projectTabs.findIndex((tab) => tab.id === over.id);

    if (activeIndex !== -1 && overIndex !== -1) {
      const newOrder = projectTabs.map((t) => t.id);
      const [removed] = newOrder.splice(activeIndex, 1);
      newOrder.splice(overIndex, 0, removed);
      reorderTabs(newOrder);
    }
  }

  function handleTabReorder(newOrder: string[]) {
    reorderTabs(newOrder);
  }

  async function handleInitProject(project: Project | null) {
    if (!project) return;

    setIsInitializing(true);
    setInitError(null);

    try {
      await initializeProject(project.id);
      setInitSuccess(true);

      // Show GitHub setup after init if not already connected
      if (!project.gitHubToken) {
        // Wait a moment for state to propagate, then show GitHub setup
        setTimeout(() => {
          setShowGitHubSetup(true);
          setGitHubSetupProject(project);
        }, 500);
      }
    } catch (error) {
      console.error('[App] Project initialization failed:', error);
      setInitError(error instanceof Error ? error.message : 'Failed to initialize project');
    } finally {
      setIsInitializing(false);
    }
  }

  function handleSkipInit(project: Project | null) {
    if (project) {
      setSkippedInitProjectId(project.id);
    }
    setShowInitDialog(false);
  }

  function handleSetupGitHub(project: Project | null) {
    if (project) {
      setGitHubSetupProject(project);
      setShowGitHubSetup(true);
    }
  }

  function handleInitDialogClose() {
    setShowInitDialog(false);
    setPendingProject(null);
    setInitSuccess(false);
    setInitError(null);
  }
}