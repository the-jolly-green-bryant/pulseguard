# Deployment guide

## 1. Prerequisites

- Node.js 22+
- a Cloudflare account
- a domain using Cloudflare DNS for inbound Email Routing
- optional Resend and Twilio accounts

Authenticate once with `npx wrangler login`.

## 2. Create and migrate D1

```bash
npm run db:create
```

Copy the returned `database_id` into `wrangler.jsonc`, keeping the binding name `DB`, then run:

```bash
npm run db:migrate:remote
```

## 3. Configure secrets

Create a long random API key and keep it in your password manager:

```bash
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ALERT_FROM_EMAIL
```

For SMS, add all three values:

```bash
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_FROM_NUMBER
```

Omitting Twilio leaves email alerts fully functional. Omitting Resend records a failed email delivery without crashing other channels.

## 4. Deploy

```bash
npm run deploy
```

Wrangler publishes the React assets and Worker together, attaches D1, and creates the five-minute cron trigger.

## 5. Connect inbound email

In Cloudflare Dashboard:

1. Open **Email > Email Routing** for your domain and enable routing.
2. Open **Email Workers** and connect the deployed `pulseguard` Worker.
3. Add a route such as `*@watch.example.com` to the Worker.
4. Use a unique address for each monitor, such as `revenue@watch.example.com`.

Cloudflare requires a domain for Email Routing; a `workers.dev` address cannot receive mail.

## 6. Create a monitor

Set your API key in the shell without committing it:

```bash
export PULSEGUARD_ADMIN_API_KEY='your-secret'
```

Then use the request in the README. Configure the source system to send or forward its daily message to the monitor's `inboxAddress`.

## 7. Smoke tests

```bash
curl https://your-worker.workers.dev/health
curl https://your-worker.workers.dev/v1/monitors \
  -H "Authorization: Bearer $PULSEGUARD_ADMIN_API_KEY"
```

For a non-email integration, `POST /v1/heartbeats/:monitorId` with the same bearer token.

## Updating

Run `npm test`, review the diff, then run `npm run deploy`. Apply schema changes before deploying code that depends on them.
