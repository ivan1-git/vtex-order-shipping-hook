import { HttpError } from '../errors.ts';
import type { VtexOrder } from '../types.ts';
import type { TrackingUpdate, VtexClient } from './client.ts';

/**
 * Un OMS de VTEX en memoria para correr el proyecto sin cuenta ni credenciales.
 * Además guarda las llamadas que recibió, lo que lo hace útil en las pruebas.
 */
export class FakeVtexClient implements VtexClient {
  readonly orders = new Map<string, VtexOrder>();
  readonly calls: string[] = [];

  constructor(orders: VtexOrder[] = []) {
    for (const order of orders) {
      this.orders.set(order.orderId, structuredClone(order));
    }
  }

  async getOrder(orderId: string): Promise<VtexOrder> {
    this.calls.push(`getOrder ${orderId}`);
    return structuredClone(this.#find(orderId));
  }

  async startHandling(orderId: string): Promise<void> {
    this.calls.push(`startHandling ${orderId}`);
    this.#find(orderId).status = 'handling';
  }

  async updateTracking(orderId: string, invoiceNumber: string, tracking: TrackingUpdate): Promise<void> {
    this.calls.push(`updateTracking ${orderId} ${invoiceNumber} ${tracking.trackingNumber}`);
    const invoice = this.#find(orderId).packageAttachment.packages.find((p) => p.invoiceNumber === invoiceNumber);
    if (!invoice) {
      throw new HttpError(404, `fake://orders/${orderId}/invoice/${invoiceNumber}`, 'Invoice not found');
    }
    invoice.trackingNumber = tracking.trackingNumber;
  }

  #find(orderId: string): VtexOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new HttpError(404, `fake://orders/${orderId}`, 'Order not found');
    }
    return order;
  }
}
