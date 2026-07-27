import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { createApplicationLogger } from '../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../config/application-config.service';

const WORKER_HEALTH_OK_BODY = JSON.stringify({ status: 'ok' });
const WORKER_HEALTH_CLOSE_TIMEOUT_MS = 5_000;

@Injectable()
export class WorkerHealthServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = createApplicationLogger({ context: WorkerHealthServer.name });
  private readonly sockets = new Set<Socket>();
  private server: Server | undefined;

  constructor(private readonly config: ApplicationConfigService) {}

  async onApplicationBootstrap(): Promise<void> {
    const { healthHost, healthPort } = this.config.worker;
    await this.start(healthHost, healthPort);
    this.logger.log({
      event: 'worker.health.started',
      host: healthHost,
      port: healthPort,
      runtime: 'worker',
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
    this.logger.log({ event: 'worker.health.shutdown.completed', runtime: 'worker' });
  }

  private async start(host: string, port: number): Promise<void> {
    const server = createServer((request, response) => this.handleRequest(request, response));
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => {
        this.sockets.delete(socket);
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          cleanup();
          reject(error);
        };
        const onListening = (): void => {
          cleanup();
          resolve();
        };
        const cleanup = (): void => {
          server.off('error', onError);
          server.off('listening', onListening);
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    } catch (error) {
      server.close();
      throw error;
    }

    this.server = server;
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(WORKER_HEALTH_OK_BODY),
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(WORKER_HEALTH_OK_BODY);
      return;
    }

    response.statusCode = 404;
    response.end();
  }

  private async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }

    this.server = undefined;
    let closeTimedOut = false;
    let closeTimer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
        new Promise<void>((resolve) => {
          closeTimer = setTimeout(() => {
            closeTimedOut = true;
            for (const socket of this.sockets) {
              socket.destroy();
            }
            resolve();
          }, WORKER_HEALTH_CLOSE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (closeTimer) {
        clearTimeout(closeTimer);
      }
    }

    if (closeTimedOut) {
      this.logger.warn({
        event: 'worker.health.shutdown.forced',
        runtime: 'worker',
        timeoutMs: WORKER_HEALTH_CLOSE_TIMEOUT_MS,
      });
    }
  }
}
