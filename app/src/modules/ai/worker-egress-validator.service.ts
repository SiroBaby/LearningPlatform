import { lookup } from 'node:dns/promises';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { WORKER_DNS_LOOKUP, type WorkerDnsLookup, type WorkerEgressValidator } from './contracts/worker-egress-validator.contract';

@Injectable()
export class UnpinnedClientDnsEgressValidator implements WorkerEgressValidator {
  constructor(@Optional() @Inject(WORKER_DNS_LOOKUP) private readonly dns?: WorkerDnsLookup) {}

  async validateBeforeUnpinnedClientCreation(hostname: string): Promise<void> {
    const resolver: WorkerDnsLookup = this.dns ?? {
      lookup: async (
        host: string,
        options: { readonly all: true; readonly verbatim: true },
      ): Promise<readonly { readonly address: string }[]> => lookup(host, options),
    };
    const first = await resolver.lookup(hostname, { all: true, verbatim: true });
    const second = await resolver.lookup(hostname, { all: true, verbatim: true });
    const firstAddresses = this.sortedAddresses(first);
    const secondAddresses = this.sortedAddresses(second);
    if (firstAddresses.length === 0 || firstAddresses.join(',') !== secondAddresses.join(',')) {
      throw new Error('Custom model host DNS resolution is unstable');
    }
    if (firstAddresses.some((address) => isBlockedAddress(address))) {
      throw new Error('Custom model host resolves to a prohibited network');
    }
  }

  private sortedAddresses(rows: readonly { readonly address: string }[]): readonly string[] {
    return rows.map((row) => row.address).sort();
  }
}

function isBlockedAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('ff')) {
    return true;
  }
  const octets = address.split('.').map((value) => Number(value));
  if (octets.length !== 4 || !octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return false;
  const first = octets[0];
  const second = octets[1];
  return first === 0 || first === 10 || first === 127 || first >= 224 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168;
}
