import Fastify, { LogController } from 'fastify';

import orders from '../fixtures/orders.json' with { type: 'json' };
import { FakeCarrier } from './carrier/fake-carrier.ts';
import { loadConfig } from './config.ts';
import { isRetriable } from './errors.ts';
import { JobQueue } from './job-queue.ts';
import { createOrderEventHandler } from './order-events.ts';
import { orderHookRoutes } from './routes.ts';
import { ShipmentStore } from './shipment-store.ts';
import type { OrderHookEvent, VtexOrder } from './types.ts';
import type { VtexClient } from './vtex/client.ts';
import { FakeVtexClient } from './vtex/fake-client.ts';
import { HttpVtexClient } from './vtex/http-client.ts';

const config = loadConfig();

const app = Fastify({
  // Los logs de cada request hacen ruido; lo importante se loguea a mano en las rutas y en la cola
  logController: new LogController({ disableRequestLogging: true }),
  logger:
    process.env.NODE_ENV === 'production'
      ? true
      : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,reqId' } } },
});

const vtex: VtexClient =
  config.mode === 'live' ? new HttpVtexClient(config.vtex) : new FakeVtexClient(orders as VtexOrder[]);

// La paquetería siempre es de mentira: en un proyecto real aquí iría la API de la paquetería del cliente
const carrier = new FakeCarrier({ failureRate: config.carrierFailureRate });
const shipments = new ShipmentStore();

const queue = new JobQueue<OrderHookEvent>({
  handler: createOrderEventHandler({ vtex, carrier, shipments, logger: app.log }),
  maxAttempts: config.maxAttempts,
  baseDelayMs: config.retryBaseMs,
  isRetriable,
  logger: app.log,
});

await app.register(orderHookRoutes, { hookSecret: config.hookSecret, queue, shipments });

async function shutdown(signal: string) {
  app.log.info(`${signal} recibido, terminando lo pendiente...`);
  await app.close();
  await Promise.race([queue.idle(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`Modo ${config.mode}. Webhook en POST /webhooks/vtex/orders`);
