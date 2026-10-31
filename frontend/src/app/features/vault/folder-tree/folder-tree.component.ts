import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  output,
  signal,
  untracked,
} from '@angular/core';
import { VaultFolderModel } from '@forge/shared';
import { StudioStateService } from '../../../core/state/studio-state.service';
import { VaultStateService } from '../../../core/state/vault-state.service';
import {
  ContextMenuComponent,
  MenuItem,
} from '../../../ui/context-menu/context-menu.component';
import { IconComponent } from '../../../ui/icon/icon.component';

@Component({
  selector: 'fs-folder-tree',
  standalone: true,
  imports: [NgTemplateOutlet, IconComponent, ContextMenuComponent],
  templateUrl: './folder-tree.component.html',
  styleUrl: './folder-tree.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderTreeComponent {
  readonly vault = inject(VaultStateService);
  private readonly studio = inject(StudioStateService);

  readonly folderSelect = output<string>();
  readonly requestNewFile = output<string>();
  readonly requestNewFolder = output<string>();
  readonly requestRenameFolder = output<VaultFolderModel>();
  readonly requestDeleteFolder = output<VaultFolderModel>();
  readonly dropFilesOnFolder = output<{ folderId: string; files: FileList }>();

  readonly expandedIds = signal<Set<string>>(new Set());
  readonly dragOverFolderId = signal<string | null>(null);

  readonly menuOpen = signal<boolean>(false);
  readonly menuAnchor = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  readonly contextFolder = signal<VaultFolderModel | null>(null);

  readonly menuItems: ReadonlyArray<MenuItem> = [
    { id: 'new-file', label: 'New Markdown File…', icon: 'file-md' },
    { id: 'new-folder', label: 'New Subfolder…', icon: 'folder' },
    { id: 'rename', label: 'Rename Folder…', icon: 'edit' },
    { id: 'delete', label: 'Delete Folder', icon: 'trash', danger: true, dividerBefore: true },
  ];

  constructor() {
    effect(() => {
      const pid = this.studio.activeProjectId();
      const root = this.vault.tree();
      untracked(() => {
        if (!pid || !root) return;
        const saved = localStorage.getItem(`forge.vault.expanded.${pid}`);
        if (saved) {
          try {
            const arr = JSON.parse(saved) as string[];
            this.expandedIds.set(new Set([root.id, ...arr]));
            return;
          } catch {
            // ignore
          }
        }
        const initial = new Set<string>([root.id]);
        for (const c of root.children) {
          initial.add(c.id);
        }
        this.expandedIds.set(initial);
      });
    });
  }

  isExpanded(folderId: string): boolean {
    return this.expandedIds().has(folderId);
  }

  toggleExpand(folderId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.expandedIds.update((set) => {
      const next = new Set(set);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      const pid = this.studio.activeProjectId();
      if (pid) {
        localStorage.setItem(`forge.vault.expanded.${pid}`, JSON.stringify(Array.from(next)));
      }
      return next;
    });
  }

  selectFolder(folder: VaultFolderModel): void {
    this.folderSelect.emit(folder.id);
  }

  onContextMenu(folder: VaultFolderModel, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextFolder.set(folder);
    this.menuAnchor.set({ x: event.clientX, y: event.clientY });
    this.menuOpen.set(true);
  }

  onMenuSelect(action: string): void {
    const folder = this.contextFolder();
    if (!folder) return;
    if (action === 'new-file') {
      this.requestNewFile.emit(folder.id);
    } else if (action === 'new-folder') {
      this.requestNewFolder.emit(folder.id);
    } else if (action === 'rename' && folder.parentId !== null) {
      this.requestRenameFolder.emit(folder);
    } else if (action === 'delete' && folder.parentId !== null) {
      this.requestDeleteFolder.emit(folder);
    }
  }

  onFolderDragStart(folder: VaultFolderModel, event: DragEvent): void {
    if (!folder.parentId) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer?.setData('application/x-forge-folder-id', folder.id);
  }

  onFolderDragOver(folder: VaultFolderModel, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverFolderId.set(folder.id);
  }

  onFolderDragLeave(folder: VaultFolderModel, event: DragEvent): void {
    event.stopPropagation();
    if (this.dragOverFolderId() === folder.id) {
      this.dragOverFolderId.set(null);
    }
  }

  onFolderDrop(targetFolder: VaultFolderModel, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverFolderId.set(null);

    const dt = event.dataTransfer;
    if (!dt) return;

    const fileId = dt.getData('application/x-forge-file-id');
    if (fileId) {
      void this.vault.moveFile(fileId, targetFolder.id);
      return;
    }

    const draggedFolderId = dt.getData('application/x-forge-folder-id');
    if (draggedFolderId && draggedFolderId !== targetFolder.id) {
      void this.vault.moveFolder(draggedFolderId, targetFolder.id);
      return;
    }

    if (dt.files && dt.files.length > 0) {
      this.dropFilesOnFolder.emit({ folderId: targetFolder.id, files: dt.files });
    }
  }
}
