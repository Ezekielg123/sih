# SIH26264 Complaint Monitoring MVP

Two workspaces in one application: a public complaint portal at `/` and a role-protected AICTE officer dashboard at `/admin`. The backend is Node.js ES modules with Express. The default local experience is clearly labeled in-memory demo mode; setting up MySQL enables durable complaint, history, note and audit persistence.

## Start locally

Requirements: Node.js 20+ and npm. MySQL 8 is optional for the demo and required for durable storage. Docker is not required.

```powershell
npm install
npm --prefix client install
npm --prefix server install
Copy-Item .env.example server/.env
npm run dev
```

Open <http://localhost:5173>. API health is <http://localhost:4000/api/health>; Swagger UI is <http://localhost:4000/api/docs>.

### Development accounts

- Administrator: `admin@demo.aicte.gov.in` / `DemoAdmin!2026`
- Bureau officer: `officer@demo.aicte.gov.in` / `DemoOfficer!2026`

These accounts are development-only. Never use them in production. The default data set has 50 fictional cases at fictional institutions; it contains no actual AICTE complaint data.

### MySQL

Create a database and user, then set `DATABASE_URL` in `server/.env`, set `DEMO_MODE=false`, and choose strong random `JWT_SECRET` and `TRACKING_TOKEN_PEPPER` values. For example:

```sql
CREATE DATABASE sih26264 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'sih_user'@'localhost' IDENTIFIED BY 'replace-this-password';
GRANT ALL PRIVILEGES ON sih26264.* TO 'sih_user'@'localhost';
```

`npm run db:init` applies `database/schema.sql`; `npm run db:seed` creates development demo identities and 50 synthetic records. The server also applies the schema when it connects. If MySQL cannot be reached, the server reports `DEMO MEMORY MODE`; changes then reset on restart. MySQL durable writes cover submitted complaints, status history, assignments, notes, public updates, related-case links, SLA notifications, agent runs, tool executions, recommendations, escalation proposals and audit entries. In memory-only demo mode, state resets on restart.

## Features

- Zod-validated complaint submission, bureau routing, one-time 256-bit tracking credential, hashed token storage and public-safe tracking output.
- JWT login, bcrypt password hashes, server-side role checks and bureau scoping for officers. Sensitive updates are audited.
- Dashboard KPIs, searchable/filtered/paginated complaint API, details, assignment, status changes, separate notes/public updates, institution aggregates, audit view, example SLA rules and charts.
- Bounded Ollama tool-calling workflow using the official Node.js package, with deterministic classification, matching, SLA and action tools as the no-key fallback. Related cases are evidence-backed suggestions, never auto-merged.
- Human approval for escalation proposals; the model cannot approve, transfer, close, link, or send external messages. Human-approved case linking is audited.
- Express rate limits, Helmet, configured CORS, parameterized mysql2 queries, and Swagger API page.

## APIs

Public endpoints: `POST /api/complaints`, `POST /api/complaints/track`, `GET /api/complaints/track/:referenceId` with `x-tracking-token`.

Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

Admin: `/api/admin/dashboard`, `/api/admin/complaints`, `/api/admin/complaints/:id`, `PATCH /api/admin/complaints/:id/status`, assignment, notes, updates, institution profile, analytics, audit log, SLA overview and proposal approval/rejection endpoints.

Agent: `/api/agent/analyze`, `/find-related`, `/check-sla`, `/recommend-actions`, `/escalation-proposals`. Full API descriptions are served at `/api/docs`.

## Checks

```sh
npm test
npm run build
```

The automated Node tests cover Ollama tool-calling and fallback, synthetic cross-bureau matching, SLA calculations, tool authorization and safe public data structure. MySQL persistence requires a running MySQL server. Complaint document upload, production identity management and email delivery remain extension points; no external communications are enabled in this MVP.

## Local Ollama agent (optional)

The server uses the official `ollama` JavaScript package. No Ollama service, API key, paid provider, or model download is required to run the app: if the model cannot be reached, is not installed, or times out, the agent records the reason and runs the existing deterministic tools instead. The app never pulls a model during startup.

1. Install Ollama for Windows from [ollama.com/download](https://ollama.com/download) and start the Ollama app. It serves its local API at `http://127.0.0.1:11434` by default. Verify it with `ollama --version` and `Invoke-RestMethod http://127.0.0.1:11434/api/tags`.
2. Pull the model manually in PowerShell (this downloads model files):

   ```powershell
   ollama pull llama3.2:latest
   ollama run llama3.2:latest
   ```

   The `ollama run` command opens an interactive model session. Exit it with `/bye`; the Ollama app/service remains running in the background.
3. Configure `server/.env` (copy the root `.env.example` or `server/.env.example`):

   ```dotenv
   OLLAMA_BASE_URL=http://127.0.0.1:11434
   OLLAMA_MODEL=llama3.2:latest
   OLLAMA_TIMEOUT_MS=20000
   AGENT_MAX_TOOL_CALLS=6
   AGENT_MAX_ITERATIONS=3
   ```

   The base URL, model, timeout, and bounded execution limits are read by the Node backend. Never put these settings in a Vite `VITE_*` variable. `GET /api/agent/ollama/status` reports model availability to authenticated officers without exposing the configured URL or environment.
4. Start the existing project with `npm run dev`, sign in to `/admin`, open **AI command center**, and choose **Analyze complaint**. The run shows the provider/model, real tool results, fallback reason if applicable, matches and SLA evidence. An officer can also open a complaint and choose **Analyze with AI**.

### Agent workflow, safeguards, and tests

The Node agent retrieves the complaint through the authorized `getComplaintDetails` tool, then provides Ollama only a redacted, bounded record. Complaint content is explicitly treated as untrusted evidence. Ollama can request only the eight registered tools; tool arguments are parsed by Zod, authorization/bureau scope is checked server-side, execution is capped at six tool calls and configured reasoning iterations, and each result/error is persisted to the run timeline. The model cannot run SQL, shell commands, arbitrary code or network calls. The server validates the final JSON response and its classification/bureau values. Related cases and SLA findings always come from actual server services rather than model-generated records or policy.

When Ollama is missing/unreachable, the requested model is not installed, the call times out, or the response is invalid, `fallbackUsed` is true, `provider` is `deterministic-rules`, and the run contains the specific fallback reason plus deterministic classification, matching, SLA, and action tools where the call budget permits. Confidence is qualitative (`low`, `medium`, `high`), not a calibrated probability. Rule SLA thresholds are configurable demonstration examples, not official AICTE policy.

Escalation proposals remain pending until reviewed through the existing human approval workflow. A model request to link cases is rejected; an explicit admin action through `POST /api/admin/related-cases/link` is required for case linking. The agent never approves a proposal, transfers or closes a case, links cases, or sends external messages.

Automated tests mock Ollama; they do not require Ollama or a model download:

```powershell
npm --prefix server test
npm run build
```

### Troubleshooting

- **Connection refused / port 11434:** make sure the Ollama Windows app is running. Check `Invoke-RestMethod http://127.0.0.1:11434/api/tags`; adjust `OLLAMA_BASE_URL` only if you intentionally configured another local endpoint.
- **Configured model missing:** run `ollama list`. If `llama3.2:latest` is not listed, pull it manually with `ollama pull llama3.2:latest`. The application does not download it for you.
- **Timeout / slow first response:** first model initialization can take longer. Increase `OLLAMA_TIMEOUT_MS` in `server/.env` and restart the server. A timeout still completes through deterministic fallback.
- **No Ollama status in the dashboard:** sign in with an admin/officer account and verify the backend at `http://localhost:4000/api/health`; the status endpoint requires the JWT session.

## Important policy note

All SLA thresholds in the demo are configurable examples and are not official AICTE policy. Demo institutions and complaints are fictional and synthetic.
