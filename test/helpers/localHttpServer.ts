import http, { type IncomingMessage, type ServerResponse } from 'http';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface LocalHttpServer {
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

export async function startLocalHttpServer(
  handler: (
    request: RecordedRequest,
    response: ServerResponse,
  ) => void | Promise<void>,
): Promise<LocalHttpServer> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', async () => {
        const recorded: RecordedRequest = {
          method: request.method || 'GET',
          url: request.url || '/',
          headers: request.headers,
          body: Buffer.concat(chunks),
        };
        requests.push(recorded);

        try {
          await handler(recorded, response);
        } catch (error: any) {
          response.writeHead(500, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              code: 500,
              msg: error?.message || 'local test server error',
            }),
          );
        }
      });
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start local HTTP server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
