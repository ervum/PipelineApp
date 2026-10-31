import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { StudioStateService } from '../state/studio-state.service';

export const activeProjectGuard: CanActivateFn = async () => {
  const studio = inject(StudioStateService);
  await studio.ready();
  if (studio.loadSucceeded() && studio.visibleProjects().length === 0) {
    studio.openCreateProjectModal();
  }
  return true;
};
