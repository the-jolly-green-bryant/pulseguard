# Costs and tradeoffs

The base watchdog can stay inside Cloudflare and Resend free tiers for a small personal workload. Always verify current provider pricing before depending on those limits.

## Why SMS is optional

Application-to-person SMS has carrier fees and regulatory requirements. Trial balances are useful for a portfolio demo, but “free forever” SMS is not a responsible production promise. Carrier email-to-SMS gateways are intentionally not included: delivery is inconsistent, carriers are retiring them, and sender reputation is difficult to control.

For a no-cost alert path, use multiple Resend email recipients. For urgent production paging, configure Twilio and set a budget alert.

## Cost controls

- The cron runs every five minutes, not every minute.
- D1 queries use small indexed tables and select only enabled monitors.
- An alert is claimed once per monitor per day before providers are called.
- No container, VM, queue, or always-on process is required.
- SMS remains opt-in and independent from email delivery.

## Scale path

At larger volume, partition monitor checks by next deadline, enqueue alert deliveries, retry transient failures with exponential backoff, and add provider-level spend caps.
