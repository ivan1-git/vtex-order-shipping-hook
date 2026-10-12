import type { Shipment, ShipmentRequest } from '../types.ts';

/** Cualquier paquetería: genera la guía y regresa el número de rastreo. */
export interface CarrierClient {
  createShipment(request: ShipmentRequest): Promise<Shipment>;
}
