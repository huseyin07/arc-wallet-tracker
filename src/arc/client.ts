import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  webSocket,
  type PublicClient,
} from 'viem';

export interface ArcNetworkConfig {
  chainId: number;
  rpcUrl: string;
  fallbackRpcUrls?: string[];
  wsUrl?: string;
  explorerUrl: string;
}

export function createArcChain(config: ArcNetworkConfig) {
  const httpUrls = [config.rpcUrl, ...(config.fallbackRpcUrls ?? [])];
  return defineChain({
    id: config.chainId,
    name: 'ARC Mainnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    rpcUrls: { default: { http: httpUrls } },
    blockExplorers: { default: { name: 'ARC Scan', url: config.explorerUrl } },
  });
}

export function createArcClients(config: ArcNetworkConfig): {
  httpClient: PublicClient;
  wsClient?: PublicClient;
} {
  const chain = createArcChain(config);
  const rpcUrls = [config.rpcUrl, ...(config.fallbackRpcUrls ?? [])]
    .map((url) => url.trim())
    .filter(Boolean);

  const transports = rpcUrls.map((url) =>
    http(url, { retryCount: 2, timeout: 8_000 }),
  );

  const primaryTransport = transports[0];
  if (!primaryTransport) throw new Error('At least one ARC RPC URL is required');

  return {
    httpClient: createPublicClient({
      chain,
      // A single flaky RPC must not stop wallet monitoring. Viem tries the next
      // configured transport when the active provider errors or times out.
      transport: transports.length > 1 ? fallback(transports) : primaryTransport,
    }),
    wsClient: config.wsUrl
      ? createPublicClient({
          chain,
          transport: webSocket(config.wsUrl, { reconnect: true, retryCount: 5 }),
        })
      : undefined,
  };
}

export type ArcClient = PublicClient;
