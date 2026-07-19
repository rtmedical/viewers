import Queue from './Queue';
import makeDeferred from './makeDeferred';

describe('Queue', () => {
  it('should prevent task execution when queue limit is reached', async () => {
    const queue = new Queue(1);
    const deferred = makeDeferred();
    const task = jest.fn(() => deferred.promise);
    const queuedTask = queue.bind(task);

    const first = queuedTask();
    await expect(queuedTask()).rejects.toThrow('Queue limit reached');

    deferred.resolve('done');
    await expect(first).resolves.toBe('done');
    expect(task).toHaveBeenCalledTimes(1);
    expect(queue.size).toBe(0);
  });

  it('should safely bind tasks to the queue', async () => {
    const queue = new Queue(1);
    const deferred = makeDeferred();
    const task = jest.fn(() => deferred.promise);
    const onError = jest.fn();
    const queuedTask = queue.bindSafe(task, onError);

    const first = queuedTask();
    await expect(queuedTask()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: 'Queue limit reached' })
    );

    deferred.resolve('done');
    await expect(first).resolves.toBe('done');
    expect(task).toHaveBeenCalledTimes(1);
    expect(queue.size).toBe(0);
  });
});
