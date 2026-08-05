# Pulseguard

> Know when the email you depend on never arrives.

[Live demo](https://pulseguard.bluezephyrapps.workers.dev) · [Architecture](docs/architecture.md) · [Deployment guide](docs/deployment.md)

Pulseguard is a small, serverless anomaly-detection platform for expected email. Give a daily report a private inbox and a deadline. If that message does not arrive, Pulseguard alerts every subscribed email address and, optionally, every subscribed phone number.

The dashboard is a React product demo. The Worker, database schema, scheduled checks, inbound-email handler, alert fan-out, and provider integrations are production code.

## Why this project exists

Most monitoring tools react to events. Pulseguard reacts to an event that **did not happen**. That makes idempotency, time windows, delivery fan-out, and durable state more interesting than the small interface suggests.

## Features

- Cloudflare Email Routing ingestion—free with a domain on Cloudflare
- Scheduled checks every five minutes
- Multiple email and SMS recipients per monitor
- Resend email alerts and optional Twilio SMS
- One alert run per monitor per UTC day, enforced in D1
- REST heartbeat endpoint for systems that cannot forward email
- Constant-time API key comparison and no secrets in source control
- Responsive, accessible React dashboard
- Zero always-on servers

## Stack and cost

| Layer | Choice | Typical starter cost |
|---|---|---:|
| UI + API + cron | Cloudflare Workers | Free tier |
| State | Cloudflare D1 | Free tier |
| Inbound email | Cloudflare Email Routing | Free |
| Alert email | AWS SES | Usage-based; negligible at personal volume |
| SMS | Twilio | Trial credit, then usage-based |

Production SMS is not sustainably free: carriers charge termination fees. Pulseguard keeps SMS optional and sends email alerts independently, so the core product can remain free. See [costs and tradeoffs](docs/costs.md).

## Local development

Requires Node.js 22+ and a Cloudflare account for Worker features.

```bash
npm install
npm run db:migrate:local
npm run dev
```

The Vite dashboard runs at `http://localhost:3000`. To exercise Worker routes locally, run `npm run build` followed by `npm run worker:dev`.

## Test and build

```bash
npm test
```

Unit tests cover deadline and secret-comparison behavior; the production build performs strict TypeScript checking.

## Repository map

```text
src/                              React dashboard
services/monitor-worker/src/      Worker, domain logic, and alert adapters
services/monitor-worker/schema.sql D1 schema and indexes
tests/                            Domain tests
docs/                             Architecture, setup, cost, and security notes
wrangler.jsonc                    Deployment, assets, D1, and cron configuration
```

## Production setup

The infrastructure is intentionally explicit rather than hidden behind a framework:

1. Create D1 and replace the database ID in `wrangler.jsonc`.
2. Apply `services/monitor-worker/schema.sql`.
3. Add the `ADMIN_API_KEY` and provider secrets with Wrangler.
4. Deploy with `npm run deploy`.
5. Route your monitoring subdomain to this Worker in Cloudflare Email Routing.
6. Create monitors through the authenticated API.

The exact commands and Email Routing steps are in [docs/deployment.md](docs/deployment.md).

## API snapshot

All `/v1/*` routes require `Authorization: Bearer <ADMIN_API_KEY>`.

```bash
curl -X POST https://your-worker.workers.dev/v1/monitors \
  -H "Authorization: Bearer $PULSEGUARD_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily revenue report",
    "inboxAddress": "revenue@watch.example.com",
    "scheduleHourUtc": 16,
    "graceMinutes": 15,
    "recipients": [
      {"channel":"email","destination":"ops@example.com"},
      {"channel":"sms","destination":"+14155550123"}
    ]
  }'
```

## Status

This is an intentionally focused v1. Before offering it as a multi-tenant SaaS, add user authentication, per-tenant encryption boundaries, recipient verification, timezone-aware schedules, and a delivery retry queue. Those next steps are documented without pretending they already exist.

## License

MIT
