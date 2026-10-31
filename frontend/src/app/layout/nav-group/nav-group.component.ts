import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../ui/icon/icon.component';
import { TooltipDirective } from '../../ui/tooltip/tooltip.directive';

export interface NavItemConfig {
  label: string;
  route: string;
  icon: string;
  count?: number;
  spinnerBadge?: boolean;
  alertDot?: boolean;
}

@Component({
  selector: 'fs-nav-group',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent, TooltipDirective],
  templateUrl: './nav-group.component.html',
  styleUrl: './nav-group.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavGroupComponent {
  readonly title = input.required<string>();
  readonly items = input.required<ReadonlyArray<NavItemConfig>>();
  readonly collapsed = input<boolean>(false);
}
