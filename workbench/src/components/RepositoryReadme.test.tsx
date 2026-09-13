import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {normalizeReadmeMarkdown, RepositoryReadme, splitReadmeFrontMatter} from "./RepositoryReadme";

const datasetCard = `---
language:
- en
license: mit
size_categories:
- 100K<n<1M
task_categories:
- text-generation
pretty_name: UltraChat 200k
configs:
- config_name: default
  data_files:
  - split: train_sft
    path: data/train_sft-*
---
# Dataset card

Readable project copy.`;

describe("repository README presentation", () => {
  it("separates Hugging Face YAML front matter from the readable card body", () => {
    const parsed = splitReadmeFrontMatter(datasetCard);
    expect(parsed.body).toContain("# Dataset card");
    expect(parsed.fields).toEqual([
      {label: "Name", values: ["UltraChat 200k"]},
      {label: "Language", values: ["en"]},
      {label: "License", values: ["mit"]},
      {label: "Size", values: ["100K<n<1M"]},
      {label: "Tasks", values: ["text-generation"]},
    ]);

    const html = renderToStaticMarkup(<RepositoryReadme source={datasetCard} path="README.md" dataset />);
    expect(html).toContain("Dataset card metadata");
    expect(html).toContain("View raw YAML");
    expect(html).toContain("<h2>Dataset card</h2>");
    expect(html).not.toContain("<p>language:");
  });

  it("leaves ordinary repository Markdown unchanged", () => {
    const html = renderToStaticMarkup(<RepositoryReadme source={"# Project\n\nDescription"} path="README.md" />);
    expect(html).toContain("<h2>Project</h2>");
    expect(html).not.toContain("Dataset card metadata");
  });

  it("removes GitHub README HTML instead of exposing it as unformatted markup", () => {
    const source = `<!--- Copyright 2020 The HuggingFace Team. All rights reserved. -->

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="https://example.test/dark.svg"><img alt="Transformers" src="https://example.test/logo.svg"></picture><br/><br/></p>

<p align="center"><a href="https://example.test"><img alt="Build" src="https://example.test/build.svg"></a></p>

<h4 align="center"><p><b>English</b> | <a href="https://example.test/fr">Français</a></p></h4>

<h3 align="center"><p>State-of-the-art pretrained models for inference and training</p></h3>

\`\`\`html
<p>This is an intentional code example.</p>
\`\`\``;

    const normalized = normalizeReadmeMarkdown(source);
    expect(normalized).toContain("English | Français");
    expect(normalized).toContain("State-of-the-art pretrained models for inference and training");
    expect(normalized).toContain("<p>This is an intentional code example.</p>");
    expect(normalized).not.toContain("Copyright 2020");
    expect(normalized).not.toContain("<picture>");
    expect(normalized).not.toContain("example.test/logo.svg");

    const html = renderToStaticMarkup(<RepositoryReadme source={source} path="README.md" />);
    expect(html).toContain("English | Français");
    expect(html).toContain("State-of-the-art pretrained models for inference and training");
    expect(html).toContain("&lt;p&gt;This is an intentional code example.&lt;/p&gt;");
    expect(html).not.toContain("&lt;picture&gt;");
    expect(html).not.toContain("Copyright 2020");
    expect(html).not.toContain("example.test");
  });

  it("applies the same HTML filtering to Hugging Face dataset cards", () => {
    const source = `---
language: en
license: apache-2.0
---
<div class="banner"><img src="https://example.test/banner.svg"></div>

# Dataset card

<p>Readable <strong>dataset description</strong>.</p>`;
    const html = renderToStaticMarkup(<RepositoryReadme source={source} path="README.md" dataset />);

    expect(html).toContain("Dataset card metadata");
    expect(html).toContain("<h2>Dataset card</h2>");
    expect(html).toContain("Readable dataset description.");
    expect(html).not.toContain("&lt;div");
    expect(html).not.toContain("example.test");
  });
});
