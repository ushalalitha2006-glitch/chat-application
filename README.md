# Pulse — Real-Time Private Chat Application

A modern, full-stack **real-time chat application** that enables two users to chat privately with end-to-end access control, live presence, typing indicators, read receipts, and persistent chat history.

> Developed as a **Summer Internship Project** at **Codec Technologies**.
> Built with the assistance of AI tools to accelerate development while applying clean architecture, security best practices, and modern UI/UX principles.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Tech Stack](#tech-stack)
4. [Architecture](#architecture)
5. [Database Schema](#database-schema)
6. [Project Structure](#project-structure)
7. [Getting Started](#getting-started)
8. [Environment Variables](#environment-variables)
9. [Deployment](#deployment)
10. [Security](#security)
11. [Screenshots](#screenshots)
12. [AI Assistance Acknowledgment](#ai-assistance-acknowledgment)
13. [Author](#author)
14. [License](#license)

---

## Overview

**Pulse** is a serverless, real-time messaging platform where members of a workspace can exchange **private one-to-one messages**. Unlike a traditional public chat room, every conversation is strictly scoped to its two participants — no third party (not even the admin) can read messages between two users, thanks to **Row-Level Security (RLS)** enforced at the database layer.

The application demonstrates how to combine a modern React framework with a managed backend to ship a production-grade, real-time experience without operating any custom servers.

---

## Features

-   **Authentication** — Email/password and Google OAuth sign-in.
-   **Private 1-to-1 Messaging** — Messages are visible only to the sender and recipient.
-   **Real-Time Updates** — New messages, presence, typing, and read receipts appear instantly via WebSocket subscriptions.
-   **Online Presence** — Live online/offline indicators with a 25-second heartbeat.
-   **Typing Indicators** — See when the other person is typing (auto-expires after 4 seconds).
-   **Read Receipts** — Single check on send, double check ("Seen") once the recipient views the message.
-   **Unread Badges** — Per-conversation unread counts in the sidebar.
-   **Chat History** — Dedicated, searchable history page grouped by date.
-   **Responsive UI** — Mobile-first layout with a slide-in members panel.
-   **Modern Design System** — Custom OKLCH color tokens, gradient branding, and a glow shadow palette.

---

## Tech Stack

| Layer        | Technology                                                          |
| ------------ | ------------------------------------------------------------------- |
| Frontend     | React 19, TanStack Start, TanStack Router, TanStack Query           |
| Build Tool   | Vite 7                                                              |
| Language     | TypeScript (strict mode)                                            |
| Styling      | Tailwind CSS v4, shadcn/ui, Lucide Icons                            |
| Backend      | Supabase (PostgreSQL, Auth, Realtime) via Lovable Cloud             |
| Forms        | React Hook Form + Zod                                               |
| Hosting      | Cloudflare Workers (edge) via Lovable                               |
| Tooling      | ESLint, Prettier, Bun                                               |

---

## Architecture

```
┌──────────────────────┐        WebSocket / HTTPS         ┌──────────────────────────┐
│   React Frontend     │ ───────────────────────────────► │   Supabase (Postgres)    │
│  (TanStack Start)    │ ◄─────────────────────────────── │  Auth · Realtime · RLS   │
└──────────┬───────────┘                                  └──────────────┬───────────┘
           │                                                             │
           │  createServerFn (typed RPC)                                  │
           ▼                                                             ▼
┌──────────────────────┐                                  ┌──────────────────────────┐
│  Edge Server Funcs   │                                  │   Row-Level Security     │
│ (Cloudflare Workers) │                                  │  (per-user access rules) │
└──────────────────────┘                                  └──────────────────────────┘
```

-   **Frontend** uses TanStack Start for SSR-capable file-based routing.
-   **Realtime** subscriptions (`postgres_changes`) push inserts/updates from Postgres directly to the browser.
-   **Authentication** is handled by Supabase Auth; an `_authenticated` layout route protects the chat pages.
-   **Privacy** is enforced server-side via PostgreSQL RLS — the frontend cannot bypass it even if requests are tampered with.

---

## Database Schema

| Table             | Purpose                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| `profiles`        | One row per user (name, email, status, last_seen). Auto-created via trigger on signup. |
| `messages`        | DMs with `sender_id`, `recipient_id`, `text`, `created_at`.                          |
| `message_reads`   | Read receipts: which user read which message and when.                               |
| `typing_status`   | Volatile per-user typing state.                                                      |

### Row-Level Security Highlights

-   **`messages`** — readable/writable only when `auth.uid() = sender_id OR auth.uid() = recipient_id`.
-   **`message_reads`** — only the recipient of a message may insert a read receipt for it.
-   **`profiles`** — any authenticated user can read profiles (member directory), but each user can update only their own row.

---

## Project Structure

```
.
├── src/
│   ├── routes/
│   │   ├── __root.tsx               # App shell (html/head/body)
│   │   ├── index.tsx                # Landing page
│   │   ├── auth.tsx                 # Sign in / sign up
│   │   └── _authenticated/
│   │       ├── route.tsx            # Auth gate
│   │       ├── chat.tsx             # Main chat UI
│   │       └── history.tsx          # Searchable chat history
│   ├── integrations/supabase/       # Auto-generated client + types
│   ├── components/ui/               # shadcn/ui primitives
│   ├── assets/                      # Logo + static assets
│   └── styles.css                   # Tailwind v4 theme tokens
├── supabase/
│   └── migrations/                  # SQL migrations (tables, RLS, triggers)
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

-   **Node.js** 20+ or **Bun** 1.1+
-   A **Supabase** project (free tier is sufficient)

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/pulse-chat.git
cd pulse-chat
```

### 2. Install dependencies

```bash
bun install
# or
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root (see [Environment Variables](#environment-variables)).

### 4. Apply database migrations

Apply the SQL files in `supabase/migrations/` to your Supabase project (via the Supabase CLI or the SQL Editor in the dashboard).

### 5. Run the dev server

```bash
bun dev
# or
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) to view the app.

---

## Environment Variables

| Variable                       | Description                                          |
| ------------------------------ | ---------------------------------------------------- |
| `VITE_SUPABASE_URL`            | Your Supabase project URL.                           |
| `VITE_SUPABASE_PUBLISHABLE_KEY`| Public anon key from Supabase API settings.          |
| `VITE_SUPABASE_PROJECT_ID`     | Project reference ID.                                |

> The publishable key is safe to expose in the client — RLS protects the data.

---

## Deployment

The app builds to a single edge-compatible bundle:

```bash
bun run build
```

It can be deployed to:

-   **Lovable** (one-click publish from the editor)
-   **Cloudflare Workers / Pages**
-   **Vercel** or any Node-compatible host (with a small adapter change)

For the included setup, the production build runs on **Cloudflare Workers** with `nodejs_compat` enabled.

---

## Security

-   All tables have **Row-Level Security enabled** with explicit policies.
-   No table relies on client-side checks for access control.
-   Anonymous sign-ups are disabled by default.
-   Service-role credentials are **never** exposed to the client.
-   OAuth tokens are stored in `localStorage` and refreshed automatically by the Supabase JS client.

---

## Screenshots

> Add screenshots/GIFs of the landing page, chat interface, and mobile view here.

---

## AI Assistance Acknowledgment

Portions of this project — including initial scaffolding, UI components, database migrations, and documentation — were developed with the help of **AI coding assistants**. Every AI-generated suggestion was reviewed, tested, and adapted by the author to meet the project's requirements and quality standards. AI was used as a productivity tool, not as a substitute for understanding the codebase.

---

## Author

**Developed by:** *[Your Name]*
**Internship:** Summer Internship Project @ **Codec Technologies**
**Year:** 2025

For questions or feedback, please open an issue on the repository.

---

## License

This project is released under the **MIT License**. See [`LICENSE`](./LICENSE) for details.
