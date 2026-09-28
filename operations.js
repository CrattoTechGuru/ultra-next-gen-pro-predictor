import crypto from 'crypto';

export function makeJobId(prefix='JOB') { return `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`; }

export function startScheduler({ syncProvider, refreshPredictions, intervalMinutes=30, logger=console }) {
  let running = false;
  const run = async (reason='scheduled') => {
    if (running) return { skipped:true, reason:'job already running' };
    running = true;
    const id = makeJobId('OPS');
    try {
      logger.log(`[${id}] starting ${reason} operations`);
      const sync = await syncProvider();
      const predictions = await refreshPredictions();
      logger.log(`[${id}] completed`);
      return { id, sync, predictions };
    } catch (error) {
      logger.error(`[${id}] failed`, error.message);
      return { id, error:error.message };
    } finally { running = false; }
  };
  const ms = Math.max(5, Number(intervalMinutes)) * 60 * 1000;
  const timer = setInterval(() => run('scheduled'), ms);
  timer.unref?.();
  return { runNow:run, stop:()=>clearInterval(timer), intervalMinutes:ms/60000 };
}
