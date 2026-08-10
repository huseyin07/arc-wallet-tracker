import { getAddress, isAddress, type Address } from 'viem';

export function normalizeAddress(value: string): Address {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) throw new Error('Invalid EVM address');
  return getAddress(trimmed).toLowerCase() as Address;
}

export function shortAddress(address: string): string { return `${address.slice(0, 6)}...${address.slice(-4)}`; }
