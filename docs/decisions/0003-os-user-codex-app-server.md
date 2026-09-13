# Decision 0003: OS-user Codex account through Codex App Server

- Date: 2026-09-13
- Owner: Mathew Turnell
- Status: accepted for the read-only public-alpha slice
- Affected requirements: `PUB-ARCH-002`, `PUB-AGENT-001`, `PUB-SET-001`,
  `PUB-UI-004`, `PUB-LIC-001`, and `PUB-REL-001`

## Context

The recovered React panel was connected to a deterministic keyword responder
and presented under the former personal name. That made the panel look like an
agent while making no model call, did not use the user's Codex account, and did
not match the established ModelForge Coding Assistant product contract.

The public service architecture already has a project-scoped assistant port,
durable sessions, asynchronous run projection, cancellation, and a Settings
surface. The missing boundary is an actual provider driver and provider-owned
account connection. The private/commercial provider implementation and its
history are not permissible public release inputs.

## Decision

ModelForge implements a clean Apache-2.0 Codex provider adapter against the
documented Codex App Server JSON-lines protocol. The authenticated loopback
workbench remains the only browser authority:

```text
React Settings / Coding Assistant
              |
 authenticated loopback API
              |
 project-scoped assistant service
              |
 local Codex App Server ---- OS-user Codex / ChatGPT authentication
```

Settings reads `account/read` and starts ChatGPT authentication with
`account/login/start`. Codex owns the browser callback, token refresh, and
credential storage. ModelForge returns only bounded account type, email, plan,
connection state, login identity, and HTTPS authorization URL; it never reads,
copies, stores, logs, exports, or sends the credential to project code.

Assistant turns use `thread/start` or `thread/resume`, `turn/start`, streamed
notifications, `turn/completed`, and `turn/interrupt`. ModelForge retains its
own project/session/request/run identities and stores only normalized public
events and the terminal answer. Raw provider objects, private reasoning,
credentials, unrelated absolute paths, and command output are not public
history.

The initial public provider slice is fixed to the exact registered project,
Codex `read-only` sandbox, and `never` approval policy. Connecting an account
does not grant file writes, Git, network escalation, paid compute, publication,
deployment, or any registered action. A provider request for authority outside
that slice fails closed. Write-capable agent operation requires the separately
specified host-owned confinement, base inventory/conflict checks, approvals,
and action gateway; this decision does not claim those gates.

Every human-facing surface uses **ModelForge Coding Assistant** and identifies
Codex as the connected provider. Lowercase `cliff` remains only in frozen
internal v1 compatibility symbols, route names, CSS selectors, and storage
keys. No deterministic or canned response is used as a fallback: missing
Codex, sign-out, protocol errors, provider exit, timeout, and cancellation are
explicit states.

## Source and dependency boundary

The adapter is newly authored public source. It does not copy the private
provider implementation. Codex is an optional external OS-user tool and is not
bundled in the Python wheel or source archive. Base installation and all ML
workflows remain usable when Codex is absent or signed out.

## Verification

Qualification requires deterministic App Server protocol fixtures for account
status, login, streamed completion, idempotency, durable history, cancellation,
provider failure, path/credential redaction, and loopback mutation security;
React unit/build checks; compiled desktop and 390-pixel Settings/chat journeys;
and the complete packaging, inventory, license, secret, and history gates.

Live account status may be checked without starting a model turn. A real model
turn is not part of this increment because the existing publication authority
explicitly excludes additional paid workloads.

## References

- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
