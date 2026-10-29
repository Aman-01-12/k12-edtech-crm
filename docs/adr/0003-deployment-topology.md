# 0003. Two Vercel projects, same-origin via a rewrite

Status: accepted

## Context

The brief asks for a deployed URL on Vercel, Render or Netlify, and for the frontend and backend to live in separate directories.

The session design puts both tokens in cookies (see [0004](0004-token-transport.md)). That turns hosting into a correctness question rather than a preference, because whether a cookie is sent at all depends on whether the browser considers it first-party.

## Decision

Two Vercel projects from one repository:

- `backend/` deploys as a Vercel Function, pinned to the Tokyo region, next to the database.
- `frontend/` deploys as a static build, with `vercel.json` rewriting `/api/*` to the backend deployment.

The browser therefore only ever talks to the frontend's own origin.

## Alternatives considered

**Frontend on Vercel, backend on Render.**
Rejected on the free tier's behaviour: a free Render service spins down after 15 minutes idle and takes 30 to 60 seconds to answer the next request. An evaluator opening the link cold would see what looks like a broken deployment. Vercel's Fluid compute does active cold-start prevention.

**Two origins, with CORS and `SameSite=None` cookies.**
This is the arrangement that looks most conventional and it is the one that breaks. Cookies set by `api.example.com` and sent from `app.example.com` are third-party cookies. Safari blocks those by default, and Chrome is moving the same way. Sign-in would fail for an evaluator on a Mac, intermittently enough to look like a bug in the auth code rather than a hosting decision.

**One Vercel project serving the SPA from `public/` and the API from the same function.**
Workable, since Vercel serves `public/**` from its CDN. Rejected because it collapses the frontend and backend into one deployable, which contradicts the directory separation the brief asks for and couples two things with different release risk.

**Tokens in `localStorage`, which makes hosting irrelevant.**
Rejected in [0004](0004-token-transport.md) on XSS grounds.

## Consequences

No CORS is involved in production at all, because there is no cross-origin request. The allowlist still exists for local development and direct API testing, and as defence in depth.

Cookies are first-party everywhere, so `SameSite` does real work and third-party cookie policy cannot break sign-in.

The backend is pinned to Tokyo because the database is in Tokyo. A request makes one browser-to-function hop and several function-to-database hops, so the hops worth shortening are the database ones.

The cost is one extra network hop through Vercel's edge for API calls, and a backend URL that has to be filled into the frontend's `vercel.json` after the backend's first deploy. Both are documented in the README.
