import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ProjectModel } from '@forge/shared';
import { ProjectsApi } from '../api/projects.api';
import { SocketService } from '../realtime/socket.service';
import { StudioStateService } from './studio-state.service';

const SAMPLE_PROJECTS: ProjectModel[] = [
  {
    id: 'proj-astra',
    slug: 'astra-dream',
    name: 'Astra Dream',
    tagline: 'Neon cyber-fantasy RPG',
    description: 'High-contrast obsidian and cyan aesthetic',
    genre: 'Action RPG',
    accentHex: '#06B6D4',
    coverUrl: null,
    globalSummary: 'Cyber-fantasy action RPG.',
    archived: false,
    stats: { vaultFiles: 8, assets: 4, activeJobs: 0, totalCostUsd: 0.12 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'proj-ember',
    slug: 'ember-vale',
    name: 'Ember Vale',
    tagline: 'Cozy alchemical tactics',
    description: 'Warm hand-painted fantasy',
    genre: 'Tactics',
    accentHex: '#F59E0B',
    coverUrl: null,
    globalSummary: 'Alchemical tactics game.',
    archived: false,
    stats: { vaultFiles: 5, assets: 2, activeJobs: 0, totalCostUsd: 0.05 },
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

describe('StudioStateService', () => {
  let subscribedRooms: string[];
  let unsubscribedRooms: string[];

  beforeEach(() => {
    localStorage.clear();
    subscribedRooms = [];
    unsubscribedRooms = [];

    const mockProjectsApi: Pick<ProjectsApi, 'list' | 'create' | 'update'> = {
      list: () => Promise.resolve(SAMPLE_PROJECTS),
      create: (dto) =>
        Promise.resolve({
          ...SAMPLE_PROJECTS[0]!,
          id: 'proj-created',
          name: dto.name,
          accentHex: dto.accentHex ?? '#7C3AED',
        }),
      update: (id, dto) =>
        Promise.resolve({
          ...SAMPLE_PROJECTS[0]!,
          id,
          name: dto.name ?? SAMPLE_PROJECTS[0]!.name,
          accentHex: dto.accentHex ?? SAMPLE_PROJECTS[0]!.accentHex,
        }),
    };

    const mockSocket: Pick<
      SocketService,
      'subscribeProject' | 'unsubscribeProject' | 'onReconnect'
    > = {
      subscribeProject: (id: string) => subscribedRooms.push(id),
      unsubscribeProject: (id: string) => unsubscribedRooms.push(id),
      onReconnect: () => undefined,
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ProjectsApi, useValue: mockProjectsApi },
        { provide: SocketService, useValue: mockSocket },
      ],
    });
  });

  it('loads projects, selects first visible project, persists to localStorage, and sets --fs-project-accent', async () => {
    const service = TestBed.inject(StudioStateService);
    await service.ready();
    TestBed.tick();

    expect(service.projects().length).toBe(2);
    expect(service.activeProjectId()).toBe('proj-astra');
    expect(service.activeProject()?.name).toBe('Astra Dream');
    expect(localStorage.getItem('forge.activeProjectId')).toBe('proj-astra');
    expect(
      document.documentElement.style.getPropertyValue('--fs-project-accent'),
    ).toBe('#06B6D4');
    expect(subscribedRooms).toContain('proj-astra');
  });

  it('switches active project, updates localStorage, socket rooms, and CSS custom property', async () => {
    const service = TestBed.inject(StudioStateService);
    await service.ready();
    TestBed.tick();

    service.selectProject('proj-ember');
    TestBed.tick();

    expect(service.activeProjectId()).toBe('proj-ember');
    expect(localStorage.getItem('forge.activeProjectId')).toBe('proj-ember');
    expect(
      document.documentElement.style.getPropertyValue('--fs-project-accent'),
    ).toBe('#F59E0B');
    expect(unsubscribedRooms).toContain('proj-astra');
    expect(subscribedRooms).toContain('proj-ember');
  });
});
