import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'fs-dropzone',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './dropzone.component.html',
  styleUrl: './dropzone.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DropzoneComponent {
  readonly accept = input<string>('*/*');
  readonly multiple = input<boolean>(true);
  readonly label = input<string>('Drop files here or click to browse');
  readonly hint = input<string>('');
  readonly files = output<File[]>();

  readonly isDragging = signal<boolean>(false);
  readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  openPicker(): void {
    this.fileInput().nativeElement.click();
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    const list = event.dataTransfer?.files;
    if (list && list.length > 0) {
      this.files.emit(Array.from(list));
    }
  }

  onFileChange(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    if (inputEl.files && inputEl.files.length > 0) {
      this.files.emit(Array.from(inputEl.files));
      inputEl.value = '';
    }
  }
}
