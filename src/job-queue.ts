import type { Logger } from './types.ts';

export interface JobQueueOptions<T> {
  handler: (payload: T) => Promise<unknown>;
  maxAttempts: number;
  baseDelayMs: number;
  isRetriable: (error: unknown) => boolean;
  logger: Logger;
}

export interface FailedJob<T> {
  key: string;
  payload: T;
  attempts: number;
  error: string;
  failedAt: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cola en memoria con tres reglas:
 *
 * 1. Una misma llave solo se procesa una vez (VTEX puede mandar el mismo aviso dos veces).
 * 2. Los trabajos del mismo grupo (el mismo pedido) van en orden, uno detrás de otro.
 *    Si "invoiced" llega pegado a "ready-for-handling", no se procesa antes de que exista la guía.
 * 3. Si algo falla y vale la pena reintentar, espera 1x, 2x, 4x... el tiempo base.
 */
export class JobQueue<T> {
  readonly #options: JobQueueOptions<T>;
  readonly #seen = new Set<string>();
  readonly #chains = new Map<string, Promise<void>>();
  readonly #failed: FailedJob<T>[] = [];
  #pending = 0;
  #completed = 0;
  #idleWaiters: Array<() => void> = [];

  constructor(options: JobQueueOptions<T>) {
    this.#options = options;
  }

  /** @returns false si la llave ya estaba en la cola o ya se procesó */
  enqueue(key: string, group: string, payload: T): boolean {
    if (this.#seen.has(key)) {
      return false;
    }
    this.#seen.add(key);
    this.#pending++;

    const previous = this.#chains.get(group) ?? Promise.resolve();
    const current = previous.then(() => this.#process(key, payload));
    this.#chains.set(group, current);
    void current.finally(() => {
      if (this.#chains.get(group) === current) {
        this.#chains.delete(group);
      }
    });

    return true;
  }

  /** Se resuelve cuando ya no queda nada pendiente. Útil en pruebas y al apagar el servicio. */
  idle(): Promise<void> {
    if (this.#pending === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  stats() {
    return {
      pending: this.#pending,
      completed: this.#completed,
      failed: [...this.#failed],
    };
  }

  async #process(key: string, payload: T): Promise<void> {
    const { handler, maxAttempts, baseDelayMs, isRetriable, logger } = this.#options;

    for (let attempt = 1; ; attempt++) {
      try {
        const result = await handler(payload);
        this.#completed++;
        logger.info({ key, attempt, result }, 'Evento procesado');
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (!isRetriable(error) || attempt >= maxAttempts) {
          logger.error({ key, attempt, error: message }, 'Evento descartado');
          this.#failed.push({ key, payload, attempts: attempt, error: message, failedAt: new Date().toISOString() });
          // Libero la llave para que, si VTEX vuelve a mandar el aviso, se intente de nuevo
          this.#seen.delete(key);
          break;
        }

        const delay = baseDelayMs * 2 ** (attempt - 1);
        logger.warn({ key, attempt, retryInMs: delay, error: message }, 'Falló, se reintenta');
        await sleep(delay);
      }
    }

    this.#pending--;
    if (this.#pending === 0) {
      this.#idleWaiters.forEach((resolve) => resolve());
      this.#idleWaiters = [];
    }
  }
}
