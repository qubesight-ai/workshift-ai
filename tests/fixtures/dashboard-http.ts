import type { Server } from 'node:http';

// Exercise the actual HTTP request listener without opening sockets (CI sandbox forbids listen).
export function localFetch(server: Server) {
  return async (input: string, init: RequestInit = {}) => new Promise<Response>(resolve => {
    const headers = new Headers();
    const reqHeaders: Record<string,string> = {};
    new Headers(init.headers).forEach((v,k) => { reqHeaders[k] = v; });
    server.emit('request', { url: new URL(input).pathname + new URL(input).search, method: init.method ?? 'GET', headers: { host: 'localhost', ...reqHeaders } }, {
      setHeader(name: string, value: string) { headers.set(name, value); },
      writeHead(status: number, values: Record<string,string>) { this.status = status; for (const [k,v] of Object.entries(values)) headers.set(k,v); },
      status: 200,
      end(body: string) { resolve(new Response(body, { status: this.status, headers })); },
    });
  });
}

