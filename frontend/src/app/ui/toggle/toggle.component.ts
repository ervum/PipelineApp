import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

@Component({
  selector: 'fs-toggle',
  standalone: true,
  templateUrl: './toggle.component.html',
  styleUrl: './toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToggleComponent {
  readonly checked = model<boolean>(false);
  readonly label = input<string>('');
  readonly disabled = input<boolean>(false);

  toggle(): void {
    if (this.disabled()) return;
    this.checked.update((v) => !v);
  }
}
