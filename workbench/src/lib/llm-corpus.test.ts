import {describe, expect, it} from "vitest";
import {corpusSplitFromPath, isLlmCorpusProject, parseCorpusPreview} from "./llm-corpus";

describe("LLM corpus projection", () => {
  it("derives conventional splits without treating validation as training", () => {
    expect(corpusSplitFromPath("data/train.jsonl")).toBe("train");
    expect(corpusSplitFromPath("exports/validation.jsonl")).toBe("validation");
    expect(corpusSplitFromPath("frozen-test.jsonl")).toBe("held_out");
    expect(corpusSplitFromPath("corpus.jsonl")).toBe("unassigned");
  });

  it("projects ordered messages and structured prompt-target records", () => {
    const preview = parseCorpusPreview("train.jsonl", [
      JSON.stringify({id: "chat-1", messages: [{role: "user", content: "Hello"}, {role: "assistant", content: "Hi"}]}),
      JSON.stringify({exampleId: "pair-2", input: {question: "Why?"}, target: {answer: "Because."}}),
    ].join("\n"));
    expect(preview.records).toHaveLength(2);
    expect(preview.records[0]).toMatchObject({id: "chat-1", input: "Hello", output: "Hi", messages: 2, split: "train"});
    expect(preview.records[1].id).toBe("pair-2");
    expect(preview.records[1].input).toContain("question");
    expect(preview.records[1].output).toContain("answer");
  });

  it("drops a partial final JSONL record when the bounded preview is truncated", () => {
    const preview = parseCorpusPreview("validation.jsonl", '{"id":"complete","prompt":"A"}\n{"id":', true);
    expect(preview.records.map((record) => record.id)).toEqual(["complete"]);
    expect(preview.parseErrors).toBe(0);
    expect(preview.truncated).toBe(true);
  });

  it("projects bounded CSV prompt and lyric rows with quoted newlines", () => {
    const preview = parseCorpusPreview("train.csv", [
      "song_title,lyrics,prompt,text",
      '"Night Train","line one\nline ""two""","rain, trains",unused',
      '"New Day","third line",sunrise,unused',
    ].join("\r\n"));

    expect(preview.format).toBe("csv");
    expect(preview.parseErrors).toBe(0);
    expect(preview.records).toHaveLength(2);
    expect(preview.records[0]).toMatchObject({
      split: "train", input: "rain, trains", output: 'line one\nline "two"',
    });
    expect(preview.records[0].fields).toEqual(["lyrics", "prompt", "song_title", "text"]);
  });

  it("drops a partial quoted CSV row when the bounded preview is truncated", () => {
    const preview = parseCorpusPreview(
      "test.csv",
      'prompt,lyrics\ncomplete,answer\npartial,"unterminated',
      true,
    );

    expect(preview.records.map((record) => record.input)).toEqual(["complete"]);
    expect(preview.parseErrors).toBe(0);
    expect(preview.truncated).toBe(true);
    expect(preview.records[0].split).toBe("held_out");
  });

  it("uses project declarations rather than dataset filenames to select corpus mode", () => {
    expect(isLlmCorpusProject({llm_workbench: {}})).toBe(true);
    expect(isLlmCorpusProject({runtime: {actions: {prompt: {interface: "prompt_process"}}}})).toBe(true);
    expect(isLlmCorpusProject({selected_dataset: "train.jsonl"})).toBe(false);
  });
});
