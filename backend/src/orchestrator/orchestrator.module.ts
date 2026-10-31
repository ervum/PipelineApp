import { Global, Module } from '@nestjs/common';
import { MiddlemanStreamCache } from '../middleman/middleman-compiler.service';
import { JOB_EVENTS_PUBLISHER } from './job-events.port';
import { JobEventsPublisher } from './job-events.publisher';
import { OrchestratorGateway } from './orchestrator.gateway';

@Global()
@Module({
  providers: [
    MiddlemanStreamCache,
    JobEventsPublisher,
    {
      provide: JOB_EVENTS_PUBLISHER,
      useExisting: JobEventsPublisher,
    },
    OrchestratorGateway,
  ],
  exports: [MiddlemanStreamCache, JobEventsPublisher, JOB_EVENTS_PUBLISHER],
})
export class OrchestratorModule {}
