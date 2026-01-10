import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  IPCResult,
  DependencyGraph,
  DependencyNode,
  DependencyEdge
} from '../../../shared/types';
import { projectStore } from '../../project-store';

/**
 * Parse npm package.json to extract dependency graph
 */
function parseNpmDependencies(projectPath: string): DependencyGraph | null {
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];
    const projectName = packageJson.name || 'Project';

    // Add root node for the project itself
    nodes.push({
      id: projectName,
      name: projectName,
      version: packageJson.version,
      type: 'direct',
      group: 0
    });

    // Process direct dependencies
    if (packageJson.dependencies && typeof packageJson.dependencies === 'object') {
      Object.entries(packageJson.dependencies).forEach(([name, version]) => {
        const nodeId = `dep-${name}`;
        nodes.push({
          id: nodeId,
          name,
          version: typeof version === 'string' ? version : undefined,
          type: 'direct',
          group: 1
        });
        edges.push({
          source: projectName,
          target: nodeId,
          type: 'requires'
        });
      });
    }

    // Process dev dependencies
    if (packageJson.devDependencies && typeof packageJson.devDependencies === 'object') {
      Object.entries(packageJson.devDependencies).forEach(([name, version]) => {
        const nodeId = `dev-${name}`;
        nodes.push({
          id: nodeId,
          name,
          version: typeof version === 'string' ? version : undefined,
          type: 'dev',
          group: 2
        });
        edges.push({
          source: projectName,
          target: nodeId,
          type: 'devRequires'
        });
      });
    }

    // Process peer dependencies
    if (packageJson.peerDependencies && typeof packageJson.peerDependencies === 'object') {
      Object.entries(packageJson.peerDependencies).forEach(([name, version]) => {
        const nodeId = `peer-${name}`;
        nodes.push({
          id: nodeId,
          name,
          version: typeof version === 'string' ? version : undefined,
          type: 'peer',
          group: 3
        });
        edges.push({
          source: projectName,
          target: nodeId,
          type: 'peerRequires'
        });
      });
    }

    // Process optional dependencies
    if (packageJson.optionalDependencies && typeof packageJson.optionalDependencies === 'object') {
      Object.entries(packageJson.optionalDependencies).forEach(([name, version]) => {
        const nodeId = `opt-${name}`;
        nodes.push({
          id: nodeId,
          name,
          version: typeof version === 'string' ? version : undefined,
          type: 'optional',
          group: 4
        });
        edges.push({
          source: projectName,
          target: nodeId,
          type: 'optionalRequires'
        });
      });
    }

    return {
      nodes,
      edges,
      projectName
    };
  } catch (error) {
    console.error('[dependency-graph] Failed to parse package.json:', error);
    return null;
  }
}

/**
 * Parse Python requirements.txt to extract dependency graph
 */
function parsePythonDependencies(projectPath: string): DependencyGraph | null {
  const requirementsPath = path.join(projectPath, 'requirements.txt');
  if (!existsSync(requirementsPath)) {
    return null;
  }

  try {
    const content = readFileSync(requirementsPath, 'utf-8');
    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];

    // Get project name from directory or use default
    const projectName = path.basename(projectPath);

    // Add root node for the project itself
    nodes.push({
      id: projectName,
      name: projectName,
      type: 'direct',
      group: 0
    });

    // Parse each line
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Skip editable installs and URLs
      if (trimmed.startsWith('-e') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        continue;
      }

      // Parse package name and version
      // Handle formats like: package==1.0.0, package>=1.0.0, package~=1.0.0, package[extra]==1.0.0
      const match = trimmed.match(/^([a-zA-Z0-9_-]+(?:\[[\w,]+\])?)\s*([><=~!]+)\s*(.+)$/);
      let name: string;
      let version: string | undefined;

      if (match) {
        name = match[1].replace(/\[.*\]/, ''); // Remove extras
        version = match[3];
      } else {
        // Just a package name without version specifier
        name = trimmed.split(/\s+/)[0];
      }

      const nodeId = `dep-${name}`;
      nodes.push({
        id: nodeId,
        name,
        version,
        type: 'direct',
        group: 1
      });
      edges.push({
        source: projectName,
        target: nodeId,
        type: 'requires'
      });
    }

    return {
      nodes,
      edges,
      projectName
    };
  } catch (error) {
    console.error('[dependency-graph] Failed to parse requirements.txt:', error);
    return null;
  }
}

/**
 * Detect if project is a monorepo and aggregate dependencies
 */
function detectMonorepoDependencies(projectPath: string): DependencyGraph | null {
  try {
    // Check for common monorepo patterns
    const hasPackagesDir = existsSync(path.join(projectPath, 'packages'));
    const hasAppsDir = existsSync(path.join(projectPath, 'apps'));
    const hasWorkspacesPackageJson = existsSync(path.join(projectPath, 'package.json'));

    if (!hasWorkspacesPackageJson) {
      return null;
    }

    const rootPackageJson = JSON.parse(readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
    const hasWorkspaces = rootPackageJson.workspaces && Array.isArray(rootPackageJson.workspaces);

    if (!hasWorkspaces && !hasPackagesDir && !hasAppsDir) {
      return null;
    }

    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];
    const projectName = rootPackageJson.name || path.basename(projectPath);

    // Add root node
    nodes.push({
      id: projectName,
      name: projectName,
      version: rootPackageJson.version,
      type: 'direct',
      group: 0
    });

    // Scan workspace packages
    const workspaceDirs = ['packages', 'apps'];
    const addedDeps = new Set<string>();

    for (const workspaceDir of workspaceDirs) {
      const workspacePath = path.join(projectPath, workspaceDir);
      if (!existsSync(workspacePath)) continue;

      const packages = readdirSync(workspacePath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const pkg of packages) {
        const pkgPath = path.join(workspacePath, pkg);
        const pkgJsonPath = path.join(pkgPath, 'package.json');

        if (!existsSync(pkgJsonPath)) continue;

        try {
          const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

          // Add package as a workspace node
          const workspaceId = `workspace-${pkgJson.name || pkg}`;
          if (!addedDeps.has(workspaceId)) {
            nodes.push({
              id: workspaceId,
              name: pkgJson.name || pkg,
              version: pkgJson.version,
              type: 'direct',
              group: 1
            });
            edges.push({
              source: projectName,
              target: workspaceId,
              type: 'requires'
            });
            addedDeps.add(workspaceId);
          }

          // Add its dependencies
          if (pkgJson.dependencies) {
            Object.entries(pkgJson.dependencies).forEach(([name, version]) => {
              const depId = `dep-${name}`;
              if (!addedDeps.has(depId)) {
                nodes.push({
                  id: depId,
                  name,
                  version: typeof version === 'string' ? version : undefined,
                  type: 'direct',
                  group: 2
                });
                addedDeps.add(depId);
              }
              edges.push({
                source: workspaceId,
                target: depId,
                type: 'requires'
              });
            });
          }
        } catch {
          // Skip invalid package.json files
          continue;
        }
      }
    }

    return nodes.length > 1 ? { nodes, edges, projectName } : null;
  } catch (error) {
    console.error('[dependency-graph] Failed to detect monorepo dependencies:', error);
    return null;
  }
}

/**
 * Get dependency graph for a project
 */
function getDependencyGraph(projectPath: string): DependencyGraph | null {
  // Try monorepo detection first
  const monorepoDeps = detectMonorepoDependencies(projectPath);
  if (monorepoDeps) {
    return monorepoDeps;
  }

  // Try npm dependencies
  const npmDeps = parseNpmDependencies(projectPath);
  if (npmDeps) {
    return npmDeps;
  }

  // Try Python dependencies
  const pythonDeps = parsePythonDependencies(projectPath);
  if (pythonDeps) {
    return pythonDeps;
  }

  return null;
}

/**
 * Register dependency graph handlers
 */
export function registerDependencyGraphHandlers(
  _getMainWindow: () => BrowserWindow | null
): void {
  // Get dependency graph
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_GET_DEPENDENCY_GRAPH,
    async (_, projectId: string): Promise<IPCResult<DependencyGraph>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const dependencyGraph = getDependencyGraph(project.path);

        if (!dependencyGraph) {
          return {
            success: false,
            error: 'No dependency files found (package.json or requirements.txt)'
          };
        }

        return {
          success: true,
          data: dependencyGraph
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load dependency graph'
        };
      }
    }
  );
}
