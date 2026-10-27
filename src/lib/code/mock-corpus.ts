/** Fake repositories for demo mode (RAILWAY_MOCK), keyed by the repos in railway/mock.ts. */

export const MOCK_REPOS: Record<string, { description: string; files: Record<string, string> }> = {
  "acme/api": {
    description: "REST API for the Acme storefront",
    files: {
      "README.md": `# Acme API

![build](https://img.shields.io/badge/build-passing-green)

The REST API behind the Acme storefront. It serves the product catalog, carts and checkout,
and runs a background worker that sends order confirmation emails through Postmark.

## Running locally

\`\`\`bash
npm install && npm run dev
\`\`\`
`,
      "src/server.ts": `import express from "express";
import { checkout } from "./checkout";

const app = express();
app.post("/checkout", checkout);
app.get("/health", (_req, res) => res.send("ok"));
app.listen(process.env.PORT ?? 3000);
`,
      "src/checkout.ts": `import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function checkout(req, res) {
  const session = await stripe.checkout.sessions.create({ mode: "payment", line_items: req.body.items });
  res.json({ url: session.url });
}
`,
      "src/worker.ts": `import { ServerClient } from "postmark";

const postmark = new ServerClient(process.env.POSTMARK_TOKEN!);

export async function sendOrderEmail(to: string, orderId: string) {
  await postmark.sendEmail({ From: "orders@acme.dev", To: to, Subject: \`Order \${orderId} confirmed\` });
}
`,
    },
  },
  "acme/site": {
    description: "Marketing site for acme.dev",
    files: {
      "README.md": `# acme.dev

Marketing website for Acme, built with Next.js and deployed on Railway. Pricing, blog and docs pages
are statically generated; the contact form posts to the Acme API.
`,
      "app/page.tsx": `export default function Home() {
  return <h1>Acme — commerce for small shops</h1>;
}
`,
      "app/contact/actions.ts": `"use server";

export async function sendContact(form: FormData) {
  await fetch("https://api.acme.dev/contact", { method: "POST", body: form });
}
`,
    },
  },
  "acme/relay": {
    description: "Webhook relay",
    files: {
      "README.md": `# relay

Tiny webhook relay: receives Stripe and GitHub webhooks, verifies signatures and forwards them to
internal services. Sleeps when idle.
`,
      "index.js": `const http = require("http");
http.createServer((req, res) => { /* verify signature, forward */ res.end("ok"); }).listen(process.env.PORT);
`,
    },
  },
  "studio/portal-web": {
    description: "Client portal front end",
    files: {
      "README.md": `# Client Portal (web)

React front end for the studio's client portal, where clients review invoices, approve designs and
upload brand assets. Talks to portal-api.
`,
      "src/pages/Invoices.tsx": `export function Invoices({ invoices }) {
  return invoices.map((i) => <InvoiceRow key={i.id} invoice={i} />);
}
`,
    },
  },
  "studio/portal-api": {
    description: "Client portal API",
    files: {
      "README.md": `# portal-api

GraphQL API for the client portal. Postgres via Prisma, file uploads to S3, auth with Clerk.
`,
      "src/schema.graphql": `type Invoice { id: ID! total: Float! status: String! }
type Query { invoices: [Invoice!]! }
`,
      "src/auth.ts": `import { verifyToken } from "@clerk/backend";
export const auth = (token: string) => verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
`,
    },
  },
  "studio/pipeline": {
    description: "Data ingestion and nightly reports",
    files: {
      "README.md": `# pipeline

Ingests analytics events from client sites into Postgres and builds the nightly PDF report that is
emailed to every client at 03:00 UTC.
`,
      "ingest/worker.py": `import os
import psycopg

def handle(event):
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.execute("insert into events (payload) values (%s)", [event])
`,
      "reports/nightly.py": `from weasyprint import HTML

def build_report(client):
    return HTML(string=render(client)).write_pdf()
`,
    },
  },
  "studio/legacy-dash": {
    description: "Old analytics dashboard",
    files: {
      "README.md": `# Legacy Dashboard

The 2021 analytics dashboard, kept around for two clients who haven't moved to the portal yet.
Rails 6 + Chartkick.
`,
      "app/controllers/dashboard_controller.rb": `class DashboardController < ApplicationController
  def show
    @events = Event.where(client: current_client).last_30_days
  end
end
`,
    },
  },
};

export type MockSummary = {
  name: string;
  summary: string;
  stack: string[];
  features: string[];
  services: string[];
  entrypoint: string;
  keywords: string[];
};

/**
 * Demo stand-ins for "Summarize with Claude" results. acme/relay and studio/legacy-dash are
 * left out on purpose, so the demo also shows the README fallback and "no summary yet".
 */
export const MOCK_SUMMARIES: Record<string, MockSummary> = {
  "acme/api": {
    name: "Acme storefront API",
    summary: "Express API that serves the Acme product catalog, carts and Stripe checkout, with a worker that emails order confirmations through Postmark.",
    stack: ["TypeScript", "Node.js", "Express"],
    features: ["Product catalog and carts", "Stripe Checkout sessions", "Order confirmation emails"],
    services: ["Stripe", "Postmark"],
    entrypoint: "node dist/server.js",
    keywords: ["checkout", "stripe", "orders", "email"],
  },
  "acme/site": {
    name: "Acme marketing site",
    summary: "Next.js marketing site for acme.dev with static pricing, blog and docs pages; the contact form posts to the Acme API.",
    stack: ["TypeScript", "Next.js"],
    features: ["Static pricing, blog and docs pages", "Contact form"],
    services: ["Acme API"],
    entrypoint: "next start",
    keywords: ["website", "marketing", "contact form"],
  },
  "studio/portal-web": {
    name: "Client portal front end",
    summary: "React front end where studio clients review invoices, approve designs and upload brand assets.",
    stack: ["TypeScript", "React"],
    features: ["Invoice list", "Design approvals", "Brand asset uploads"],
    services: ["portal-api"],
    entrypoint: "npm start",
    keywords: ["portal", "invoices", "clients"],
  },
  "studio/portal-api": {
    name: "Client portal API",
    summary: "GraphQL API behind the client portal: invoices and uploads in Postgres via Prisma, files on S3, sign-in with Clerk.",
    stack: ["TypeScript", "GraphQL", "Prisma"],
    features: ["Invoices API", "File uploads to S3", "Clerk authentication"],
    services: ["Postgres", "S3", "Clerk"],
    entrypoint: "node dist/index.js",
    keywords: ["graphql", "invoices", "uploads"],
  },
  "studio/pipeline": {
    name: "Analytics pipeline",
    summary: "Python worker that loads client-site analytics events into Postgres and builds the nightly PDF report emailed to each client.",
    stack: ["Python", "Postgres", "WeasyPrint"],
    features: ["Event ingestion", "Nightly PDF reports"],
    services: ["Postgres"],
    entrypoint: "python ingest/worker.py",
    keywords: ["analytics", "reports", "pdf"],
  },
};
