import type { Logger, OrderHookEvent, VtexOrder } from '../src/types.ts';

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

export function order(overrides: Partial<VtexOrder> = {}): VtexOrder {
  return {
    orderId: 'v500-01',
    status: 'ready-for-handling',
    clientProfileData: { firstName: 'Ana', lastName: 'Torres', phone: '+525500000000' },
    shippingData: {
      address: {
        receiverName: 'Ana Torres',
        postalCode: '03100',
        city: 'Ciudad de México',
        state: 'CDMX',
        street: 'Insurgentes Sur',
        number: '1000',
        neighborhood: 'Del Valle',
        complement: null,
      },
    },
    items: [
      { id: '1', name: 'Playera', quantity: 2, additionalInfo: { dimension: { weight: 250 } } },
      { id: '2', name: 'Gorra', quantity: 1 },
    ],
    packageAttachment: { packages: [{ invoiceNumber: 'F-100', trackingNumber: null }] },
    ...overrides,
  };
}

export function hook(orderId: string, state: string): OrderHookEvent {
  return {
    Domain: 'Fulfillment',
    OrderId: orderId,
    State: state,
    LastState: 'payment-approved',
    LastChange: '2026-10-12T15:00:00Z',
    CurrentChange: '2026-10-12T15:00:01Z',
  };
}
