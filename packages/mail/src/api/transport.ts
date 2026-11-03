// How the module reaches the mail API: over HTTP, to the server the host app already talks to.
// Pure TypeScript with no React Native imports, so it runs in plain Node tests.

export type MailRequest = {
  method: string;
  /** Path and query, e.g. `/v1/mail/conversations?by=topic`. */
  path: string;
  headers?: Record<string, string>;
  body?: string;
};

export type MailResponse = { status: number; text: string };

export interface MailTransport {
  send(req: MailRequest): Promise<MailResponse>;
}

export type MailServerConfig = { baseUrl: string; token: string };

export class RemoteMailTransport implements MailTransport {
  constructor(
    private config: MailServerConfig,
    // wrapped because browsers throw "Illegal invocation" when fetch is called as a method of another object
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async send(req: MailRequest): Promise<MailResponse> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}${req.path}`, {
      method: req.method,
      headers: { Authorization: `Bearer ${this.config.token}`, ...(req.headers ?? {}) },
      body: req.body,
    });
    return { status: res.status, text: await res.text() };
  }
}
