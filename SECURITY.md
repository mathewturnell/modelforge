# Security

Report suspected vulnerabilities privately to `hello@modality.systems`. Do not
open a public issue with credentials, private paths, datasets, model artifacts,
or exploit details.

The public alpha is for trusted local development. The server binds loopback,
uses a per-launch bearer token, rejects cross-origin mutations, and serves only
scope-checked registered artifacts. It is not designed for LAN/Internet
exposure, multi-user hosting, or production service.

Project code is not sandboxed. A process launched by ModelForge can use the
files, network, devices, and credentials available to the operating-system user.
Review project code and environment grants before execution. The bundled local
example sets no network requirement and performs no download.

Do not place secrets in project manifests, source files, browser-visible
configuration, CLI arguments, logs, or agent conversations. The optional Modal
adapter delegates credential discovery to the Modal SDK and never returns token
values through the CLI or browser. Prefer a dedicated non-production Modal
environment and review the fixed function before deploying it. Provider
deployment and execution are networked, may be billable, and are not sandboxed
by ModelForge. See [docs/modal.md](docs/modal.md).
