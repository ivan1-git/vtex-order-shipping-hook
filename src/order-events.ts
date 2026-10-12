import type { CarrierClient } from './carrier/client.ts';
import { PermanentError } from './errors.ts';
import type { ShipmentStore } from './shipment-store.ts';
import type { Logger, OrderHookEvent, ShipmentRequest, VtexOrder } from './types.ts';
import type { VtexClient } from './vtex/client.ts';

export type EventResult =
  | { action: 'shipment-created'; orderId: string; trackingNumber: string }
  | { action: 'handling-started'; orderId: string }
  | { action: 'tracking-sent'; orderId: string; invoiceNumber: string; trackingNumber: string }
  | { action: 'skipped'; orderId: string; reason: string };

interface Dependencies {
  vtex: VtexClient;
  carrier: CarrierClient;
  shipments: ShipmentStore;
  logger: Logger;
}

// Si un producto no trae peso en el catálogo, asumimos medio kilo
const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

/**
 * Qué hacer con cada estado del pedido:
 *
 * - ready-for-handling: el pago ya está aprobado, toca generar la guía y avisar a VTEX
 *   que empezamos a preparar el pedido.
 * - invoiced: ya hay factura, toca mandarle a VTEX el número de rastreo para que el
 *   cliente lo vea en "Mis pedidos".
 *
 * Todo lo demás se ignora.
 */
export function createOrderEventHandler({ vtex, carrier, shipments, logger }: Dependencies) {
  async function prepareShipment(orderId: string): Promise<EventResult> {
    const existing = shipments.get(orderId);

    if (existing?.handlingStarted) {
      return { action: 'skipped', orderId, reason: 'el pedido ya tiene guía' };
    }

    // La guía se creó pero falló el start-handling: solo falta ese paso
    if (existing) {
      await vtex.startHandling(orderId);
      shipments.update(orderId, { handlingStarted: true });
      return { action: 'handling-started', orderId };
    }

    const order = await vtex.getOrder(orderId);
    if (order.status === 'canceled' || order.status === 'cancellation-requested') {
      return { action: 'skipped', orderId, reason: `el pedido está ${order.status}` };
    }

    const shipment = await carrier.createShipment(toShipmentRequest(order));
    shipments.save({
      ...shipment,
      orderId,
      createdAt: new Date().toISOString(),
      handlingStarted: false,
      trackingSentForInvoice: null,
    });
    logger.info({ orderId, trackingNumber: shipment.trackingNumber }, 'Guía generada');

    await vtex.startHandling(orderId);
    shipments.update(orderId, { handlingStarted: true });

    return { action: 'shipment-created', orderId, trackingNumber: shipment.trackingNumber };
  }

  async function sendTracking(orderId: string): Promise<EventResult> {
    const record = shipments.get(orderId);
    if (!record) {
      return { action: 'skipped', orderId, reason: 'este servicio no generó la guía del pedido' };
    }

    const order = await vtex.getOrder(orderId);
    const invoice = order.packageAttachment.packages.at(-1);
    if (!invoice) {
      // VTEX avisó "invoiced" pero la factura todavía no aparece: casi siempre es cuestión de segundos
      throw new Error(`El pedido ${orderId} está facturado pero aún no tiene factura`);
    }

    if (record.trackingSentForInvoice === invoice.invoiceNumber) {
      return { action: 'skipped', orderId, reason: 'el tracking ya se había enviado' };
    }

    await vtex.updateTracking(orderId, invoice.invoiceNumber, {
      trackingNumber: record.trackingNumber,
      trackingUrl: record.trackingUrl,
      courier: record.carrier,
    });
    shipments.update(orderId, { trackingSentForInvoice: invoice.invoiceNumber });

    return {
      action: 'tracking-sent',
      orderId,
      invoiceNumber: invoice.invoiceNumber,
      trackingNumber: record.trackingNumber,
    };
  }

  return async function handle(event: OrderHookEvent): Promise<EventResult> {
    switch (event.State) {
      case 'ready-for-handling':
        return prepareShipment(event.OrderId);
      case 'invoiced':
        return sendTracking(event.OrderId);
      default:
        return { action: 'skipped', orderId: event.OrderId, reason: `estado ${event.State} no requiere acción` };
    }
  };
}

export function toShipmentRequest(order: VtexOrder): ShipmentRequest {
  const { address } = order.shippingData;
  if (!address?.postalCode) {
    throw new PermanentError(`El pedido ${order.orderId} no tiene código postal de entrega`);
  }

  const grams = order.items.reduce((total, item) => {
    const weight = item.additionalInfo?.dimension?.weight ?? DEFAULT_ITEM_WEIGHT_GRAMS;
    return total + weight * item.quantity;
  }, 0);

  const addressLine = [`${address.street} ${address.number}`, address.complement, address.neighborhood]
    .filter(Boolean)
    .join(', ');

  return {
    orderId: order.orderId,
    receiverName: address.receiverName,
    phone: order.clientProfileData.phone,
    postalCode: address.postalCode,
    city: address.city,
    state: address.state,
    addressLine,
    packages: 1,
    weightKg: Math.round(grams / 10) / 100,
  };
}
