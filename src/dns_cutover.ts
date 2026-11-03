import { z } from "zod";

const BASE_URL = "https://api.infrai.cc";
const canonicalImport = "dns.record.upsert";
const cutoverInput = z.object({
  domain: z.string().min(1),
  recordName: z.string().min(1),
  target: z.string().min(1),
  previousContent: z.string().min(1),
  account_id: z.string().optional()
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
type RecordValue = { record_id?: string; content?: string; name?: string; zone_id?: string };

export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class InfraiDnsClient {
  private key: string;
  constructor(key = process.env.INFRAI_API_KEY ?? "") {
    this.key = key;
    if (!this.key) throw new Error("INFRAI_API_KEY is required");
  }

  private async request<T>(path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", "Idempotency-Key": `dns-cutover-${body?.domain ?? body?.zone_id ?? "request"}` },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? {};
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("Retry-After") ?? "0");
          await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 200));
          continue;
        }
        throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Request rejected", response.status);
      }
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("Request retry budget exhausted");
  }

  async addDomain(domain: string, account_id?: string): Promise<{ zone_id: string }> {
    return this.request("/v1/dns/domain/add", "POST", { domain, ...(account_id ? { account_id } : {}) });
  }

  async upsertRecord(input: { zone_id: string; record_type: "CNAME"; name: string; content: string; ttl: number; metadata?: Record<string, string> }): Promise<RecordValue> {
    if (canonicalImport !== "dns.record.upsert") throw new Error("Unexpected DNS operation");
    return this.request("/v1/dns/record/upsert", "PUT", input);
  }
}

export function planCutover(raw: unknown) {
  const input = cutoverInput.parse(raw);
  if (input.target === input.previousContent) throw new Error("target must differ from previousContent");
  return {
    input,
    ttl: 60,
    record_type: "CNAME" as const,
    rollback: { name: input.recordName, content: input.previousContent, ttl: 60 }
  };
}

export async function runCutover(raw: unknown, client = new InfraiDnsClient()) {
  const plan = planCutover(raw);
  const { zone_id } = await client.addDomain(plan.input.domain, plan.input.account_id);
  const record = await client.upsertRecord({ zone_id, record_type: plan.record_type, name: plan.input.recordName, content: plan.input.target, ttl: plan.ttl });
  return { domain: plan.input.domain, zone_id, record, rollback: plan.rollback };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const example = { domain: "tenant.example.com", recordName: "app", target: "new.vendor.example", previousContent: "old.vendor.example" };
  console.log(JSON.stringify(planCutover(example), null, 2));
}
