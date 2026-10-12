// Lo que manda VTEX en cada cambio de estado de un pedido (Orders Hook)
export interface OrderHookEvent {
  Domain: string;
  OrderId: string;
  State: string;
  LastState?: string;
  LastChange?: string;
  CurrentChange?: string;
  Origin?: { Account?: string; Key?: string };
}

// Solo los campos del pedido que este servicio usa. El pedido real de VTEX trae muchísimo más.
export interface VtexOrder {
  orderId: string;
  status: string;
  clientProfileData: {
    firstName: string;
    lastName: string;
    phone?: string;
  };
  shippingData: {
    address: {
      receiverName: string;
      postalCode: string;
      city: string;
      state: string;
      street: string;
      number: string;
      neighborhood?: string;
      complement?: string | null;
    };
  };
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    additionalInfo?: { dimension?: { weight?: number } };
  }>;
  packageAttachment: {
    packages: Array<{
      invoiceNumber: string;
      invoiceValue?: number;
      trackingNumber?: string | null;
    }>;
  };
}

export interface Shipment {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
  labelUrl: string;
}

export interface ShipmentRequest {
  orderId: string;
  receiverName: string;
  phone?: string;
  postalCode: string;
  city: string;
  state: string;
  addressLine: string;
  packages: number;
  weightKg: number;
}

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  debug(obj: object | string, msg?: string): void;
}
