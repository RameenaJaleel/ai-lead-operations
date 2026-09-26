# AI Lead Operations — Public Cloudflare Demo

This is the public, privacy-safe demonstration layer for the local n8n/PostgreSQL automation. It reproduces the validated capture, scoring, routing, persistence, communication-preview and reminder behaviour without exposing the n8n editor or requiring a reviewer to access the local Docker stack.

## Public-demo boundaries

- Use fictional information only.
- Messages are stored as previews; they are not delivered to real recipients.
- Deterministic scoring keeps the demo stable and auditable.
- The local n8n implementation remains the reference automation architecture.

## Local development

```bash
npm install
npx wrangler d1 migrations apply ai-lead-operations-demo --local
npm run dev
```

## Deployment

Create the D1 database, copy its ID into `wrangler.jsonc`, apply migrations remotely, and deploy. Never commit `.dev.vars` or API credentials.
