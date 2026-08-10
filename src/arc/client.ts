import {
  createPublicClient,
  defineChain,
  http,
  webSocket,
  type PublicClient,
} from 'viem';

export interface ArcNetworkConfig {
  chainId: number;
  rpcUrl: string;
  wsUrl?: string;
  explorerUrl: string;
}

export function createArcChain(config: ArcNetworkConfig) {
  return defineChain({
    id: config.chainId,
    name: 'ARC Mainnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: { default: { name: 'ARC Scan', url: config.explorerUrl } },
  });
}

export function createArcClients(config: ArcNetworkConfig): {
  httpClient: PublicClient;
  wsClient?: PublicClient;
} {
  const chain = createArcChain(config);
  return {
    httpClient: createPublicClient({
      chain,
      transport: http(config.rpcUrl, { retryCount: 3, timeout: 15_000 }),
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
