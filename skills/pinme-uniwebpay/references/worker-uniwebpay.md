# Worker UniwebPay Reference

Use this file when implementing concrete Cloudflare Worker TypeScript code for PinMe UniwebPay payments.

## Install

Install the SDK only when Worker code imports it. Pick the package manager from the existing lockfile.

```bash
pnpm add @uniwebpay/sdk
npm install @uniwebpay/sdk
yarn add @uniwebpay/sdk
bun add @uniwebpay/sdk
```

## Core Helpers

```typescript
import Uniweb from "@uniwebpay/sdk";

export interface Env {
  UNIWEB_SECRET: string;
  UNIWEB_API_URL?: string;
  UNIWEB_PAY_URL?: string;
  UNIWEB_WALLET_ID?: string;
  PROJECT_NAME?: string;
  WORKER_URL?: string;
  DB?: D1Database;
  UNIWEB_WEBHOOK_SECRET?: string;
}

type PaymentMethod = "card" | "wechat" | "alipay" | "paynow";

const VALID_PAYMENT_METHODS = new Set<PaymentMethod>(["card", "wechat", "alipay", "paynow"]);

function uniwebClient(env: Env): Uniweb {
  return new Uniweb(env.UNIWEB_SECRET, {
    baseUrl: env.UNIWEB_API_URL,
    payUrl: env.UNIWEB_PAY_URL,
  });
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return Response.json(data, {
    ...init,
    headers,
  });
}

async function readJSON<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function assertAmountCents(value: unknown): number {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 10) {
    throw new Error("amountCents must be an integer minor-unit amount >= 10");
  }
  return amount;
}

function normalizeCurrency(value: unknown): string {
  const currency = String(value || "SGD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("currency must be an ISO 4217 code");
  return currency;
}

function defaultPaymentMethods(currency: string): PaymentMethod[] {
  if (currency === "SGD") return ["card", "wechat", "alipay", "paynow"];
  if (currency === "CNY") return ["card", "wechat", "alipay"];
  return ["card"];
}

function normalizePaymentMethods(value: unknown, currency: string): PaymentMethod[] {
  const requested = Array.isArray(value) && value.length > 0 ? value : defaultPaymentMethods(currency);
  const methods = requested.map((method) => String(method).toLowerCase() as PaymentMethod);

  for (const method of methods) {
    if (!VALID_PAYMENT_METHODS.has(method)) {
      throw new Error("paymentMethodTypes contains an unsupported method");
    }
    if (method === "paynow" && currency !== "SGD") {
      throw new Error("PayNow is only supported for SGD payments");
    }
    if ((method === "wechat" || method === "alipay") && !["SGD", "CNY"].includes(currency)) {
      throw new Error("WeChat Pay and Alipay are only supported for SGD or CNY payments");
    }
  }

  return Array.from(new Set(methods));
}

function paymentUrl(payload: { url?: string; paymentUrl?: string }): string {
  const url = payload.url || payload.paymentUrl;
  if (!url) throw new Error("UniwebPay response missing payment URL");
  return url;
}

// Single source of truth for the webhook path. Use it both here and in the
// router so the webhookUrl sent to UniwebPay always matches the served route.
const WEBHOOK_PATH = "/api/pay/webhook";

function projectWebhookUrl(env: Env, request: Request, path = WEBHOOK_PATH): string {
  // Prefer the PinMe-injected WORKER_URL: it is the only in-runtime source of
  // the Worker's public host (equal to the project's api_domain platform
  // subdomain). The user's custom domain is not injected into env. Fall back to
  // request.url only for older deploys missing the binding; in non-HTTP contexts
  // (cron/queue) there is no request, so require WORKER_URL instead.
  const base = env.WORKER_URL || request.url;
  return new URL(path, base).toString();
}
```

## Payment Link Route

Use this for a simple one-time payment link. It is the lightest Worker integration.

```typescript
type CreatePaymentLinkBody = {
  orderId?: string;
  amountCents: number;
  currency?: string;
  name?: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
  paymentMethodTypes?: PaymentMethod[];
};

async function createPaymentLink(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, { status: 405 });

  let input: CreatePaymentLinkBody;
  try {
    input = await readJSON<CreatePaymentLinkBody>(request);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 400 });
  }

  const orderId = input.orderId || crypto.randomUUID();
  const amount = assertAmountCents(input.amountCents);
  const currency = normalizeCurrency(input.currency);
  const paymentMethodTypes = normalizePaymentMethods(input.paymentMethodTypes, currency);
  const webhookUrl = projectWebhookUrl(env, request);
  const uniweb = uniwebClient(env);

  try {
    const link = await uniweb.links.create({
      amount,
      currency,
      name: input.name || "Payment",
      description: input.description,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      webhookUrl,
      paymentMethodTypes,
      metadata: {
        orderId,
        projectName: env.PROJECT_NAME,
      },
    });

    return json({
      orderId,
      linkId: link.id,
      url: paymentUrl(link as { url?: string; paymentUrl?: string }),
      walletId: env.UNIWEB_WALLET_ID,
    });
  } catch (err) {
    return json({ error: "failed to create payment link" }, { status: 502 });
  }
}
```

## Checkout Session Route

Use this when checkout is dynamic and should expire after 24 hours. Checkout sessions need a price. For truly stable catalog items, create products/prices once and store the `priceId`; do not create a new product/price for every page view.

```typescript
type CreateCheckoutBody = {
  orderId?: string;
  productName: string;
  amountCents: number;
  currency?: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  quantity?: number;
  paymentMethodTypes?: PaymentMethod[];
};

async function createCheckoutSession(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, { status: 405 });

  let input: CreateCheckoutBody;
  try {
    input = await readJSON<CreateCheckoutBody>(request);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 400 });
  }

  const orderId = input.orderId || crypto.randomUUID();
  const amount = assertAmountCents(input.amountCents);
  const currency = normalizeCurrency(input.currency);
  const quantity = Math.max(1, Math.floor(Number(input.quantity || 1)));
  const paymentMethodTypes = normalizePaymentMethods(input.paymentMethodTypes, currency);
  const webhookUrl = projectWebhookUrl(env, request);
  const uniweb = uniwebClient(env);

  try {
    const product = await uniweb.products.create({
      name: input.productName,
      webhookUrl,
      metadata: { orderId, projectName: env.PROJECT_NAME },
    });

    const price = await uniweb.prices.create({
      productId: product.id,
      amount,
      currency,
      type: "one_time",
      metadata: { orderId, projectName: env.PROJECT_NAME },
    });

    const session = await uniweb.checkout.create({
      mode: "payment",
      lineItems: [{ priceId: price.id, quantity }],
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      customerEmail: input.customerEmail,
      paymentMethodTypes,
      metadata: { orderId, projectName: env.PROJECT_NAME },
    });

    if (env.DB) {
      await env.DB.prepare(
        `INSERT INTO orders(order_id, checkout_session_id, status, amount_cents, currency, created_at)
         VALUES (?, ?, 'pending', ?, ?, ?)
         ON CONFLICT(order_id) DO UPDATE SET checkout_session_id = excluded.checkout_session_id`,
      )
        .bind(orderId, session.id, amount * quantity, currency, Math.floor(Date.now() / 1000))
        .run();
    }

    return json({
      orderId,
      checkoutSessionId: session.id,
      url: paymentUrl(session as { url?: string; paymentUrl?: string }),
      walletId: env.UNIWEB_WALLET_ID,
    });
  } catch (err) {
    return json({ error: "failed to create checkout session" }, { status: 502 });
  }
}
```

## D1 Schema

Use only if the target Worker already has D1 or the user asks for persistence.

```sql
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  checkout_session_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  order_id TEXT,
  raw_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

## Optional Webhook Route

PinMe injects `UNIWEB_WEBHOOK_SECRET` after UniwebPay credentials and the wallet webhook secret are provisioned, then the Worker is redeployed. Keep the Env binding optional for projects that have not been provisioned or redeployed yet, but generate verified webhook handling by default when payment fulfillment depends on webhooks.

Add the verifier import next to the `Uniweb` import at the top of the Worker file:

```typescript
import { verifyWebhook } from "@uniwebpay/sdk";
```

```typescript
async function handleUniwebWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, { status: 405 });
  if (!env.UNIWEB_WEBHOOK_SECRET) {
    return json({ error: "webhook verification is not configured" }, { status: 501 });
  }

  const rawBody = await request.text();
  let event: any;

  try {
    event = await verifyWebhook(
      rawBody,
      request.headers.get("uniweb-Signature") || "",
      env.UNIWEB_WEBHOOK_SECRET,
    );
  } catch {
    return json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    if (env.DB) {
      const orderId = String(event?.data?.object?.metadata?.orderId || "");
      await env.DB.prepare(
        `INSERT INTO payment_events(event_id, event_type, order_id, raw_payload, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO NOTHING`,
      )
        .bind(event.id, event.type, orderId, rawBody, Math.floor(Date.now() / 1000))
        .run();

      if (event.type === "payment.succeeded" && orderId) {
        await env.DB.prepare(
          `UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ? WHERE order_id = ? AND status != 'paid'`,
        )
          .bind(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), orderId)
          .run();
      }
    }

    return json({ ok: true });
  } catch {
    return json({ error: "processing error" }, { status: 500 });
  }
}
```

Rules:

- Keep the webhook route outside the project's own auth. Callbacks carry only `uniweb-Signature` (plus `uniweb-Event-Id` / `uniweb-Timestamp`), never the project `API_KEY`; trust comes from `verifyWebhook`, not from an auth guard.
- Read the raw body exactly once before verification.
- Return 400 for bad signatures so UniwebPay does not retry impossible deliveries.
- Return 500 for temporary processing failures so UniwebPay can retry.
- Make event handling idempotent with `event.id`.
- Check amount, currency, metadata, and current order state before granting access.
- Respond within 10s and do not redirect the webhook route; delivery has a 10s timeout and does not follow redirects.

Delivery precedence: a per-link `webhookUrl` overrides a per-product `webhookUrl`, which overrides the wallet fallback. Set `webhookUrl` on the resource that creates the payment — on `links.create` for payment links, and on `products.create` for checkout sessions (`checkout.create` has no `webhookUrl`; its events route through the backing product).

## Minimal Router

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // The webhook route must stay reachable WITHOUT the project's own auth:
    // UniwebPay callbacks carry only uniweb-Signature, never the project API_KEY.
    // Verify it here first (before any auth guard) so callbacks are not blocked.
    if (url.pathname === WEBHOOK_PATH) return handleUniwebWebhook(request, env);

    // Any project auth guard belongs after the webhook route, on these paths.
    if (url.pathname === "/api/pay/link") return createPaymentLink(request, env);
    if (url.pathname === "/api/pay/checkout") return createCheckoutSession(request, env);

    return json({ error: "not found" }, { status: 404 });
  },
};
```

## Common Mistakes

- Do not use `process.env` in Cloudflare Workers; use the `env` argument.
- Do not put `UNIWEB_SECRET` or `UNIWEB_WEBHOOK_SECRET` in `wrangler.toml`. PinMe injects them during deployment. For local dev, use an uncommitted `.dev.vars` only.
- Do not omit `webhookUrl` on payment links or products when the project expects webhook-driven fulfillment.
- Do not hardcode the webhook host or rely solely on `request.url` for `webhookUrl`; build it from the PinMe-injected `env.WORKER_URL` and fall back to `request.url` only when the binding is absent.
- Do not call `uniweb.webhooks.set`, `uniweb.webhooks.remove`, `uniweb.webhooks.rollSecret`, `uniweb.wallet.update`, refunds, payouts, or subscription mutation APIs unless the user explicitly asks for that flow and the route has project/admin authorization.
- Do not put the webhook route behind the project's API_KEY / bearer auth guard; UniwebPay callbacks would get 401/403 and orders never fulfill.
- Do not put secrets or trust-bearing data in `webhookUrl`; carry `orderId` in `metadata` and verify via signature, since a URL query can be forged.
- Do not set `webhookUrl` only on the wallet fallback for business events; set it per-link or per-product (checkout inherits from its product).
- Do not mark orders paid from `successUrl` alone.
- Do not import the SDK in browser-side code.
