/**
 * Error de una API externa. Guardamos el status para decidir si vale la pena reintentar:
 * un 503 o un 429 seguramente se arregla solo, un 404 no.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, body: string) {
    super(`HTTP ${status} en ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

/** Algo que no se arregla reintentando (pedido inexistente, datos incompletos...). */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export function isRetriable(error: unknown): boolean {
  if (error instanceof PermanentError) return false;
  if (error instanceof HttpError) {
    return error.status === 429 || error.status >= 500;
  }
  // Errores de red, timeouts, etc.
  return true;
}
