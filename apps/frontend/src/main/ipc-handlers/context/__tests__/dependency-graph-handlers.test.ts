/**
 * Unit tests for dependency graph handlers
 * Tests parsing of dependency files for various project types and edge cases
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { DependencyGraph } from '../../../../shared/types';

// Test data directory
let TEST_DIR: string;
let TEST_PROJECT_PATH: string;

/**
 * Parse npm package.json to extract dependency graph
 * Copied from dependency-graph-handlers.ts for testing
 */
function parseNpmDependencies(projectPath: string): DependencyGraph | null {
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = require('fs').readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    const nodes: DependencyGraph['nodes'] = [];
    const edges: DependencyGraph['edges'] = [];
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
    return null;
  }
}

/**
 * Parse Python requirements.txt to extract dependency graph
 * Copied from dependency-graph-handlers.ts for testing
 */
function parsePythonDependencies(projectPath: string): DependencyGraph | null {
  const requirementsPath = path.join(projectPath, 'requirements.txt');
  if (!existsSync(requirementsPath)) {
    return null;
  }

  try {
    const content = require('fs').readFileSync(requirementsPath, 'utf-8');
    const nodes: DependencyGraph['nodes'] = [];
    const edges: DependencyGraph['edges'] = [];

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
    return null;
  }
}

/**
 * Detect if project is a monorepo and aggregate dependencies
 * Copied from dependency-graph-handlers.ts for testing
 */
function detectMonorepoDependencies(projectPath: string): DependencyGraph | null {
  try {
    const { readdirSync, readFileSync } = require('fs');

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

    const nodes: DependencyGraph['nodes'] = [];
    const edges: DependencyGraph['edges'] = [];
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
    return null;
  }
}

// Setup and cleanup
function setupTestDir(): void {
  TEST_DIR = mkdtempSync(path.join(tmpdir(), 'dep-graph-test-'));
  TEST_PROJECT_PATH = path.join(TEST_DIR, 'test-project');
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });
}

function cleanupTestDir(): void {
  if (TEST_DIR && existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('Dependency Graph Handlers', () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  describe('parseNpmDependencies', () => {
    it('should return null when package.json does not exist', () => {
      const result = parseNpmDependencies(TEST_PROJECT_PATH);
      expect(result).toBeNull();
    });

    it('should parse basic package.json with dependencies', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0'
        }
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(packageJson)
      );

      const result = parseNpmDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.projectName).toBe('test-package');
      expect(result?.nodes).toHaveLength(3); // 1 root + 2 dependencies
      expect(result?.edges).toHaveLength(2);

      // Check root node
      const rootNode = result?.nodes[0];
      expect(rootNode?.id).toBe('test-package');
      expect(rootNode?.name).toBe('test-package');
      expect(rootNode?.version).toBe('1.0.0');
      expect(rootNode?.type).toBe('direct');

      // Check dependency nodes
      const reactNode = result?.nodes.find(n => n.name === 'react');
      expect(reactNode).toBeDefined();
      expect(reactNode?.id).toBe('dep-react');
      expect(reactNode?.version).toBe('^18.2.0');
      expect(reactNode?.type).toBe('direct');
    });

    it('should parse package.json with all dependency types', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        dependencies: {
          react: '^18.2.0'
        },
        devDependencies: {
          vitest: '^1.0.0',
          typescript: '^5.0.0'
        },
        peerDependencies: {
          'react-native': '>=0.70.0'
        },
        optionalDependencies: {
          fsevents: '^2.3.0'
        }
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(packageJson)
      );

      const result = parseNpmDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(6); // 1 root + 5 dependencies
      expect(result?.edges).toHaveLength(5);

      // Check different dependency types
      const reactNode = result?.nodes.find(n => n.name === 'react');
      expect(reactNode?.type).toBe('direct');
      expect(reactNode?.group).toBe(1);

      const vitestNode = result?.nodes.find(n => n.name === 'vitest');
      expect(vitestNode?.type).toBe('dev');
      expect(vitestNode?.group).toBe(2);

      const peerNode = result?.nodes.find(n => n.name === 'react-native');
      expect(peerNode?.type).toBe('peer');
      expect(peerNode?.group).toBe(3);

      const optNode = result?.nodes.find(n => n.name === 'fsevents');
      expect(optNode?.type).toBe('optional');
      expect(optNode?.group).toBe(4);

      // Check edge types
      const reactEdge = result?.edges.find(e => e.target === 'dep-react');
      expect(reactEdge?.type).toBe('requires');

      const vitestEdge = result?.edges.find(e => e.target === 'dev-vitest');
      expect(vitestEdge?.type).toBe('devRequires');

      const peerEdge = result?.edges.find(e => e.target === 'peer-react-native');
      expect(peerEdge?.type).toBe('peerRequires');

      const optEdge = result?.edges.find(e => e.target === 'opt-fsevents');
      expect(optEdge?.type).toBe('optionalRequires');
    });

    it('should handle package.json without name field', () => {
      const packageJson = {
        version: '1.0.0',
        dependencies: {
          express: '^4.18.0'
        }
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(packageJson)
      );

      const result = parseNpmDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.projectName).toBe('Project');
      expect(result?.nodes[0].name).toBe('Project');
    });

    it('should handle empty dependencies objects', () => {
      const packageJson = {
        name: 'empty-deps',
        version: '1.0.0',
        dependencies: {},
        devDependencies: {}
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(packageJson)
      );

      const result = parseNpmDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(1); // Only root node
      expect(result?.edges).toHaveLength(0);
    });

    it('should handle malformed JSON', () => {
      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        '{ invalid json }'
      );

      const result = parseNpmDependencies(TEST_PROJECT_PATH);

      expect(result).toBeNull();
    });

    it('should handle invalid dependency values', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        dependencies: {
          valid: '^1.0.0',
          invalid: null as unknown as string,
          another: undefined as unknown as string
        }
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(packageJson)
      );

      const result = parseNpmDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      // Should still parse valid dependencies
      const validNode = result?.nodes.find(n => n.name === 'valid');
      expect(validNode).toBeDefined();
    });

    it('should handle non-object dependency fields', () => {
      const packageJson = {
        name: 'test-package',
        version: '1.0.0',
        dependencies: 'not-an-object' as unknown as Record<string, string>
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(packageJson)
      );

      const result = parseNpmDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(1); // Only root node
      expect(result?.edges).toHaveLength(0);
    });
  });

  describe('parsePythonDependencies', () => {
    it('should return null when requirements.txt does not exist', () => {
      const result = parsePythonDependencies(TEST_PROJECT_PATH);
      expect(result).toBeNull();
    });

    it('should parse basic requirements.txt', () => {
      const requirements = `django==4.2.0
flask>=2.0.0
requests~=2.31.0`;

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        requirements
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.projectName).toBe('test-project');
      expect(result?.nodes).toHaveLength(4); // 1 root + 3 dependencies
      expect(result?.edges).toHaveLength(3);

      // Check specific packages
      const djangoNode = result?.nodes.find(n => n.name === 'django');
      expect(djangoNode).toBeDefined();
      expect(djangoNode?.id).toBe('dep-django');
      expect(djangoNode?.version).toBe('4.2.0');
      expect(djangoNode?.type).toBe('direct');

      const flaskNode = result?.nodes.find(n => n.name === 'flask');
      expect(flaskNode?.version).toBe('2.0.0');
    });

    it('should skip comments and empty lines', () => {
      const requirements = `# This is a comment
django==4.2.0

# Another comment
flask>=2.0.0

`;

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        requirements
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(3); // 1 root + 2 dependencies
    });

    it('should skip editable installs', () => {
      const requirements = `-e git+https://github.com/user/repo.git#egg=package
django==4.2.0
-e /path/to/local/package`;

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        requirements
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(2); // 1 root + 1 dependency (django)
    });

    it('should skip URL dependencies', () => {
      const requirements = `http://example.com/package.tar.gz
https://example.com/another.whl
django==4.2.0`;

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        requirements
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(2); // 1 root + 1 dependency (django)
    });

    it('should handle packages with extras', () => {
      const requirements = `requests[security]==2.31.0
django[bcrypt,argon2]>=4.0.0`;

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        requirements
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      // Package names should have extras removed
      const requestsNode = result?.nodes.find(n => n.name === 'requests');
      expect(requestsNode).toBeDefined();
      expect(requestsNode?.version).toBe('2.31.0');

      const djangoNode = result?.nodes.find(n => n.name === 'django');
      expect(djangoNode).toBeDefined();
    });

    it('should handle different version specifiers', () => {
      const requirements = `package1==1.0.0
package2>=2.0.0
package3<=3.0.0
package4~=4.0.0
package5!=5.0.0`;

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        requirements
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(6); // 1 root + 5 dependencies
    });

    it('should handle packages without version specifiers', () => {
      const requirements = `django
flask
requests==2.31.0`;

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        requirements
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(4); // 1 root + 3 dependencies

      const djangoNode = result?.nodes.find(n => n.name === 'django');
      expect(djangoNode).toBeDefined();
      expect(djangoNode?.version).toBeUndefined();

      const requestsNode = result?.nodes.find(n => n.name === 'requests');
      expect(requestsNode?.version).toBe('2.31.0');
    });

    it('should handle empty requirements.txt', () => {
      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        ''
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(1); // Only root node
      expect(result?.edges).toHaveLength(0);
    });

    it('should handle requirements.txt with only comments', () => {
      const requirements = `# Comment 1
# Comment 2
# Comment 3`;

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        requirements
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(1); // Only root node
      expect(result?.edges).toHaveLength(0);
    });

    it('should handle Windows line endings', () => {
      const requirements = 'django==4.2.0\r\nflask>=2.0.0\r\nrequests~=2.31.0';

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        requirements
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.nodes).toHaveLength(4); // 1 root + 3 dependencies
    });

    it('should handle malformed lines gracefully', () => {
      const requirements = `django==4.2.0
invalid line with spaces
flask>=2.0.0`;

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'requirements.txt'),
        requirements
      );

      const result = parsePythonDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      // Should still parse valid lines
      expect(result?.nodes.length).toBeGreaterThan(1);
    });
  });

  describe('detectMonorepoDependencies', () => {
    it('should return null when package.json does not exist', () => {
      const result = detectMonorepoDependencies(TEST_PROJECT_PATH);
      expect(result).toBeNull();
    });

    it('should return null for non-monorepo projects', () => {
      const packageJson = {
        name: 'single-package',
        version: '1.0.0',
        dependencies: {
          react: '^18.2.0'
        }
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(packageJson)
      );

      const result = detectMonorepoDependencies(TEST_PROJECT_PATH);
      expect(result).toBeNull();
    });

    it('should detect monorepo with workspaces field', () => {
      const rootPackageJson = {
        name: 'monorepo-root',
        version: '1.0.0',
        workspaces: ['packages/*', 'apps/*']
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(rootPackageJson)
      );

      // Create packages directory with a workspace package
      const packagesDir = path.join(TEST_PROJECT_PATH, 'packages');
      mkdirSync(packagesDir, { recursive: true });

      const pkg1Dir = path.join(packagesDir, 'package1');
      mkdirSync(pkg1Dir);

      const pkg1Json = {
        name: '@monorepo/package1',
        version: '1.0.0',
        dependencies: {
          lodash: '^4.17.21'
        }
      };

      writeFileSync(
        path.join(pkg1Dir, 'package.json'),
        JSON.stringify(pkg1Json)
      );

      const result = detectMonorepoDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      expect(result?.projectName).toBe('monorepo-root');
      expect(result?.nodes.length).toBeGreaterThan(1);

      // Check for workspace node
      const workspaceNode = result?.nodes.find(n => n.name === '@monorepo/package1');
      expect(workspaceNode).toBeDefined();
      expect(workspaceNode?.id).toBe('workspace-@monorepo/package1');

      // Check for dependency node
      const lodashNode = result?.nodes.find(n => n.name === 'lodash');
      expect(lodashNode).toBeDefined();
    });

    it('should detect monorepo with packages directory', () => {
      const rootPackageJson = {
        name: 'monorepo-root',
        version: '1.0.0'
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(rootPackageJson)
      );

      // Create packages directory
      const packagesDir = path.join(TEST_PROJECT_PATH, 'packages');
      mkdirSync(packagesDir, { recursive: true });

      const pkg1Dir = path.join(packagesDir, 'package1');
      mkdirSync(pkg1Dir);

      const pkg1Json = {
        name: 'package1',
        version: '1.0.0'
      };

      writeFileSync(
        path.join(pkg1Dir, 'package.json'),
        JSON.stringify(pkg1Json)
      );

      const result = detectMonorepoDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
    });

    it('should detect monorepo with apps directory', () => {
      const rootPackageJson = {
        name: 'monorepo-root',
        version: '1.0.0'
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(rootPackageJson)
      );

      // Create apps directory
      const appsDir = path.join(TEST_PROJECT_PATH, 'apps');
      mkdirSync(appsDir, { recursive: true });

      const app1Dir = path.join(appsDir, 'app1');
      mkdirSync(app1Dir);

      const app1Json = {
        name: 'app1',
        version: '1.0.0'
      };

      writeFileSync(
        path.join(app1Dir, 'package.json'),
        JSON.stringify(app1Json)
      );

      const result = detectMonorepoDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
    });

    it('should aggregate dependencies from multiple workspace packages', () => {
      const rootPackageJson = {
        name: 'monorepo-root',
        version: '1.0.0',
        workspaces: ['packages/*']
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(rootPackageJson)
      );

      const packagesDir = path.join(TEST_PROJECT_PATH, 'packages');
      mkdirSync(packagesDir, { recursive: true });

      // Create package1
      const pkg1Dir = path.join(packagesDir, 'package1');
      mkdirSync(pkg1Dir);
      writeFileSync(
        path.join(pkg1Dir, 'package.json'),
        JSON.stringify({
          name: 'package1',
          version: '1.0.0',
          dependencies: {
            react: '^18.2.0',
            lodash: '^4.17.21'
          }
        })
      );

      // Create package2
      const pkg2Dir = path.join(packagesDir, 'package2');
      mkdirSync(pkg2Dir);
      writeFileSync(
        path.join(pkg2Dir, 'package.json'),
        JSON.stringify({
          name: 'package2',
          version: '1.0.0',
          dependencies: {
            react: '^18.2.0', // Shared dependency
            axios: '^1.4.0'
          }
        })
      );

      const result = detectMonorepoDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();

      // Should have: 1 root + 2 workspaces + 3 unique deps (react, lodash, axios)
      expect(result?.nodes.length).toBeGreaterThanOrEqual(6);

      // Check for shared dependency (should only appear once in nodes)
      const reactNodes = result?.nodes.filter(n => n.name === 'react');
      expect(reactNodes).toHaveLength(1);

      // Check for edges from both packages to react
      const reactEdges = result?.edges.filter(e => e.target === 'dep-react');
      expect(reactEdges).toHaveLength(2); // One from each workspace
    });

    it('should skip workspace packages without package.json', () => {
      const rootPackageJson = {
        name: 'monorepo-root',
        version: '1.0.0',
        workspaces: ['packages/*']
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(rootPackageJson)
      );

      const packagesDir = path.join(TEST_PROJECT_PATH, 'packages');
      mkdirSync(packagesDir, { recursive: true });

      // Create valid package
      const pkg1Dir = path.join(packagesDir, 'package1');
      mkdirSync(pkg1Dir);
      writeFileSync(
        path.join(pkg1Dir, 'package.json'),
        JSON.stringify({ name: 'package1', version: '1.0.0' })
      );

      // Create directory without package.json
      const emptyDir = path.join(packagesDir, 'empty');
      mkdirSync(emptyDir);

      const result = detectMonorepoDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      // Should only include the valid package
      const workspaceNodes = result?.nodes.filter(n => n.id.startsWith('workspace-'));
      expect(workspaceNodes).toHaveLength(1);
    });

    it('should skip workspace packages with malformed package.json', () => {
      const rootPackageJson = {
        name: 'monorepo-root',
        version: '1.0.0',
        workspaces: ['packages/*']
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(rootPackageJson)
      );

      const packagesDir = path.join(TEST_PROJECT_PATH, 'packages');
      mkdirSync(packagesDir, { recursive: true });

      // Create valid package
      const pkg1Dir = path.join(packagesDir, 'package1');
      mkdirSync(pkg1Dir);
      writeFileSync(
        path.join(pkg1Dir, 'package.json'),
        JSON.stringify({ name: 'package1', version: '1.0.0' })
      );

      // Create package with malformed JSON
      const pkg2Dir = path.join(packagesDir, 'package2');
      mkdirSync(pkg2Dir);
      writeFileSync(
        path.join(pkg2Dir, 'package.json'),
        '{ invalid json }'
      );

      const result = detectMonorepoDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      // Should only include the valid package
      const workspaceNodes = result?.nodes.filter(n => n.id.startsWith('workspace-'));
      expect(workspaceNodes).toHaveLength(1);
    });

    it('should handle workspace packages without name field', () => {
      const rootPackageJson = {
        name: 'monorepo-root',
        version: '1.0.0',
        workspaces: ['packages/*']
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(rootPackageJson)
      );

      const packagesDir = path.join(TEST_PROJECT_PATH, 'packages');
      mkdirSync(packagesDir, { recursive: true });

      const pkg1Dir = path.join(packagesDir, 'my-package');
      mkdirSync(pkg1Dir);
      writeFileSync(
        path.join(pkg1Dir, 'package.json'),
        JSON.stringify({ version: '1.0.0' }) // No name field
      );

      const result = detectMonorepoDependencies(TEST_PROJECT_PATH);

      expect(result).not.toBeNull();
      // Should use directory name as fallback
      const workspaceNode = result?.nodes.find(n => n.name === 'my-package');
      expect(workspaceNode).toBeDefined();
    });

    it('should return null when only root node exists', () => {
      const rootPackageJson = {
        name: 'monorepo-root',
        version: '1.0.0',
        workspaces: ['packages/*']
      };

      writeFileSync(
        path.join(TEST_PROJECT_PATH, 'package.json'),
        JSON.stringify(rootPackageJson)
      );

      // Create empty packages directory
      mkdirSync(path.join(TEST_PROJECT_PATH, 'packages'), { recursive: true });

      const result = detectMonorepoDependencies(TEST_PROJECT_PATH);

      expect(result).toBeNull(); // Should return null when only 1 node (root)
    });
  });
});
