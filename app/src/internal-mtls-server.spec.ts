import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:https';

import { createInternalMtlsServer, type InternalMtlsServerLifecycle } from './internal-mtls-server';

interface PkiFiles {
  readonly ca: string;
  readonly caKey: string;
  readonly cert: string;
  readonly key: string;
}

const temporaryDirectories: string[] = [];

const openssl = (args: readonly string[]): void => {
  execFileSync('openssl', args, { stdio: 'ignore' });
};

const createPki = async (): Promise<PkiFiles> => {
  const directory = await mkdtemp(join(tmpdir(), 'internal-mtls-'));
  temporaryDirectories.push(directory);
  const ca = join(directory, 'ca.crt');
  const caKey = join(directory, 'ca.key');
  const cert = join(directory, 'server.crt');
  const csr = join(directory, 'server.csr');
  const extensions = join(directory, 'server.ext');
  const key = join(directory, 'server.key');
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', ca, '-days', '1', '-subj', '/CN=test-ca']);
  await writeFile(extensions, 'subjectAltName=DNS:api-internal\nextendedKeyUsage=serverAuth\n');
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', '/CN=api-internal']);
  openssl(['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', cert, '-days', '1', '-extfile', extensions]);
  return { ca, caKey, cert, key };
};

const createTrustedClient = async (pki: PkiFiles): Promise<PkiFiles> => {
  const directory = await mkdtemp(join(tmpdir(), 'internal-mtls-client-'));
  temporaryDirectories.push(directory);
  const cert = join(directory, 'client.crt');
  const csr = join(directory, 'client.csr');
  const key = join(directory, 'client.key');
  const extensions = join(directory, 'client.ext');
  await writeFile(extensions, 'subjectAltName=URI:spiffe://learning-platform.local/ns/test/sa/go-worker\nextendedKeyUsage=clientAuth\n');
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', '/CN=go-worker']);
  openssl(['x509', '-req', '-in', csr, '-CA', pki.ca, '-CAkey', pki.caKey, '-CAcreateserial', '-out', cert, '-days', '1', '-extfile', extensions]);
  return { ca: pki.ca, caKey: pki.caKey, cert, key };
};

const connect = async (port: number, pki: PkiFiles, client?: PkiFiles): Promise<number> => {
  const [ca, cert, key] = await Promise.all([
    readFile(pki.ca),
    client ? readFile(client.cert) : undefined,
    client ? readFile(client.key) : undefined,
  ]);
  return new Promise((resolve, reject) => {
  const requestHandle = request({
    ca,
    cert,
    host: '127.0.0.1',
    key,
    path: '/internal/v1/lease-authority',
    port,
    rejectUnauthorized: true,
    servername: 'api-internal',
  }, (response) => resolve(response.statusCode ?? 0));
  requestHandle.once('error', reject);
  requestHandle.end();
  });
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('createInternalMtlsServer', () => {
  it('validates the server certificate and rejects plain or untrusted clients', async () => {
    const pki = await createPki();
    const client = await createTrustedClient(pki);
    const untrustedClient = await createTrustedClient(await createPki());
    const lifecycle = await createInternalMtlsServer({
      getHttpAdapter: () => ({ getInstance: () => (_request: unknown, response: { end(): void }) => response.end() }),
    } as never, { caPath: pki.ca, certPath: pki.cert, enabled: true, expectedClientSpiffeUri: 'spiffe://learning-platform.local/ns/test/sa/go-worker', expectedWebBffSpiffeUri: 'spiffe://learning-platform.local/ns/test/sa/web-bff', keyPath: pki.key, port: 0 });
    expect(lifecycle).toBeDefined();
    try {
      await new Promise<void>((resolve) => lifecycle?.server.listen(0, resolve));
      const port = (lifecycle?.server.address() as { port: number }).port;

      await expect(connect(port, pki)).rejects.toThrow();
      await expect(connect(port, pki, untrustedClient)).rejects.toThrow();
      await expect(connect(port, pki, client)).resolves.toBe(200);
    } finally {
      await lifecycle?.close();
    }
  });

  it('reloads a complete projected Secret and ignores an incomplete projection', async () => {
    const pki = await createPki();
    const server = await createInternalMtlsServer({
      getHttpAdapter: () => ({ getInstance: () => (_request: unknown, response: { end(): void }) => response.end() }),
    } as never, { caPath: pki.ca, certPath: pki.cert, enabled: true, expectedClientSpiffeUri: 'spiffe://learning-platform.local/ns/test/sa/go-worker', expectedWebBffSpiffeUri: 'spiffe://learning-platform.local/ns/test/sa/web-bff', keyPath: pki.key, port: 0 });
    const context = jest.spyOn(server!.server, 'setSecureContext');
    try {
      const [ca, cert, key] = await Promise.all([readFile(pki.ca), readFile(pki.cert), readFile(pki.key)]);
      await Promise.all([writeFile(pki.ca, ca), writeFile(pki.cert, cert), writeFile(pki.key, key)]);
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(context).toHaveBeenCalledTimes(1);

      await writeFile(pki.key, 'incomplete projection');
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(context).toHaveBeenCalledTimes(1);
    } finally {
      await server?.close();
    }
  });

  it('stops watching projected material after close', async () => {
    const pki = await createPki();
    const server = await createInternalMtlsServer({
      getHttpAdapter: () => ({ getInstance: () => (_request: unknown, response: { end(): void }) => response.end() }),
    } as never, { caPath: pki.ca, certPath: pki.cert, enabled: true, expectedClientSpiffeUri: 'spiffe://learning-platform.local/ns/test/sa/go-worker', expectedWebBffSpiffeUri: 'spiffe://learning-platform.local/ns/test/sa/web-bff', keyPath: pki.key, port: 0 });
    const context = jest.spyOn(server!.server, 'setSecureContext');
    const [ca, cert, key] = await Promise.all([readFile(pki.ca), readFile(pki.cert), readFile(pki.key)]);

    await server?.close();
    await Promise.all([writeFile(pki.ca, ca), writeFile(pki.cert, cert), writeFile(pki.key, key)]);
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(context).not.toHaveBeenCalled();
  });
});
