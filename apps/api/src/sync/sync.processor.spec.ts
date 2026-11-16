import { DelayedError, type Job } from 'bullmq';

import { SYNC_JOBS } from './sync.constants';
import { SyncProcessor } from './sync.processor';

import type { SyncEngine } from './sync-engine.service';
import type { SyncScheduler } from './sync-scheduler.service';
import type { SyncTargetedService } from './sync-targeted.service';

function setup(outcome: Awaited<ReturnType<SyncEngine['run']>>) {
  const engine = { run: jest.fn().mockResolvedValue(outcome) };
  const targeted = { handle: jest.fn().mockResolvedValue(undefined) };
  const scheduler = { fanout: jest.fn().mockResolvedValue({ queued: 1, skipped: 0 }) };
  const processor = new SyncProcessor(
    engine as unknown as SyncEngine,
    targeted as unknown as SyncTargetedService,
    scheduler as unknown as SyncScheduler,
  );
  const job = {
    name: SYNC_JOBS.incremental,
    data: { syncRunId: 'run1', integrationId: 'int1', userId: 'u1' },
    attemptsMade: 0,
    opts: { attempts: 3 },
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  };
  return { processor, job, engine, targeted, scheduler };
}

describe('SyncProcessor', () => {
  it('runs the engine with the attempt number and returns its outcome', async () => {
    const { processor, job, engine } = setup({ type: 'finished', status: 'SUCCEEDED' });
    await expect(processor.process(job as unknown as Job, 'tok')).resolves.toEqual({
      type: 'finished',
      status: 'SUCCEEDED',
    });
    expect(engine.run).toHaveBeenCalledWith('run1', 'u1', { number: 1, max: 3 });
  });

  it('DATA-04: a rate-limit pause moves the same job to delayed instead of failing or dropping data', async () => {
    const until = new Date('2026-11-16T12:00:00Z');
    const { processor, job } = setup({ type: 'delayed', until });
    await expect(processor.process(job as unknown as Job, 'tok')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.moveToDelayed).toHaveBeenCalledWith(until.getTime(), 'tok');
  });

  it('dispatches targeted and fan-out jobs', async () => {
    const { processor, job, targeted, scheduler } = setup({ type: 'skipped' });
    await processor.process({
      ...job,
      name: SYNC_JOBS.targeted,
      data: { deliveryId: 'd', event: { kind: 'ignored', reason: 'x' } },
    } as unknown as Job);
    expect(targeted.handle).toHaveBeenCalledWith(
      { deliveryId: 'd', event: { kind: 'ignored', reason: 'x' } },
      { number: 1, max: 3 },
    );
    await processor.process({ ...job, name: SYNC_JOBS.fanout, data: {} } as unknown as Job);
    expect(scheduler.fanout).toHaveBeenCalled();
  });
});
