import { Injectable } from '@nestjs/common';
import { ProviderRuntimeConfig } from '../providers/providers.service';

@Injectable()
export class CostEstimatorService {
  estimate(opts: {
    provider: ProviderRuntimeConfig;
    batchCount: number;
    executionMs?: number | null;
    reportedCostUsd?: number | null;
  }): number {
    if (
      typeof opts.reportedCostUsd === 'number' &&
      Number.isFinite(opts.reportedCostUsd) &&
      opts.reportedCostUsd >= 0
    ) {
      return Number(opts.reportedCostUsd.toFixed(6));
    }

    const batch = Math.max(1, opts.batchCount);
    const perReq = opts.provider.settings.costPerRequestUsd ?? 0;
    const perSec = opts.provider.settings.costPerSecondUsd ?? 0;

    let total = perReq * batch;
    if (typeof opts.executionMs === 'number' && opts.executionMs > 0) {
      total += (opts.executionMs / 1000) * perSec;
    }

    return Number(total.toFixed(6));
  }
}
