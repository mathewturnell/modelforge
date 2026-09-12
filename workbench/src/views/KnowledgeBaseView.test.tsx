import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {filterKnowledgeArticles, KnowledgeBaseView} from "./KnowledgeBaseView";

describe("knowledge base", () => {
  it("renders trusted ModelForge documentation and navigation", () => {
    const html = renderToStaticMarkup(<KnowledgeBaseView />);
    expect(html).toContain("Knowledge Base");
    expect(html).toContain("How-to guides");
    expect(html).toContain("API reference");
    expect(html).toContain("What is ModelForge?");
    expect(html).toContain("Local first, cloud when chosen");
    expect(html).not.toContain("<script");
  });

  it("finds guides by title, description, section, and tags", () => {
    expect(filterKnowledgeArticles("checkpoint").map((article) => article.id)).toContain("provenance");
    expect(filterKnowledgeArticles("quickstart").map((article) => article.id)).toEqual(["first-project"]);
    expect(filterKnowledgeArticles("API reference")).toHaveLength(2);
    expect(filterKnowledgeArticles("unrelated phrase")).toEqual([]);
  });
});
