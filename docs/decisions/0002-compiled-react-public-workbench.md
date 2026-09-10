# Decision 0002: Compiled React public workbench on the service architecture

- Date: 2026-09-10
- Owner: Mathew Turnell
- Status: accepted for local implementation; publication pending exact-candidate approval
- Affected requirements: `PUB-ARCH-001`, `PUB-UI-001`–`PUB-UI-004`,
  `PUB-LIC-001`, `PUB-REL-001`, and the feature requirements recorded in
  `docs/requirements.md`

## Context

The first public candidate proved a clean Apache-2.0 Project → Run → Executor /
Handler → Artifact architecture, but replaced the mature React product with a
small static client and reduced the product definition to match it. A later
attempt to restore the user experience copied an entire commercially classified
development tree over the public repository. That restored presentation and
unrelated product code together, crossed the licensing boundary, and made the
commercial tree part of the repository history.

The intended alpha is neither of those trees. It is the public service
architecture with the mature local React experience adapted to its explicit
ports and security boundaries.

## Decision

The clean public candidate rooted at `fe1ccd4e` and qualified at `add2892b` is
the sole architecture and history baseline. Its application services remain
authoritative for project registration, owner-only runtime configuration,
dataset access, durable runs, bounded execution, result validation, checked
artifacts, cancellation, and recovery.

ModelForge adopts a compiled React and TypeScript client as the sole target
workbench. React is a presentation adapter. It receives typed, redacted
projections through additive `/api/v1` routes and never becomes an authority
for filesystem paths, project code, Git, credentials, execution, lifecycle
truth, artifacts, evaluation, or assistant actions.

The target local product includes project and source workflows, datasets and
local annotation, architecture/model inspection, local training and run
comparison, inference and jobs, local settings, and the local ModelForge Coding
Assistant/Codex setup. A visible action is enabled only when a real public
service and capability authorize it. An incomplete service is presented with
an explicit reason and remains a tracked implementation gap; it is not removed
from the product definition and is not represented as shipped.

Commercial identity, membership, billing, customer tenancy, hosted workbench,
commercial-plane services, Cloudflare publication, desktop updating, and
general provider control are outside this public source boundary.

## Service and security rules

- `project.json` remains import-free, project-owned, and non-authorizing.
- Runtime configuration, provider bindings, and credentials remain separate
  owner-only state and are never returned to the browser.
- Every mutation is same-origin, bearer-authenticated, project-scoped, and
  capability-authorized by the server.
- A durable queued run exists before any process or provider operation starts.
- Terminal success and its checked artifact identities commit atomically.
- Tokens never enter request URLs. Authenticated media is fetched into
  page-owned `blob:` URLs and revoked on replacement or project change.
- The server retains loopback binding, Host validation, mutation-Origin checks,
  CORS denial, restrictive CSP, bounded bodies, range validation, redaction,
  and safe error projection.
- Project content cannot supply JavaScript, HTML, CSS, routes, React
  components, or commands to the trusted shell.
- Held-out evaluation evidence cannot enter iterative training, inference
  selection, or Coding Assistant context.

## Source and licensing boundary

No commercial repository history or backend subtree is an implementation
input. React source may be adapted file-by-file from the identified donor
revision only when its origin, modifications, third-party dependencies, and
proposed Apache-2.0 treatment appear in the exact source inventory. The root
license, package metadata, source manifest, npm notices, source archives, and
built distributions must agree.

The publishable repository must use a clean standalone Git object store. A
branch in the contaminated repository is not publishable merely because its
tip tree looks correct: commercial commits and pull-request refs may remain
reachable.

## Alternatives

- Restore the small static candidate unchanged: rejected because it repeats the
  product and UX reduction the owner rejected.
- Copy the commercial product tree and change `LICENSE`: rejected because it
  crosses architecture and licensing boundaries and mislabels unrelated code.
- Keep a static and React client indefinitely: rejected because two product
  surfaces obscure the supported behavior and double the security/test paths.
- Fabricate compatibility responses for unsupported React views: rejected
  because appearance is not implementation evidence.

## Migration and rollback

Development occurs only in a clean standalone repository derived from the
public candidate. The static client remains a temporary rollback adapter until
the real packaged React journeys pass. Retirement then happens in the same
reviewed change that makes the compiled client the root route. Release rollback
selects the last qualified clean Apache candidate; it never restores the
commercial repository or exposes a second browser authority.

## Verification and approval

The required evidence is defined by `docs/requirements.md`. It includes typed
client tests, Python service/route tests, real packaged loopback journeys,
security negatives, accessibility/responsive checks, build reproducibility,
wheel/sdist inspection, source and dependency provenance, exact inventory
reconciliation, secret/history scans, and an independent release-readiness
review.

Only Mathew may approve the exact React Apache disposition, any write-capable
assistant or Git exposure, remote reconstruction, merge, release, or
publication. This decision authorizes local implementation and verification;
it does not authorize a remote change or publication.
