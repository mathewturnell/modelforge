# Security

Report suspected vulnerabilities privately to `hello@modality.systems`. Do not
open a public issue with credentials, private paths, datasets, model artifacts,
or exploit details.

The public alpha is for trusted local development. The server binds loopback,
uses a per-launch bearer token, rejects cross-origin mutations, and serves only
scope-checked registered artifacts. It is not designed for LAN/Internet
exposure, multi-user hosting, or production service.

The compiled React workbench is an untrusted presentation client. The URL
fragment token is removed into page session storage and sent only in the
`Authorization` header. Project content cannot provide JavaScript, HTML, CSS,
routes, or React components to the trusted shell. Authenticated media and
artifacts are fetched into page-owned `blob:` URLs, which must be revoked when
they are replaced or the project changes. Browser-visible responses must not
contain storage locations, credential values, private prompts, or held-out
evaluation evidence.

Project code is not sandboxed. A process launched by ModelForge can use the
files, network, devices, and credentials available to the operating-system user.
Review project code and environment grants before execution. The bundled local
example sets no network requirement and performs no download.

Source editing, Git mutation, annotation mutation, training, and Coding
Assistant controls remain disabled until their server-owned capability and
authorization checks are implemented. When enabled, each must be scoped to the
exact registered project, reject traversal and symlink escapes, record durable
truth before external work, and expose an explicit confirmation boundary for
destructive, networked, credentialed, or billable operations. The Coding
Assistant must receive a filtered environment and cannot receive credentials,
held-out evidence, commercial authority, or unrestricted command execution.

Do not place secrets in project manifests, source files, browser-visible
configuration, CLI arguments, logs, or agent conversations. The optional Modal
adapter delegates credential discovery to the Modal SDK and never returns token
values through the CLI or browser. Prefer a dedicated non-production Modal
environment and review the fixed function before deploying it. Provider
deployment and execution are networked, may be billable, and are not sandboxed
by ModelForge. See [docs/modal.md](docs/modal.md).
