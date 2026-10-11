import type { components } from "./schema";

export type Transaction = components["schemas"]["TransactionDto"];
export type ImportReport = components["schemas"]["ImportReport"];
export type Recurring = components["schemas"]["RecurringDto"];
export type Envelope = components["schemas"]["EnvelopeDto"];
export type EnvelopeStatus = components["schemas"]["EnvelopeStatusDto"];
export type Disposable = components["schemas"]["DisposableDto"];

export type ApiConfig = { baseUrl: string; token: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Thin typed client for the Financer REST API (the same API the embedded backend will serve). */
export class Api {
  constructor(private config: ApiConfig) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.config.token}`, ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (typeof body?.error === "string") message = body.error;
      } catch {
        // body was not JSON; keep the status message
      }
      throw new ApiError(res.status, res.status === 401 ? "Wrong or missing API token" : message);
    }
    return (await res.json()) as T;
  }

  /** Open endpoint: checks the server is reachable, without needing the token. */
  async health(): Promise<boolean> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/health`);
    return res.ok;
  }

  transactions() {
    return this.request<Transaction[]>("/v1/transactions");
  }

  importCsv(bytes: ArrayBuffer) {
    return this.request<ImportReport>("/v1/transactions/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: bytes,
    });
  }

  recurring() {
    return this.request<Recurring[]>("/v1/recurring");
  }

  disposable() {
    return this.request<Disposable>("/v1/budget/disposable");
  }

  envelopes() {
    return this.request<Envelope[]>("/v1/budget/envelopes");
  }

  saveEnvelopes(envelopes: Envelope[]) {
    return this.request<Envelope[]>("/v1/budget/envelopes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelopes),
    });
  }

  budgetStatus(year: number, month: number) {
    return this.request<EnvelopeStatus[]>(`/v1/budget/status?year=${year}&month=${month}`);
  }
}
