import {
  ChangeDetectionStrategy,
  Component,
  contentChildren,
  input,
  model,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'fs-tab',
  standalone: true,
  template: `
    @if (isActive()) {
      <div class="tab-panel" role="tabpanel">
        <ng-content />
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .tab-panel {
        height: 100%;
        min-height: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabComponent {
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly icon = input<string | null>(null);
  readonly badge = input<string | number | null>(null);
  readonly disabled = input<boolean>(false);
  readonly isActive = model<boolean>(false);
}

export interface TabOption {
  id: string;
  label: string;
  icon?: string;
  badge?: string | number | null;
  disabled?: boolean;
}

@Component({
  selector: 'fs-tabs',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabsComponent {
  readonly active = model.required<string>();
  readonly tabs = input<ReadonlyArray<TabOption>>([]);
  readonly projectedTabs = contentChildren(TabComponent);

  selectTab(id: string, disabled = false): void {
    if (disabled) return;
    this.active.set(id);
    for (const t of this.projectedTabs()) {
      t.isActive.set(t.id() === id);
    }
  }
}
