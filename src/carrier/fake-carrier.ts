import { HttpError } from '../errors.ts';
import type { Shipment, ShipmentRequest } from '../types.ts';
import type { CarrierClient } from './client.ts';

interface Options {
  /** Probabilidad (0 a 1) de que la API "se caiga". Sirve para ver los reintentos en acción. */
  failureRate?: number;
  random?: () => number;
}

/**
 * Paquetería de mentira. Se comporta como muchas APIs reales de envíos:
 * a veces responde 503 y hay que volver a intentar.
 */
export class FakeCarrier implements CarrierClient {
  readonly created: ShipmentRequest[] = [];
  readonly #failureRate: number;
  readonly #random: () => number;
  #sequence = 1000;

  constructor(options: Options = {}) {
    this.#failureRate = options.failureRate ?? 0;
    this.#random = options.random ?? Math.random;
  }

  async createShipment(request: ShipmentRequest): Promise<Shipment> {
    if (this.#random() < this.#failureRate) {
      throw new HttpError(503, 'fake://carrier/shipments', 'Servicio temporalmente no disponible');
    }

    this.created.push(request);
    const trackingNumber = `ENV${request.postalCode}${++this.#sequence}`;
    return {
      carrier: 'Envíos Demo',
      trackingNumber,
      trackingUrl: `https://rastreo.example.com/${trackingNumber}`,
      labelUrl: `https://rastreo.example.com/guias/${trackingNumber}.pdf`,
    };
  }
}
