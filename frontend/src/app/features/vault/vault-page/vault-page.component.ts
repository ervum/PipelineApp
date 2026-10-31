import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  CONTEXT_SCOPES,
  CONTEXT_SCOPE_LABEL,
  VaultFileModel,
  VaultFolderModel,
} from '@forge/shared';
import { VaultStateService } from '../../../core/state/vault-state.service';
import { formatBytes } from '../../../core/utils/format';
import { isEditableTarget, isModKey } from '../../../core/utils/keyboard';
import { ButtonComponent } from '../../../ui/button/button.component';
import { ConfirmDialogService } from '../../../ui/confirm-dialog/confirm-dialog.service';
import { IconComponent } from '../../../ui/icon/icon.component';
import { ModalComponent } from '../../../ui/modal/modal.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../ui/segmented-control/segmented-control.component';
import { FileBrowserComponent } from '../file-browser/file-browser.component';
import { FileEditorComponent } from '../file-editor/file-editor.component';
import { FolderTreeComponent } from '../folder-tree/folder-tree.component';
import { MediaPreviewComponent } from '../media-preview/media-preview.component';
import { ScopeTagEditorComponent } from '../scope-tag-editor/scope-tag-editor.component';
import { UploadQueueComponent } from '../upload-queue/upload-queue.component';
import { VisionPanelComponent } from '../vision-panel/vision-panel.component';
import { VoiceProfilesPanelComponent } from '../voice-profiles-panel/voice-profiles-panel.component';

@Component({
  selector: 'fs-vault-page',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    ModalComponent,
    SegmentedControlComponent,
    FolderTreeComponent,
    FileBrowserComponent,
    FileEditorComponent,
    MediaPreviewComponent,
    ScopeTagEditorComponent,
    VisionPanelComponent,
    UploadQueueComponent,
    VoiceProfilesPanelComponent,
  ],
  templateUrl: './vault-page.component.html',
  styleUrl: './vault-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.no-inspector]': 'activeSection() === "voices" || !inspectedFile()',
    '(window:beforeunload)': 'onBeforeUnload($event)',
    '(document:keydown)': 'onGlobalKeyDown($event)',
  },
})
export class VaultPageComponent {
  readonly vault = inject(VaultStateService);
  private readonly confirm = inject(ConfirmDialogService);

  readonly folderId = input<string | undefined>(undefined);
  readonly fileId = input<string | undefined>(undefined);

  readonly uploadInput = viewChild.required<ElementRef<HTMLInputElement>>('uploadInput');

  readonly activeSection = signal<'files' | 'voices'>('files');
  readonly isDragOver = signal<boolean>(false);

  readonly newFileModalOpen = signal<boolean>(false);
  readonly newFileFolderId = signal<string | null>(null);
  readonly newFileName = signal<string>('New-Guide.md');
  readonly newFileError = signal<string | null>(null);

  readonly folderModalOpen = signal<boolean>(false);
  readonly folderModalMode = signal<'create' | 'rename'>('create');
  readonly folderModalTargetId = signal<string | null>(null);
  readonly folderModalName = signal<string>('');

  readonly sectionOptions: ReadonlyArray<SegmentedOption<'files' | 'voices'>> = [
    { value: 'files', label: 'Vault Explorer', icon: 'folder' },
    { value: 'voices', label: 'Voice Cast', icon: 'mic' },
  ];

  readonly viewOptions: ReadonlyArray<SegmentedOption<'list' | 'grid'>> = [
    { value: 'list', label: 'List', icon: 'list' },
    { value: 'grid', label: 'Grid', icon: 'grid' },
  ];

  readonly allScopes = CONTEXT_SCOPES;
  readonly scopeLabels = CONTEXT_SCOPE_LABEL;
  readonly formatBytes = formatBytes;

  readonly inspectedFile = computed<VaultFileModel | null>(() => {
    const open = this.vault.openFile();
    if (open) return open;
    const selId = this.vault.selectedFileId();
    if (!selId) return null;
    return this.vault.files().find((f) => f.id === selId) ?? null;
  });

  readonly isTextKind = computed(() => {
    const f = this.vault.openFile();
    if (!f) return false;
    return f.kind === 'MARKDOWN' || f.kind === 'TEXT' || f.kind === 'JSON';
  });

  constructor() {
    effect(() => {
      const fid = this.fileId();
      const foldId = this.folderId();
      untracked(() => {
        if (fid) {
          void this.vault.openFileById(fid);
        } else if (foldId) {
          this.vault.selectFolder(foldId);
        }
      });
    });
  }

  async guardUnsavedChanges(): Promise<boolean> {
    if (!this.vault.isDirty()) return true;
    const res = await this.confirm.confirm({
      title: 'Unsaved Changes',
      message: `Save changes to "${this.vault.openFile()?.name}" before leaving?`,
      confirmLabel: 'Save & Continue',
      extraAction: 'Discard Changes',
      cancelLabel: 'Stay Here',
    });
    if (res === 'confirm') {
      await this.vault.saveDraft();
      return true;
    }
    if (res === 'extra') {
      this.vault.draftContent.set(this.vault.openFile()?.contentText ?? '');
      return true;
    }
    return false;
  }

  async handleSelectFolder(folderId: string): Promise<void> {
    if (!(await this.guardUnsavedChanges())) return;
    this.activeSection.set('files');
    this.vault.selectFolder(folderId);
  }

  async handleOpenFile(file: VaultFileModel): Promise<void> {
    if (this.vault.openFile()?.id === file.id) return;
    if (!(await this.guardUnsavedChanges())) return;
    this.activeSection.set('files');
    await this.vault.openFileById(file.id);
  }

  async handleOpenFileById(fileId: string): Promise<void> {
    if (!(await this.guardUnsavedChanges())) return;
    this.activeSection.set('files');
    await this.vault.openFileById(fileId);
  }

  async handleCloseEditor(): Promise<void> {
    if (!(await this.guardUnsavedChanges())) return;
    this.vault.openFile.set(null);
  }

  openNewFileModal(folderId?: string): void {
    const targetFolder =
      folderId ?? this.vault.selectedFolderId() ?? this.vault.tree()?.id ?? null;
    if (!targetFolder) return;
    this.newFileFolderId.set(targetFolder);
    this.newFileName.set('Art-Notes.md');
    this.newFileError.set(null);
    this.newFileModalOpen.set(true);
  }

  async submitNewFile(): Promise<void> {
    const folderId = this.newFileFolderId();
    const name = this.newFileName().trim();
    if (!folderId) return;
    if (!/\.(md|txt|json)$/i.test(name)) {
      this.newFileError.set('File name must end with .md, .txt, or .json');
      return;
    }
    const initialContent = name.endsWith('.json')
      ? '{\n  "title": "New Document"\n}'
      : `# ${name.replace(/\.(md|txt)$/i, '')}\n\n`;
    await this.vault.createTextFile({
      folderId,
      name,
      contentText: initialContent,
      scopes: ['ALWAYS_INCLUDE'],
      priority: 70,
      description: '',
    });
    this.newFileModalOpen.set(false);
  }

  openCreateFolderModal(parentId?: string): void {
    const target = parentId ?? this.vault.selectedFolderId() ?? this.vault.tree()?.id ?? null;
    if (!target) return;
    this.folderModalMode.set('create');
    this.folderModalTargetId.set(target);
    this.folderModalName.set('');
    this.folderModalOpen.set(true);
  }

  openRenameFolderModal(folder: VaultFolderModel): void {
    this.folderModalMode.set('rename');
    this.folderModalTargetId.set(folder.id);
    this.folderModalName.set(folder.name);
    this.folderModalOpen.set(true);
  }

  async submitFolderModal(): Promise<void> {
    const id = this.folderModalTargetId();
    const name = this.folderModalName().trim();
    if (!id || !name) return;
    if (this.folderModalMode() === 'create') {
      await this.vault.createFolder(id, name);
    } else {
      await this.vault.renameFolder(id, name);
    }
    this.folderModalOpen.set(false);
  }

  async handleDeleteFolder(folder: VaultFolderModel): Promise<void> {
    const res = await this.confirm.confirm({
      title: 'Delete Folder',
      message: `Delete folder "${folder.name}" and all files inside it?`,
      confirmLabel: 'Delete Folder',
      danger: true,
    });
    if (res === 'confirm') {
      await this.vault.deleteFolder(folder.id);
    }
  }

  async deleteSelectedFile(): Promise<void> {
    const f = this.inspectedFile();
    if (!f) return;
    const res = await this.confirm.confirm({
      title: 'Delete Vault File',
      message: `Permanently delete "${f.name}" from the project vault?`,
      confirmLabel: 'Delete File',
      danger: true,
    });
    if (res === 'confirm') {
      await this.vault.deleteFile(f.id);
    }
  }

  triggerUploadPicker(): void {
    this.uploadInput().nativeElement.click();
  }

  onUploadFilesSelected(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const folderId = this.vault.selectedFolderId() ?? this.vault.tree()?.id;
    if (inputEl.files && inputEl.files.length > 0 && folderId) {
      this.vault.uploadFiles(inputEl.files, folderId, ['IMAGES'], true);
      inputEl.value = '';
    }
  }

  onDropFilesOnFolder(ev: { folderId: string; files: FileList }): void {
    this.vault.uploadFiles(ev.files, ev.folderId, ['IMAGES'], true);
  }

  onContentDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      this.isDragOver.set(true);
    }
  }

  onContentDragLeave(): void {
    this.isDragOver.set(false);
  }

  onContentDrop(event: DragEvent): void {
    this.isDragOver.set(false);
    const files = event.dataTransfer?.files;
    const folderId = this.vault.selectedFolderId() ?? this.vault.tree()?.id;
    if (files && files.length > 0 && folderId) {
      event.preventDefault();
      this.vault.uploadFiles(files, folderId, ['IMAGES'], true);
    }
  }

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.vault.isDirty()) {
      event.preventDefault();
    }
  }

  onGlobalKeyDown(event: KeyboardEvent): void {
    if (isModKey(event) && event.key.toLowerCase() === 's' && this.vault.isDirty()) {
      event.preventDefault();
      void this.vault.saveDraft();
      return;
    }
    if (isEditableTarget(event.target)) return;

    if (event.key === 'Delete' && this.inspectedFile()) {
      event.preventDefault();
      void this.deleteSelectedFile();
    } else if (isModKey(event) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.openNewFileModal();
    }
  }
}
