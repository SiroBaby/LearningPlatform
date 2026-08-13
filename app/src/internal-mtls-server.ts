import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createServer, type Server, type ServerOptions } from 'node:https';
import type { INestApplication } from '@nestjs/common';
import { createSecureContext } from 'node:tls';

import type { InternalMtlsSettings } from './config/configuration.types';

const RELOAD_DEBOUNCE_MS = 250;

export interface InternalMtlsServerLifecycle {
  close(): Promise<void>;
  readonly server: Server;
}

type TlsMaterial = Pick<ServerOptions, 'ca' | 'cert' | 'key'>;

async function readTlsMaterial(settings: InternalMtlsSettings): Promise<TlsMaterial> {
  const { caPath, certPath, keyPath } = settings;
  if (!caPath || !certPath || !keyPath) throw new Error('Internal mTLS paths are incomplete');
  const [ca, cert, key] = await Promise.all([readFile(caPath), readFile(certPath), readFile(keyPath)]);
  return { ca, cert, key };
}

export async function createInternalMtlsServer(
  app: INestApplication,
  settings: InternalMtlsSettings,
): Promise<InternalMtlsServerLifecycle | undefined> {
  if (!settings.enabled) return undefined;

  const material = await readTlsMaterial(settings);
  const server = createServer(
    { ...material, rejectUnauthorized: true, requestCert: true },
    app.getHttpAdapter().getInstance(),
  );
  let reloadTimer: NodeJS.Timeout | undefined;
  let closed = false;
  let reloading = false;
  let reloadQueued = false;

  const reload = async (): Promise<void> => {
    if (closed) return;
    if (reloading) {
      reloadQueued = true;
      return;
    }
    reloading = true;
    try {
      // A failed projected-Secret update leaves the last known-good context active.
      const nextMaterial = await readTlsMaterial(settings);
      createSecureContext(nextMaterial);
      if (closed) return;
      server.setSecureContext(nextMaterial);
    } catch {
      // The next projection event retries the reload without interrupting clients.
    } finally {
      reloading = false;
      if (reloadQueued) {
        reloadQueued = false;
        void reload();
      }
    }
  };
  const scheduleReload = (): void => {
    if (closed) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      void reload();
    }, RELOAD_DEBOUNCE_MS);
  };
  // Watch projection directories because Kubernetes swaps Secret symlinks atomically.
  const watchers: FSWatcher[] = [...new Set([settings.caPath, settings.certPath, settings.keyPath].map(dirname))]
    .map((path) => watch(path, { persistent: false }, scheduleReload));

  return {
    server,
    async close(): Promise<void> {
      closed = true;
      if (reloadTimer) clearTimeout(reloadTimer);
      watchers.forEach((watcher) => watcher.close());
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
