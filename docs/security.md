# Security notes

- API routes require a bearer token stored as a Worker secret.
- Token comparison is constant-time for equal-length values.
- Provider credentials never enter the bundle, database, or repository.
- SQL values use D1 prepared statements.
- Unknown inbound addresses are rejected.
- The database stores only envelope metadata, not email bodies.
- Alert runs have database-enforced idempotency.

## Before multi-tenant use

Add user authentication and tenant ownership checks, encrypt sensitive destinations, verify every recipient, rate-limit writes and heartbeats, add audit logs, and establish retention/deletion policies. The current API is an operator-controlled single-tenant design.
