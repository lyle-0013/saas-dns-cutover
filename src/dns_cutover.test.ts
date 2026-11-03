import test from "node:test";
import assert from "node:assert/strict";
import { planCutover } from "./dns_cutover.ts";

test("a tenant cutover keeps a low-TTL rollback value", () => {
  const plan = planCutover({ domain: "tenant.example.com", recordName: "app", target: "new.vendor.example", previousContent: "old.vendor.example" });
  assert.equal(plan.ttl, 60);
  assert.deepEqual(plan.rollback, { name: "app", content: "old.vendor.example", ttl: 60 });
  assert.equal(plan.record_type, "CNAME");
});
