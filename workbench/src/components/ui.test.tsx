import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {ProgressBar} from "./ui";

describe("progress bar", () => {
  it("reports a measured percentage when telemetry is available", () => {
    const html = renderToStaticMarkup(<ProgressBar value={42.4} label="Cloud inference running" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('width:42.4%');
  });

  it("announces staging without inventing an upload percentage", () => {
    const html = renderToStaticMarkup(<ProgressBar indeterminate label="Loading inference data to Modal" />);
    expect(html).toContain("is-indeterminate");
    expect(html).toContain('aria-valuetext="Loading inference data to Modal"');
    expect(html).not.toContain("aria-valuenow");
  });
});
