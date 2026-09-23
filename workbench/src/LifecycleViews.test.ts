import {describe, expect, it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {annotationTrackColor, annotationTimelineTicks, AnnotationTimelineTicks, recordedAnnotationFrames} from "./LifecycleViews";
describe("source-bound annotation presentation", () => {
  it("shows only actual recorded frame coordinates, sorted without filling gaps", () => {
    expect(recordedAnnotationFrames([{frame:23},{frame:1},{frame:23},{frame:200}])).toEqual([1,23,200]);
    expect(recordedAnnotationFrames([])).toEqual([]);
  });
  it("keeps each track color stable across frames and distinguishes track identities", () => {
    expect(annotationTrackColor("2329")).toBe(annotationTrackColor("2329"));
    expect(annotationTrackColor("2329")).not.toBe(annotationTrackColor("2330"));
    expect(annotationTrackColor("vehicle-7")).not.toBe(annotationTrackColor("vehicle-8"));
  });
});


describe("bounded annotation timeline labels", () => {
  const frames = Array.from({length:203}, (_, index) => index + 1);
  it("labels only endpoints and a sufficiently separated selected frame", () => {
    expect(annotationTimelineTicks(frames,1,900)).toEqual([1,203]);
    expect(annotationTimelineTicks(frames,101,900)).toEqual([1,101,203]);
    expect(annotationTimelineTicks(frames,2,900)).toEqual([1,203]);
    expect(annotationTimelineTicks(frames,202,900)).toEqual([1,203]);
    expect(annotationTimelineTicks(frames,101,120)).toEqual([1,203]);
  });
  it("keeps sparse and empty source coordinates authoritative", () => {
    expect(annotationTimelineTicks([],1,900)).toEqual([]);
    expect(annotationTimelineTicks([23],23,900)).toEqual([23]);
    expect(annotationTimelineTicks([1,23,203],22,900)).toEqual([1,203]);
    expect(annotationTimelineTicks([1,23,203],23,900)).toEqual([1,23,203]);
  });
  it("renders two readable buttons for the initial frame of a 203-frame source", () => {
    const html=renderToStaticMarkup(createElement(AnnotationTimelineTicks,{frames,current:1,width:900,onFrame:()=>{}}));
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Go to recorded frame 1"');
    expect(html).toContain('aria-label="Go to recorded frame 203"');
    expect(html).not.toContain('aria-label="Go to recorded frame 2"');
  });
});
