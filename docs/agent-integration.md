# Agent integration

ModelForge does not embed an agent in this alpha. A coding agent edits the
project repository and integrates it into the same visible services used by a
human.

1. Keep models, dataset decoding, metric meaning, and task semantics in the
   project.
2. Implement one shell-free local `inference_process` or `prompt_process` that
   accepts explicit paths and writes its typed result under the supplied output
   allocation.
3. Author a portable `project.json` in the project repository. Copy the
   applicable installed `project.local.template.json` to a private location,
   set `project_repository` to that exact folder, and bind an existing interpreter, adapter, dataset/model/checkpoint,
   exact identities, and bounded parameters. Never commit that host config.
4. Register it with `modelforge project register --state-root STATE --config
   PRIVATE_CONFIG` and inspect the redacted projection with `modelforge project
   list --state-root STATE`.
5. Start through the workbench or `modelforge action run`; do not build another
   project-owned run database, artifact server, or bespoke status UI.

For static authored manifests, use:

```bash
modelforge project capabilities --manifest /path/to/project/project.json
```

That operation imports no project code and grants no runtime, credential,
provider, or execution authority.

Authored capability inspection and owner runtime readiness are separate facts;
neither grants execution authority. The shared lifecycle creates durable queued truth before action binding, writes
private request data below the run allocation, starts the declared interpreter
without a shell or ambient `PYTHONPATH`, validates the action-specific result,
checks correlated artifacts, applies a host-owned deadline, and commits terminal truth. UI and CLI are projections; they
do not own processes or results. BDD100K and Qwen demonstrate the same lifecycle
with video and text respectively. The public fixture tests exercise both shapes
without private paths, models, GPU, network, or provider accounts.

Do not add project-ID conditionals to shared services or static UI. If a new
action/result shape cannot be represented, propose a bounded versioned contract
with a real consumer and fallback before adding a new core branch.

Project code is trusted local code. ModelForge allocates outputs and redirects
common caches, but it is not a sandbox. An agent must disclose commands,
network use, credentials, downloads, and cost-bearing execution before asking a
human to authorize them.
