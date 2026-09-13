# ModelForge compiled workbench

This directory owns the trusted React/TypeScript browser shell described by
`doc/workbench-ui-ux.md` and ADR 0023. Project repositories provide bounded
descriptor and media data only; they do not provide executable UI modules.

Build the packaged assets with:

```console
npm ci
npm run build
```

The build is written to `../static/workbench/` and is served by the existing
ModelForge Python server. Use `npm run typecheck` for the typed contract check.
The production build uses `/workbench/` asset URLs and is the sole local
workbench client. Historical `/legacy` bookmarks redirect to `/workbench`.
