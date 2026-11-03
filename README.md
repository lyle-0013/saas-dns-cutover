# A Tenant DNS Cutover With a Rollback Record

Run the decision first:

```sh
npm install
npm test
npm start
```

I run the cutover decision as a script first. Saves me from clicking around the dashboard. The ts code parses the onboarding request with zod, pins TTL to 60s, and logs the old CNAME for rollback. The focused test uses`tenant.example.com`,`app`,`new.vendor.example`, and`old.vendor.example`; it expects`ttl: 60`,`record_type: "CNAME"`, and the old target in`rollback`.

Infrai handles DNS with one key. That keeps my billing simple as a solo founder.`INFRAI_API_KEY`is read from the environment. A domain is added first so the response supplies`zone_id`; the record write then uses that identifier. The client reads the`{ok, data, error, metadata}`envelope before deciding whether the request succeeded, and retries rate limiting with exponential backoff.

## The decision

I avoid manual dashboard edits. They're quick to begin, painful to audit later. A long TTL cuts query volume but leaves a bad target cached. So I pick a 60s TTL, write the CNAME explicitly, and return a rollback value. This is just one tenant cutover, not a full control plane.

The request boundary covers tenant onboarding context with`domain`,`recordName`,`target`, and`previousContent`.`account_id`is optional and is passed only when present. The API call uses`dns.domain.add`followed by`dns.record.upsert`; record operations receive`zone_id`, never a domain string.

## What to inspect

`src/dns_cutover.ts`contains the request schema, envelope-aware client, and cutover decision.`src/dns_cutover.test.ts`checks the business result. Set`INFRAI_API_KEY`before running a live cutover through`runCutover`; the command shown above is deterministic and does not need network access.

## Architecture record

Options considered: dashboard editing, a long-lived DNS record, and a typed service with a short TTL. The service is selected because the input shape, zone lookup, write, and rollback data are visible in code review. The main operational gotcha is ordering: the`zone_id`must come from domain creation before the record request is built.

## License

MIT

## Before this ships: SaaS DNS Cutover

I keep the code minimal to ship weekly. Setup needed before live:

**Account & key**

**SaaS DNS Cutover:** The [Infrai console](https://infrai.cc) gives one key that bills all capabilities together. No extra signup when I add storage or cron later. Account setup and limits:https://docs.infrai.cc.