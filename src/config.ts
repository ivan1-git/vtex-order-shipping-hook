export type Mode = 'demo' | 'live';

export interface Config {
  port: number;
  mode: Mode;
  hookSecret: string;
  maxAttempts: number;
  retryBaseMs: number;
  carrierFailureRate: number;
  vtex: {
    account: string;
    environment: string;
    appKey: string;
    appToken: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode: Mode = env.MODE === 'live' ? 'live' : 'demo';

  const config: Config = {
    port: Number(env.PORT ?? 3000),
    mode,
    hookSecret: env.HOOK_SECRET ?? 'cambia-este-secreto',
    maxAttempts: Number(env.MAX_ATTEMPTS ?? 5),
    retryBaseMs: Number(env.RETRY_BASE_MS ?? 1000),
    carrierFailureRate: Number(env.CARRIER_FAILURE_RATE ?? 0.3),
    vtex: {
      account: env.VTEX_ACCOUNT ?? '',
      environment: env.VTEX_ENVIRONMENT ?? 'vtexcommercestable',
      appKey: env.VTEX_APP_KEY ?? '',
      appToken: env.VTEX_APP_TOKEN ?? '',
    },
  };

  if (mode === 'live') {
    const missing = (['account', 'appKey', 'appToken'] as const).filter((key) => !config.vtex[key]);
    if (missing.length > 0) {
      throw new Error(`En modo live faltan variables de VTEX: ${missing.join(', ')}`);
    }
  }

  return config;
}
