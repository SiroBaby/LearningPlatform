export const WORKER_EGRESS_VALIDATOR = Symbol('WORKER_EGRESS_VALIDATOR');
export const WORKER_DNS_LOOKUP = Symbol('WORKER_DNS_LOOKUP');

export interface WorkerDnsLookup {
  lookup(hostname: string, options: { readonly all: true; readonly verbatim: true }): Promise<readonly { readonly address: string }[]>;
}

export interface WorkerEgressValidator {
  validateBeforeUnpinnedClientCreation(hostname: string): Promise<void>;
}
