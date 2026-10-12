import type { Shipment } from './types.ts';

export interface ShipmentRecord extends Shipment {
  orderId: string;
  createdAt: string;
  handlingStarted: boolean;
  trackingSentForInvoice: string | null;
}

/**
 * Qué pedidos ya tienen guía. Es lo que evita generar dos guías para el mismo pedido
 * cuando VTEX manda el mismo evento dos veces o cuando un paso falla y se reintenta.
 *
 * En memoria a propósito para que el proyecto se levante sin nada más. En producción
 * esto iría en una base de datos o en Redis.
 */
export class ShipmentStore {
  readonly #records = new Map<string, ShipmentRecord>();

  get(orderId: string): ShipmentRecord | undefined {
    return this.#records.get(orderId);
  }

  save(record: ShipmentRecord): void {
    this.#records.set(record.orderId, record);
  }

  update(orderId: string, changes: Partial<ShipmentRecord>): void {
    const current = this.#records.get(orderId);
    if (current) {
      this.#records.set(orderId, { ...current, ...changes });
    }
  }

  all(): ShipmentRecord[] {
    return [...this.#records.values()];
  }
}
