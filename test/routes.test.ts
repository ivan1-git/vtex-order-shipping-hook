import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { isRetriable } from '../src/errors.ts';
import { JobQueue } from '../src/job-queue.ts';
import { orderHookRoutes } from '../src/routes.ts';
import { ShipmentStore } from '../src/shipment-store.ts';
import type { OrderHookEvent } from '../src/types.ts';
import { hook, silentLogger } from './helpers.ts';

describe('POST /webhooks/vtex/orders', () => {
  let app: FastifyInstance;
  let queue: JobQueue<OrderHookEvent>;
  const received: OrderHookEvent[] = [];
  const secret = 'secreto-de-prueba';

  before(async () => {
    queue = new JobQueue<OrderHookEvent>({
      handler: async (event) => received.push(event),
      maxAttempts: 1,
      baseDelayMs: 1,
      isRetriable,
      logger: silentLogger,
    });
    app = Fastify();
    await app.register(orderHookRoutes, { hookSecret: secret, queue, shipments: new ShipmentStore() });
  });

  after(() => app.close());

  const post = (body: unknown, headers: Record<string, string> = { 'x-hook-secret': secret }) =>
    app.inject({ method: 'POST', url: '/webhooks/vtex/orders', payload: body as object, headers });

  it('contesta el ping de VTEX aunque no traiga el secreto', async () => {
    const response = await post({ hookConfig: 'ping' }, {});

    assert.equal(response.statusCode, 200);
  });

  it('rechaza avisos sin el secreto correcto', async () => {
    const response = await post(hook('v1-01', 'invoiced'), { 'x-hook-secret': 'otro' });

    assert.equal(response.statusCode, 401);
  });

  it('rechaza cuerpos que no parecen un aviso de VTEX', async () => {
    const response = await post({ Domain: 'Fulfillment', State: 'invoiced' });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().issues[0], /OrderId/);
  });

  it('encola el aviso y marca los repetidos', async () => {
    const first = await post(hook('v2-01', 'ready-for-handling'));
    const repeated = await post(hook('v2-01', 'ready-for-handling'));

    assert.deepEqual(first.json(), { received: true, duplicate: false });
    assert.deepEqual(repeated.json(), { received: true, duplicate: true });

    await queue.idle();
    const status = await app.inject({ method: 'GET', url: '/status' });
    assert.equal(status.json().completed, 1);
    assert.equal(received.filter((event) => event.OrderId === 'v2-01').length, 1);
  });
});
