import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {CliffMarkdown} from "./CliffMarkdown";

describe("Cliff Markdown presentation", () => {
  it("renders provider Markdown instead of exposing its formatting tokens", () => {
    const html = renderToStaticMarkup(<CliffMarkdown source={`### What the verified result shows

**Observed**

- Checkpoint is **eligible**.
- IDF1: \`0.5803\`

***

Run 2 registered the existing overlay.`} />);

    expect(html).toContain("<h4>What the verified result shows</h4>");
    expect(html).toContain("<strong>Observed</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<code>0.5803</code>");
    expect(html).toContain("<hr/>");
    expect(html).not.toContain("###");
    expect(html).not.toContain("**Observed**");
  });

  it("escapes text and permits only explicit HTTPS links", () => {
    const html = renderToStaticMarkup(<CliffMarkdown source={'<script>alert(1)</script> [evidence](https://example.com/result) [unsafe](javascript:alert(1))'} />);

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('href="https://example.com/result"');
    expect(html).toContain("[unsafe](javascript:alert(1))");
  });

  it("renders README images only through the caller's trusted resolver", () => {
    const html = renderToStaticMarkup(<CliffMarkdown
      source={'![Architecture](docs/architecture.png) ![Blocked](https://tracker.example/pixel.png)'}
      resolveImage={(source) => source.startsWith("docs/") ? `/api/readme-image?path=${source}` : ""}
    />);

    expect(html).toContain('src="/api/readme-image?path=docs/architecture.png"');
    expect(html).toContain('alt="Architecture"');
    expect(html).not.toContain("tracker.example");
  });
});
