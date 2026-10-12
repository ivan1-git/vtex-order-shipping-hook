import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpError, PermanentError, isRetriable } from '../src/errors.ts';
import { JobQueue } from '../src/job-queue.ts';
import { silentLogger } from './helpers.ts';

function queueWith(handler: (payload: string) => Promise<unknown>, maxAttempts = 3) {
  return new JobQueue<string>({ handler, maxAttempts, baseDelayMs: 1, isRetriable, logger: silentLogger });
}

describe('JobQueue', () => {
  it('reintenta hasta que el trabajo sale bien', async () => {
    let calls = 0;
    const queue = queueWith(async () => {
      calls++;
      if (calls < 3) throw new HttpError(503, 'https://api', 'caído');
    });

    queue.enqueue('a', 'g1', 'payload');
    await queue.idle();

    assert.equal(calls, 3);
    assert.equal(queue.stats().completed, 1);
    assert.equal(queue.stats().failed.length, 0);
  });

  it('se rinde después del máximo de intentos y guarda el error', async () => {
    let calls = 0;
    const queue = queueWith(async () => {
      calls++;
      throw new HttpError(500, 'https://api', 'error');
    });

    queue.enqueue('a', 'g1', 'payload');
    await queue.idle();

    assert.equal(calls, 3);
    const [failed] = queue.stats().failed;
    assert.equal(failed?.key, 'a');
    assert.equal(failed?.attempts, 3);
  });

  it('no reintenta errores que no se arreglan solos', async () => {
    let calls = 0;
    const queue = queueWith(async () => {
      calls++;
      throw new PermanentError('pedido sin dirección');
    });

    queue.enqueue('a', 'g1', 'payload');
    await queue.idle();

    assert.equal(calls, 1);
    assert.equal(queue.stats().failed.length, 1);
  });

  it('ignora llaves repetidas pero las libera si el trabajo falló', async () => {
    let shouldFail = true;
    const queue = queueWith(async () => {
      if (shouldFail) throw new HttpError(404, 'https://api', 'no existe');
    });

    assert.equal(queue.enqueue('a', 'g1', 'payload'), true);
    assert.equal(queue.enqueue('a', 'g1', 'payload'), false);
    await queue.idle();

    // Falló, así que si VTEX vuelve a mandar el aviso se debe procesar
    shouldFail = false;
    assert.equal(queue.enqueue('a', 'g1', 'payload'), true);
    await queue.idle();
    assert.equal(queue.stats().completed, 1);
  });

  it('procesa en orden los trabajos del mismo grupo aunque el primero tarde', async () => {
    const order: string[] = [];
    const queue = queueWith(async (payload) => {
      if (payload === 'lento') await new Promise((resolve) => setTimeout(resolve, 30));
      order.push(payload);
    });

    queue.enqueue('1', 'pedido-1', 'lento');
    queue.enqueue('2', 'pedido-1', 'rápido');
    await queue.idle();

    assert.deepEqual(order, ['lento', 'rápido']);
  });
});

describe('isRetriable', () => {
  it('reintenta 429 y 5xx, no 4xx', () => {
    assert.equal(isRetriable(new HttpError(429, 'u', '')), true);
    assert.equal(isRetriable(new HttpError(502, 'u', '')), true);
    assert.equal(isRetriable(new HttpError(400, 'u', '')), false);
    assert.equal(isRetriable(new TypeError('fetch failed')), true);
  });
});
