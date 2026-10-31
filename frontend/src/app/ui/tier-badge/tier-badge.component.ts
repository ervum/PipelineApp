import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ExecutionTier, EXECUTION_TIER_LABEL } from '@forge/shared';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'fs-tier-badge',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './tier-badge.component.html',
  styleUrl: './tier-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TierBadgeComponent {
  readonly tier = input.required<ExecutionTier>();

  readonly iconName = computed(() => {
    switch (this.tier()) {
      case 'CLOUD_API':
        return 'cloud';
      case 'RUNPOD':
        return 'gpu';
      case 'LOCAL':
        return 'server';
    }
  });

  readonly label = computed(() => EXECUTION_TIER_LABEL[this.tier()] ?? this.tier());
}
