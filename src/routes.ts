import { timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { JobQueue } from './job-queue.ts';
import type { ShipmentStore } from './shipment-store.ts';
import type { OrderHookEvent } from './types.ts';

export interface RoutesOptions {
  hookSecret: string;
  queue: JobQueue<OrderHookEvent>;
  shipments: ShipmentStore;
}

const hookSchema = z.object({
  Domain: z.string(),
  OrderId: z.string().min(1),
  State: z.string().min(1),
  LastState: z.string().optional(),
  LastChange: z.string().optional(),
  CurrentChange: z.string().optional(),
  Origin: z.object({ Account: z.string().optional(), Key: z.string().optional() }).optional(),
});

export const orderHookRoutes: FastifyPluginAsync<RoutesOptions> = async (app, { hookSecret, queue, shipments }) => {
  app.get('/health', async () => ({ status: 'ok' }));

  /**
   * Aquí llegan los avisos de VTEX. La regla de oro: contestar rápido.
   * Si tardamos o fallamos, VTEX reintenta y eventualmente puede pausar el hook.
   * Por eso solo se valida, se encola y se responde; el trabajo pesado va en la cola.
   */
  app.post('/webhooks/vtex/orders', async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;

    // Al registrar el hook, VTEX manda un ping y necesita un 200 para darlo de alta
    if (body?.hookConfig === 'ping') {
      return { ok: true };
    }

    if (!secretMatches(hookSecret, request.headers['x-hook-secret'])) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const parsed = hookSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      return reply.code(400).send({ error: 'invalid-payload', issues });
    }

    const event = parsed.data;
    const accepted = queue.enqueue(`${event.OrderId}:${event.State}`, event.OrderId, event);
    request.log.info({ orderId: event.OrderId, state: event.State, duplicate: !accepted }, 'Aviso de VTEX recibido');

    return { received: true, duplicate: !accepted };
  });

  app.get('/shipments', async () => shipments.all());

  app.get('/status', async () => queue.stats());
};

function secretMatches(expected: string, received: string | string[] | undefined): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
