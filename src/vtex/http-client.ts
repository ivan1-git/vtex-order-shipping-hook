import { HttpError } from '../errors.ts';
import type { VtexOrder } from '../types.ts';
import type { TrackingUpdate, VtexClient } from './client.ts';

interface Options {
  account: string;
  environment: string;
  appKey: string;
  appToken: string;
  timeoutMs?: number;
}

/** Cliente real contra la API del OMS de VTEX. Solo se usa con MODE=live. */
export class HttpVtexClient implements VtexClient {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #timeoutMs: number;

  constructor(options: Options) {
    this.#baseUrl = `https://${options.account}.${options.environment}.com.br`;
    this.#headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-VTEX-API-AppKey': options.appKey,
      'X-VTEX-API-AppToken': options.appToken,
    };
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getOrder(orderId: string): Promise<VtexOrder> {
    const response = await this.#request('GET', `/api/oms/pvt/orders/${encodeURIComponent(orderId)}`);
    return (await response.json()) as VtexOrder;
  }

  async startHandling(orderId: string): Promise<void> {
    await this.#request('POST', `/api/oms/pvt/orders/${encodeURIComponent(orderId)}/start-handling`);
  }

  async updateTracking(orderId: string, invoiceNumber: string, tracking: TrackingUpdate): Promise<void> {
    const path = `/api/oms/pvt/orders/${encodeURIComponent(orderId)}/invoice/${encodeURIComponent(invoiceNumber)}`;
    await this.#request('PATCH', path, tracking);
  }

  async #request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = this.#baseUrl + path;
    const response = await fetch(url, {
      method,
      headers: this.#headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });

    if (!response.ok) {
      throw new HttpError(response.status, url, await response.text());
    }
    return response;
  }
}
