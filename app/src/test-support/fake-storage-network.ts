import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo, connect, Socket } from 'node:net';

export interface FakeStorageError {
  readonly status: number;
  readonly code: string;
}

export interface FakeS3Server {
  readonly host: string;
  readonly port: number;
  /** Methods and paths received, for asserting what the client really sent. */
  readonly requests: readonly string[];
  stop(): Promise<void>;
}

export interface FakeEgressProxy {
  readonly url: string;
  /** `host:port` of every CONNECT tunnel the client asked for. */
  readonly connectTargets: readonly string[];
  stop(): Promise<void>;
}

const LOOPBACK_HOST = '127.0.0.1';

/** S3-compatible endpoint that answers every request with one S3 error document. */
export async function startFakeS3Server(error: FakeStorageError): Promise<FakeS3Server> {
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requests.push(`${request.method ?? ''} ${request.url ?? ''}`);
    request.resume();
    const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${error.code}</Code><Message>fake</Message></Error>`;
    response.writeHead(error.status, {
      'Content-Length': Buffer.byteLength(body),
      'Content-Type': 'application/xml',
    });
    response.end(body);
  });
  const port = await listen(server);
  return { host: LOOPBACK_HOST, port, requests, stop: () => close(server, new Set()) };
}

/**
 * Minimal CONNECT proxy like the Squid egress proxy. It records the exact
 * host the client tunnels to, then either forwards or refuses the tunnel.
 */
export async function startFakeEgressProxy(options: { readonly forward: boolean }): Promise<FakeEgressProxy> {
  const connectTargets: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    // Plain HTTP forwarding would bypass the CONNECT allowlist.
    response.writeHead(405);
    response.end();
  });
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('connect', (request: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    const target = request.url ?? '';
    connectTargets.push(target);
    if (!options.forward) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const separator = target.lastIndexOf(':');
    const upstream = connect(Number(target.slice(separator + 1)), target.slice(0, separator), () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  const port = await listen(server);
  return {
    connectTargets,
    stop: () => close(server, sockets),
    url: `http://${LOOPBACK_HOST}:${port}`,
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
