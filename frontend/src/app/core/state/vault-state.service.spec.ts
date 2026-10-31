import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { VaultFileModel, VaultFolderModel } from '@forge/shared';
import { VaultApi } from '../api/vault.api';
import { VoiceProfilesApi } from '../api/voice-profiles.api';
import { SocketService } from '../realtime/socket.service';
import { StudioStateService } from './studio-state.service';
import { VaultStateService } from './vault-state.service';

const SAMPLE_TREE: VaultFolderModel = {
  id: 'folder-root',
  projectId: 'proj-1',
  parentId: null,
  name: 'Root',
  path: '/',
  sortOrder: 0,
  fileCount: 1,
  children: [
    {
      id: 'folder-art',
      projectId: 'proj-1',
      parentId: 'folder-root',
      name: 'Art Direction',
      path: '/Art Direction',
      sortOrder: 1,
      fileCount: 2,
      children: [],
    },
  ],
};

const SAMPLE_FILES: VaultFileModel[] = [
  {
    id: 'file-gdd',
    projectId: 'proj-1',
    folderId: 'folder-root',
    folderPath: '/',
    name: 'Core GDD.md',
    extension: 'md',
    kind: 'MARKDOWN',
    mimeType: 'text/markdown',
    sizeBytes: 1200,
    scopes: ['ALWAYS_INCLUDE'],
    priority: 95,
    description: 'Core game design document',
    tokenEstimate: 300,
    contentUrl: '/api/v1/media/vault/file-gdd',
    thumbnailUrl: null,
    styleDescriptorText: null,
    styleDescriptorJson: null,
    visionStatus: 'NONE',
    visionModel: null,
    visionError: null,
    width: null,
    height: null,
    durationMs: null,
    sourceAssetId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'file-palette',
    projectId: 'proj-1',
    folderId: 'folder-art',
    folderPath: '/Art Direction',
    name: 'Color Palette.md',
    extension: 'md',
    kind: 'MARKDOWN',
    mimeType: 'text/markdown',
    sizeBytes: 800,
    scopes: ['ICONS_2D', 'IMAGES'],
    priority: 85,
    description: 'Obsidian and cyan hex swatches',
    tokenEstimate: 210,
    contentUrl: '/api/v1/media/vault/file-palette',
    thumbnailUrl: null,
    styleDescriptorText: null,
    styleDescriptorJson: null,
    visionStatus: 'NONE',
    visionModel: null,
    visionError: null,
    width: null,
    height: null,
    durationMs: null,
    sourceAssetId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'file-ref-img',
    projectId: 'proj-1',
    folderId: 'folder-art',
    folderPath: '/Art Direction',
    name: 'Katana Reference.png',
    extension: 'png',
    kind: 'IMAGE',
    mimeType: 'image/png',
    sizeBytes: 42000,
    scopes: ['ICONS_2D'],
    priority: 70,
    description: 'Reference blade render',
    tokenEstimate: 120,
    contentUrl: '/api/v1/media/vault/file-ref-img',
    thumbnailUrl: '/api/v1/media/vault/file-ref-img/thumbnail',
    styleDescriptorText: 'high-contrast cel-shaded obsidian blade with neon cyan rim lighting',
    styleDescriptorJson: null,
    visionStatus: 'DONE',
    visionModel: 'demo',
    visionError: null,
    width: 512,
    height: 512,
    durationMs: null,
    sourceAssetId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('VaultStateService', () => {
  beforeEach(() => {
    const mockStudio = {
      activeProjectId: signal<string | null>(null),
      refreshStats: () => Promise.resolve(),
    };

    const mockVaultApi: Partial<VaultApi> = {
      getTree: () => Promise.resolve(SAMPLE_TREE),
      listFiles: () => Promise.resolve(SAMPLE_FILES),
    };

    const mockVoiceApi: Partial<VoiceProfilesApi> = {
      list: () => Promise.resolve([]),
    };

    const mockSocket: Partial<SocketService> = {
      on: () => () => undefined,
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: StudioStateService, useValue: mockStudio },
        { provide: VaultApi, useValue: mockVaultApi },
        { provide: VoiceProfilesApi, useValue: mockVoiceApi },
        { provide: SocketService, useValue: mockSocket },
      ],
    });
  });

  it('filters visibleFiles by folderId, searchQuery (including styleDescriptorText), and scopeFilter', () => {
    const service = TestBed.inject(VaultStateService);
    service.tree.set(SAMPLE_TREE);
    service.files.set(SAMPLE_FILES);
    service.selectedFolderId.set('folder-root');

    // 1. Folder filtering (root folder only has Core GDD.md)
    expect(service.visibleFiles().map((f) => f.id)).toEqual(['file-gdd']);

    // 2. Selecting Art Direction folder returns two files sorted by priority desc
    service.selectedFolderId.set('folder-art');
    expect(service.visibleFiles().map((f) => f.id)).toEqual([
      'file-palette',
      'file-ref-img',
    ]);

    // 3. Search query spans the entire project (even when selectedFolderId is folder-root)
    service.selectedFolderId.set('folder-root');
    service.searchQuery.set('cel-shaded');
    expect(service.visibleFiles().map((f) => f.id)).toEqual(['file-ref-img']);

    // 4. Scope filtering narrows to matching scope
    service.searchQuery.set('');
    service.selectedFolderId.set('folder-art');
    service.scopeFilter.set('IMAGES');
    expect(service.visibleFiles().map((f) => f.id)).toEqual(['file-palette']);

    // 5. Context count for ICONS_2D includes ALWAYS_INCLUDE + ICONS_2D
    expect(service.contextCountFor('ICONS_2D')()).toBe(3);
  });
});
