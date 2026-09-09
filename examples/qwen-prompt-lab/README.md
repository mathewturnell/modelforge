# Qwen2.5-7B Prompt Lab

This prompt-only integration consumes `modelforge.prompt-request/v1` and writes
`modelforge.prompt-result/v1`. It deliberately has no dataset or training action.

## 1. Obtain the model

```bash
modelforge examples setup plan --example qwen-prompt-lab --external-root /srv/modelforge-examples
```

Acquire exact Hugging Face revision
`a09a35458c702b33eeacc393d103063234e8bc28` with official tooling after
reviewing its terms, then bind the existing snapshot. ModelForge does not
authenticate or download roughly 15.2 GiB of weights:

```bash
modelforge examples setup fetch --example qwen-prompt-lab --external-root /srv/modelforge-examples \
  --use qwen-model=/models/Qwen2.5-7B-Instruct/snapshots/a09a35458c702b33eeacc393d103063234e8bc28 --confirm
```

The exact revision-directory check is weaker than a full snapshot digest;
verify the upstream revision and cache contents before registration.

## 2. Configure an isolated environment

```bash
modelforge examples setup install --example qwen-prompt-lab --external-root /srv/modelforge-examples --confirm
modelforge examples setup install --example qwen-prompt-lab --external-root /srv/modelforge-examples --confirm --install-requirements
```

The second command explicitly installs the reviewed direct version pins into
that venv. They are not a hash-locked transitive closure and package-index
network access may occur. No model code or workload is run during setup.

## 3. Open the project

Copy `project.local.template.json` outside the distribution and set its external
model snapshot and venv interpreter. Register and open the workbench:

```bash
modelforge project register --state-root /tmp/modelforge-state --config /secure/qwen.local.json
modelforge serve --state-root /tmp/modelforge-state
```

## 4. Run the supported workflow

Submit bounded system/user messages and generation settings through Prompt Lab,
or use `modelforge action run` with `request.example.json`. The adapter forces
offline, local-files-only model loading. A bounded real prompt completed with
the exact pinned snapshot and declared CPU environment; fixture checks cover
start, cancellation, failure, and recovery without shipping the weights.
The same pinned snapshot also completed through one owner-bound Modal L40S
deployment. A separate compiled-workbench request received confirmed provider
cancellation, and another recovered the same provider call after local server
restart.

## 5. Logs and results

Bounded process logs, assistant-only results, timing/provenance, and checked
artifacts live under the owner-only state root. Raw prompts remain private run
input and are never release assets.

## 6. Limits and terms

CPU execution is supported but slow; a compatible CUDA host is practical. The
model cache is external and subject to the exact upstream model-card/license
terms in `setup.json`. This example makes no model-quality claim.
