import {
  ACTIVE_JOB_STATUSES,
  canTransition,
  JOB_TRANSITIONS,
  JobStatus,
  TERMINAL_JOB_STATUSES,
} from '../src';

describe('job-state-machine', () => {
  it('allows standard AUTO_FIRE lifecycle transitions', () => {
    expect(canTransition(JobStatus.QUEUED, JobStatus.COMPILING)).toBe(true);
    expect(canTransition(JobStatus.COMPILING, JobStatus.READY)).toBe(true);
    expect(canTransition(JobStatus.READY, JobStatus.DISPATCHING)).toBe(true);
    expect(canTransition(JobStatus.DISPATCHING, JobStatus.COLD_START)).toBe(true);
    expect(canTransition(JobStatus.COLD_START, JobStatus.RUNNING)).toBe(true);
    expect(canTransition(JobStatus.RUNNING, JobStatus.INGESTING)).toBe(true);
    expect(canTransition(JobStatus.INGESTING, JobStatus.COMPLETED)).toBe(true);
  });

  it('allows INTERCEPT lifecycle transitions including recompile', () => {
    expect(canTransition(JobStatus.COMPILING, JobStatus.AWAITING_REVIEW)).toBe(true);
    expect(canTransition(JobStatus.AWAITING_REVIEW, JobStatus.COMPILING)).toBe(true);
    expect(canTransition(JobStatus.AWAITING_REVIEW, JobStatus.READY)).toBe(true);
    expect(canTransition(JobStatus.AWAITING_REVIEW, JobStatus.CANCELLED)).toBe(true);
  });

  it('allows skipMiddleman direct QUEUED -> READY transition', () => {
    expect(canTransition(JobStatus.QUEUED, JobStatus.READY)).toBe(true);
  });

  it('allows synchronous adapters to transition DISPATCHING -> INGESTING directly', () => {
    expect(canTransition(JobStatus.DISPATCHING, JobStatus.INGESTING)).toBe(true);
  });

  it('enforces terminal states and only allows retry from FAILED -> QUEUED', () => {
    expect(TERMINAL_JOB_STATUSES).toEqual(['COMPLETED', 'FAILED', 'CANCELLED']);
    expect(JOB_TRANSITIONS.COMPLETED).toEqual([]);
    expect(JOB_TRANSITIONS.CANCELLED).toEqual([]);
    expect(canTransition(JobStatus.FAILED, JobStatus.QUEUED)).toBe(true);
    expect(canTransition(JobStatus.FAILED, JobStatus.RUNNING)).toBe(false);
    expect(canTransition(JobStatus.COMPLETED, JobStatus.QUEUED)).toBe(false);
  });

  it('rejects illegal backward or skipping transitions', () => {
    expect(canTransition(JobStatus.QUEUED, JobStatus.COMPLETED)).toBe(false);
    expect(canTransition(JobStatus.RUNNING, JobStatus.QUEUED)).toBe(false);
    expect(canTransition(JobStatus.INGESTING, JobStatus.CANCELLED)).toBe(false);
    expect(ACTIVE_JOB_STATUSES).not.toContain(JobStatus.AWAITING_REVIEW);
  });
});
