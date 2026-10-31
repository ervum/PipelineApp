import { JobStatus } from '../enums';

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  'QUEUED',
  'COMPILING',
  'READY',
  'DISPATCHING',
  'COLD_START',
  'RUNNING',
  'INGESTING',
];

export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  QUEUED: ['COMPILING', 'READY', 'CANCELLED', 'FAILED'],
  COMPILING: ['AWAITING_REVIEW', 'READY', 'FAILED', 'CANCELLED'],
  AWAITING_REVIEW: ['COMPILING', 'READY', 'CANCELLED'],
  READY: ['DISPATCHING', 'CANCELLED', 'FAILED'],
  DISPATCHING: ['COLD_START', 'RUNNING', 'INGESTING', 'FAILED', 'CANCELLED'],
  COLD_START: ['RUNNING', 'INGESTING', 'FAILED', 'CANCELLED'],
  RUNNING: ['INGESTING', 'FAILED', 'CANCELLED'],
  INGESTING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['QUEUED'],
  CANCELLED: [],
};

export const canTransition = (from: JobStatus, to: JobStatus): boolean =>
  JOB_TRANSITIONS[from].includes(to);
