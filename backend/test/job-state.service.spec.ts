import { ErrorCode, JobStatus } from '@forge/shared';
import { DomainError } from '../src/common/errors/domain.error';
import { JobStateService } from '../src/generators/job-state.service';
import { JobEventsPublisherPort } from '../src/orchestrator/job-events.port';
import { PrismaService } from '../src/prisma/prisma.service';

describe('JobStateService', () => {
  let currentStatus: JobStatus;
  let updatedDataLog: Array<Record<string, unknown>>;
  let createdEventsLog: Array<Record<string, unknown>>;
  let publisherMock: jest.Mocked<JobEventsPublisherPort>;
  let prismaMock: PrismaService;
  let service: JobStateService;

  beforeEach(() => {
    currentStatus = JobStatus.QUEUED;
    updatedDataLog = [];
    createdEventsLog = [];

    publisherMock = {
      jobCreated: jest.fn(),
      jobStatus: jest.fn(),
      middlemanChunk: jest.fn(),
      middlemanComplete: jest.fn(),
      middlemanError: jest.fn(),
      workerStatus: jest.fn(),
      progress: jest.fn(),
      completed: jest.fn(),
      failed: jest.fn(),
      vaultFileUpdated: jest.fn(),
      providerHealth: jest.fn(),
    };

    const txMock = {
      $queryRaw: jest.fn().mockImplementation(async () => [
        {
          id: 'job_state_test_1',
          projectId: 'prj_test_1',
          status: currentStatus,
          startedAt: null,
        },
      ]),
      generationJob: {
        update: jest
          .fn()
          .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            updatedDataLog.push(data);
            currentStatus = data['status'] as JobStatus;
            return {
              id: 'job_state_test_1',
              projectId: 'prj_test_1',
              status: currentStatus,
              startedAt: (data['startedAt'] as Date | undefined) ?? null,
              completedAt: (data['completedAt'] as Date | undefined) ?? null,
              errorCode: (data['errorCode'] as string | undefined) ?? null,
              errorMessage: (data['errorMessage'] as string | undefined) ?? null,
            };
          }),
        findUnique: jest.fn(),
      },
      generationJobEvent: {
        create: jest
          .fn()
          .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            createdEventsLog.push(data);
            return { id: `evt_${createdEventsLog.length}`, ...data };
          }),
      },
    };

    prismaMock = {
      $transaction: jest
        .fn()
        .mockImplementation(async (cb: (tx: typeof txMock) => Promise<unknown>) =>
          cb(txMock),
        ),
      generationJob: txMock.generationJob,
      generationJobEvent: txMock.generationJobEvent,
    } as unknown as PrismaService;

    service = new JobStateService(prismaMock, publisherMock);
  });

  it('transitions through valid states, records GenerationJobEvent, and emits job:status', async () => {
    // QUEUED -> COMPILING
    const j1 = await service.transition(
      'job_state_test_1',
      JobStatus.COMPILING,
      {},
      'Starting compile',
    );
    expect(j1.status).toBe(JobStatus.COMPILING);
    expect(createdEventsLog).toHaveLength(1);
    expect(createdEventsLog[0]).toMatchObject({
      jobId: 'job_state_test_1',
      type: 'status',
      fromStatus: JobStatus.QUEUED,
      toStatus: JobStatus.COMPILING,
      message: 'Starting compile',
    });
    expect(publisherMock.jobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job_state_test_1',
        projectId: 'prj_test_1',
        from: JobStatus.QUEUED,
        to: JobStatus.COMPILING,
      }),
    );

    // COMPILING -> READY
    await service.transition('job_state_test_1', JobStatus.READY, {});
    // READY -> DISPATCHING
    await service.transition('job_state_test_1', JobStatus.DISPATCHING, {});
    // DISPATCHING -> RUNNING (sets startedAt automatically)
    const jRun = await service.transition(
      'job_state_test_1',
      JobStatus.RUNNING,
      {},
    );
    expect(jRun.startedAt).toBeInstanceOf(Date);

    // RUNNING -> INGESTING -> COMPLETED (sets completedAt automatically)
    await service.transition('job_state_test_1', JobStatus.INGESTING, {});
    const jDone = await service.transition(
      'job_state_test_1',
      JobStatus.COMPLETED,
      {},
    );
    expect(jDone.completedAt).toBeInstanceOf(Date);
    expect(createdEventsLog).toHaveLength(6);
  });

  it('rejects invalid state transitions with ErrorCode.INVALID_TRANSITION (409)', async () => {
    currentStatus = JobStatus.COMPLETED;

    await expect(
      service.transition('job_state_test_1', JobStatus.RUNNING),
    ).rejects.toThrow(DomainError);

    await expect(
      service.transition('job_state_test_1', JobStatus.RUNNING),
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_TRANSITION,
      status: 409,
    });

    expect(createdEventsLog).toHaveLength(0);
    expect(publisherMock.jobStatus).not.toHaveBeenCalled();
  });

  it('emits both job:status and job:failed when transitioning to FAILED', async () => {
    currentStatus = JobStatus.RUNNING;

    await service.transition(
      'job_state_test_1',
      JobStatus.FAILED,
      {
        errorCode: ErrorCode.PROVIDER_TIMEOUT,
        errorMessage: 'Provider timed out after 120000ms',
      },
      'Provider timed out after 120000ms',
      { retryable: true },
    );

    expect(publisherMock.jobStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        from: JobStatus.RUNNING,
        to: JobStatus.FAILED,
      }),
    );
    expect(publisherMock.failed).toHaveBeenCalledWith({
      jobId: 'job_state_test_1',
      projectId: 'prj_test_1',
      code: ErrorCode.PROVIDER_TIMEOUT,
      message: 'Provider timed out after 120000ms',
      retryable: true,
    });
  });
});
