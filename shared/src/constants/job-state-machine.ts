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
  COMPILING: ['QUEUED', 'AWAITING_REVIEW', 'READY', 'FAILED', 'CANCELLED'],
  AWAITING_REVIEW: ['COMPILING', 'READY', 'CANCELLED'],
  READY: ['DISPATCHING', 'CANCELLED', 'FAILED'],
  DISPATCHING: ['READY', 'COLD_START', 'RUNNING', 'INGESTING', 'FAILED', 'CANCELLED'],
  COLD_START: ['READY', 'RUNNING', 'INGESTING', 'FAILED', 'CANCELLED'],
  RUNNING: ['READY', 'INGESTING', 'FAILED', 'CANCELLED'],
  INGESTING: ['READY', 'COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['QUEUED', 'READY'],
  CANCELLED: [],
};

export const canTransition = (from: JobStatus, to: JobStatus): boolean =>
  JOB_TRANSITIONS[from].includes(to);
