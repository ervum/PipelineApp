export const JobStatus = {
  QUEUED: 'QUEUED',
  COMPILING: 'COMPILING',
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  READY: 'READY',
  DISPATCHING: 'DISPATCHING',
  COLD_START: 'COLD_START',
  RUNNING: 'RUNNING',
  INGESTING: 'INGESTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];
export const JOB_STATUSES: readonly JobStatus[] = Object.values(JobStatus);
