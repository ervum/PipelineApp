import { CanMatchFn, Routes, UrlSegment } from '@angular/router';
import { activeProjectGuard } from './core/guards/active-project.guard';
import { isValidModalityRoute } from './core/utils/format';
import { StudioShellComponent } from './layout/studio-shell/studio-shell.component';

const validModalityCanMatch: CanMatchFn = (_route, segments: UrlSegment[]) => {
  const modalitySegment = segments[1]?.path;
  return isValidModalityRoute(modalitySegment);
};

export const routes: Routes = [
  {
    path: '',
    component: StudioShellComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'generate/icons',
      },
      {
        path: 'generate/:modalityRoute',
        canMatch: [validModalityCanMatch],
        canActivate: [activeProjectGuard],
        loadComponent: () =>
          import(
            './features/generators/workspace/generator-workspace.component'
          ).then((m) => m.GeneratorWorkspaceComponent),
      },
      {
        path: 'vault',
        canActivate: [activeProjectGuard],
        loadComponent: () =>
          import('./features/vault/vault-page/vault-page.component').then(
            (m) => m.VaultPageComponent,
          ),
      },
      {
        path: 'vault/folder/:folderId',
        canActivate: [activeProjectGuard],
        loadComponent: () =>
          import('./features/vault/vault-page/vault-page.component').then(
            (m) => m.VaultPageComponent,
          ),
      },
      {
        path: 'vault/file/:fileId',
        canActivate: [activeProjectGuard],
        loadComponent: () =>
          import('./features/vault/vault-page/vault-page.component').then(
            (m) => m.VaultPageComponent,
          ),
      },
      {
        path: 'providers',
        loadComponent: () =>
          import(
            './features/providers/providers-page/providers-page.component'
          ).then((m) => m.ProvidersPageComponent),
      },
      {
        path: 'providers/:providerId',
        loadComponent: () =>
          import(
            './features/providers/providers-page/providers-page.component'
          ).then((m) => m.ProvidersPageComponent),
      },
      {
        path: 'mcp',
        loadComponent: () =>
          import('./features/mcp/mcp-page/mcp-page.component').then(
            (m) => m.McpPageComponent,
          ),
      },
      {
        path: 'mcp/:toolName',
        loadComponent: () =>
          import('./features/mcp/mcp-page/mcp-page.component').then(
            (m) => m.McpPageComponent,
          ),
      },
      {
        path: '**',
        redirectTo: 'generate/icons',
      },
    ],
  },
];
