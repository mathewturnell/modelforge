# Browser journey and UX qualification

## React recovery gate

The compiled React recovery is not qualified merely because the prior static
candidate or the commercial donor UI passed tests. Release evidence must run
against the exact built public client and packaged Python server in this clean
repository. The gate requires:

- the real project, sample/prompt, run, cancellation, recovery, artifact, and
  Modal-status journeys through the public `/api/v1` client;
- capability-derived navigation for the full local product definition, with
  every incomplete service labelled unavailable and no inert or fabricated
  success control;
- token fragment removal, bearer-only API access, stale-response rejection,
  project-switch invalidation, and object-URL revocation;
- no commercial identity, tenancy, billing, hosted-workbench, deployment, or
  publication control;
- keyboard operation, visible focus, meaningful landmarks and live regions,
  text-not-colour status, reduced motion, Axe, and accessibility-tree checks;
- reviewed desktop, 390-pixel, and effective 320-pixel/200%-zoom reflow with
  no page-wide horizontal overflow;
- zero unexpected browser console errors and zero non-loopback requests.

The current implementation and evidence status is recorded in
[`requirements.md`](requirements.md). Native browser 200% zoom and an end-user
screen-reader session remain human checks and must not be inferred from narrow
viewport, Axe, or accessibility-tree automation.

Against the local recovery candidate on 2026-09-10, nine React unit/contract
tests, TypeScript checking, the production build, and thirteen real loopback
browser journeys passed. The browser suite covers empty state, full intended
navigation, truthful unavailable destinations, vision and prompt execution,
failure, invalid output, cancellation, reload, server restart, checked
artifacts, process logs, Modal status variants, request failure, Axe, and the
Chrome accessibility tree. Production npm dependencies and the full npm
development graph reported zero known vulnerabilities after updating Vitest
to 4.1.11. The new 1280-pixel and 390-pixel baselines were reviewed locally;
their CI variants are generated from the same React candidate and remain
subject to review when rendering changes.

## Previous clean-candidate evidence

The previous public-alpha browser gate ran the built package with its real loopback
server, shared services, local executor, disposable state, and redistributable
fixtures. Playwright uses its version-locked Chromium build, one worker, no
retries, accessible selectors, and bounded observable waits. External provider
behavior is mocked only at the provider-status boundary; ordinary CI has no
credentials, GPU, private assets, model download, paid execution, or runtime
network dependency.

| Journey | Automated evidence |
| --- | --- |
| First use | Empty/welcome state, explicit plan/fetch/install/register sequence, no-implicit-download copy, default Modal readiness, navigation, and no unexpected browser errors or non-loopback request. |
| External setup | Four real-project prerequisite disclosures, TasteMatch fixture-qualified dataset inspection, owner-controlled upstream acquisition, and a read-only-plan boundary. |
| Project setup | Supported projects, authored capabilities, missing runtime readiness, safe project switching, and no stale result from the prior project. |
| Vision dataset | Redistributable sample selection and authenticated preview through the real backend. |
| Local action | Durable-before-process start, progress, bounded logs, truthful completion, and shared local executor. |
| Results and recovery | Telemetry availability, checked artifacts, open/download paths, reload, service restart, and same completed run recovery. |
| Failure and cancellation | Actionable launch failure, invalid result, cancellation request, terminal cancellation, and no stale success indicator. |
| Prompt interaction | Authored prompt fixture, labelled bounded form, completed text result, and no model-quality claim. A separate bounded real Qwen prompt used the same compiled interface and shared services. |
| Modal setup | Discoverable tutorial plus unconfigured, configured, error, live success, provider-confirmed cancellation, and same-call recovery projections. Ordinary CI makes no provider call. |
| UX/accessibility | Desktop and 390-pixel layouts, no page-wide horizontal overflow, keyboard reachability, visible focus, form labels, landmarks, automated axe checks, and Chrome accessibility-tree exposure of setup order, qualification, navigation, and the primary action. |

Two stable first-use baselines—desktop and 390 pixels—were regenerated for the
explicit external-setup flow and manually reviewed. GitHub Actions keeps a
separate reviewed Ubuntu 24.04 pair because its installed font metrics differ
from the qualified workstation; both environments use the same locked Chromium
renderer and strict pixel comparison. At desktop width, the setup sequence
reads before qualification and workbench actions; at 390 pixels, commands wrap
within the card, status pairs become a single readable column, and the
workbench remains keyboard-operable without page-wide horizontal overflow.
Visual comparison supplements behavioral assertions; it does not replace them
and baseline changes must be reviewed rather than accepted automatically.
Those images qualify the previous client only and cannot be reused as passing
visual evidence for the React recovery.

The Chrome accessibility tree was inspected directly and exposes the ordered
setup instructions, qualification region, project navigation, run evidence,
and primary action. Axe reports no serious or critical violation in the tested
first-use, prompt, and responsive states. This is screen-reader-oriented
semantic evidence, not an end-user screen-reader usability session. Orca 50.2
is installed on the host, but no isolated speech-output capture and navigation
harness is available; starting it in the user's active Wayland desktop would
alter that interactive session without producing independently verifiable
speech evidence, so it was not used as passing evidence.

A headed Google Chrome 150 native-zoom attempt sent five browser zoom-in
shortcuts. Playwright delivered them to the document rather than Chrome's
browser chrome: `devicePixelRatio` remained 1 and `innerWidth` remained 1280,
so the attempt did not establish 200% zoom and was not converted into a passing
emulation claim. The automated 390-pixel reflow check is stronger narrow-layout
evidence but is not labelled native zoom. A human-controlled native 200% zoom
session therefore remains an unverified alpha check. The only available GUI during final
qualification was the user's active GNOME Wayland desktop with an existing
Chrome session; no isolated compositor or OS-level input tool was available,
so taking control of browser chrome or enabling Orca would have disrupted that
session without independently verifiable speech output. Dialog focus is not
applicable because this UI has no dialogs. Real-model quality and hosted GitHub
Actions also remain unverified by this suite. Separate bounded live acceptance
covered the four fixed Modal project actions, but does not extend to other
accounts, regions, revisions, inputs, performance, or provider availability.

The following human checks were accepted as unverified alpha limitations for
repository publication. They remain useful post-publication qualification work
and must not be represented as passed until a human records the session:

1. Open the tokenized workbench in a fresh Chrome profile, choose native 200%
   zoom from browser chrome, and confirm project navigation, dataset/prompt
   forms, primary/cancel actions, status, logs, checked artifacts, and both
   result previews remain usable without page-wide horizontal scrolling.
2. Reset zoom to 100%, enable Orca, and traverse by landmarks/headings and
   Tab/Shift+Tab. Confirm the skip link, setup order, project selected state,
   form labels, run status/progress, failure/cancellation, disconnected/stale
   state, logs, artifacts, and recovered results are announced meaningfully and
   are not conveyed by colour alone. Then disable Orca and restore the profile.

Run locally with:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

On failure, CI retains the HTML report, traces, screenshots, video, JUnit, and
bounded server logs for seven days. Those artifacts use only disposable public
fixtures and must never include credentials or user-owned project inputs.
