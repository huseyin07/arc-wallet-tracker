import { describe, expect, it } from 'vitest';
import { normalizeAddress } from './address.js';
describe('normalizeAddress',()=>{it('trims and normalizes case',()=>expect(normalizeAddress(' 0x00000000000000000000000000000000000000AB ')).toBe('0x00000000000000000000000000000000000000ab'));it('rejects malformed input',()=>expect(()=>normalizeAddress('nope')).toThrow());});
