# Synthetic Threshold Lab

This bundled, deterministic example classifies four authored numeric samples
against a fixed threshold. It exists to exercise ModelForge project inspection,
durable local run state, validated results, digest-bound artifacts, and restart
recovery without a model download, GPU, provider, or network connection.

The same fixed computation can optionally run in a deliberately small Modal
CPU function while keeping ModelForge's existing durable Run/Artifact lifecycle.
That path requires the `modal` extra, an explicitly deployed app/environment,
and billable-action confirmation. It uploads no dataset and downloads no model.
See [`docs/modal.md`](../../docs/modal.md) for the security, cost, cancellation,
recovery, and cleanup boundary.

The example is synthetic. It demonstrates workbench mechanics, not model quality.
The source is Apache-2.0 and `samples.json` is dedicated to the public domain
under CC0-1.0.
