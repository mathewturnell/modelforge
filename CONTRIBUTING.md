# Contributing

Use CPython 3.12 on Linux and create an isolated environment:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-ci.txt
.venv/bin/python -m pip install -e .
.venv/bin/python -m pytest
.venv/bin/ruff check src tests scripts
npm ci
npm run test:browser
```

Keep project-specific algorithms, datasets, metrics, models, recipes, and UI in
the project. Core changes need a real reusable consumer and tests at the
contract/application boundary. Preserve project, run, artifact, credential,
held-out evaluation, and local/provider boundaries.

Do not commit secrets, personal/customer data, datasets, weights, checkpoints,
generated outputs, or third-party assets without exact provenance and
redistribution evidence. Security reports follow [SECURITY.md](SECURITY.md).

Contributors retain copyright in their contributions. Unless you explicitly
state otherwise, a contribution intentionally submitted for inclusion is
licensed under Apache-2.0 section 5. ModelForge requires no contributor licence
agreement, copyright assignment, company-exclusive licence, or separate
commercial agreement. The maintainer may require provenance clarification
before accepting a change, and third-party or derived material must retain its
applicable upstream terms and notices.

The ModelForge name identifies this upstream project. Truthful attribution and
references to compatibility are welcome; forks and derived projects should not
imply upstream endorsement. This guidance makes no claim of trademark
registration or clearance.

Browser journeys start the real loopback backend with disposable state and
redistributable fixtures. They use installed Chrome and do not need a GPU,
external model, private project, provider credential, or network call. Failed
CI runs retain bounded Playwright traces, screenshots, and server logs. See
[docs/ux-qualification.md](docs/ux-qualification.md) for automated and manual
coverage limits.

Before publication, protect the default branch with these GitHub check names:

- `public-alpha / test-build`
- `public-alpha / browser-journeys`
- `public-alpha / secret-scan`
- `public-alpha / release-gate`

The aggregate release gate depends on the other three. This repository defines
CI qualification only; it contains no deployment or package-publication job.
