import { describe, expect, it } from "vitest";
import { containedImageBounds, imageAnnotationPoint } from "../src/lib/imageAnnotationGeometry";

describe("annotation image coordinates", () => {
  it("uses visible portrait pixels inside a wider image box", () => {
    expect(containedImageBounds({ left: 10, top: 20, width: 400, height: 600 }, 400, 1600)).toEqual({ left: 135, top: 20, width: 150, height: 600 });
  });
  it("excludes vertical letterboxing from a panoramic image", () => {
    expect(containedImageBounds({ left: 10, top: 20, width: 600, height: 300 }, 1200, 120)).toEqual({ left: 10, top: 140, width: 600, height: 60 });
  });
  it("keeps a small image at its actual bounds", () => {
    expect(containedImageBounds({ left: 40, top: 30, width: 80, height: 40 }, 80, 40)).toEqual({ left: 40, top: 30, width: 80, height: 40 });
  });
  it("maps the same image landmark identically before and after a resize", () => {
    for (const width of [260, 360, 900]) {
      const bounds = containedImageBounds({ left: 40, top: 30, width, height: 640 }, 400, 1600)!;
      expect(imageAnnotationPoint(bounds, bounds.left + bounds.width * 0.25, bounds.top + bounds.height * 0.75)).toEqual({ x: 0.25, y: 0.75 });
    }
  });
  it("rejects drawing starts in padding and clamps captured moves to the edge", () => {
    const bounds = { left: 100, top: 200, width: 80, height: 40 };
    expect(imageAnnotationPoint(bounds, 90, 220)).toBeNull();
    expect(imageAnnotationPoint(bounds, 200, 220)).toBeNull();
    expect(imageAnnotationPoint(bounds, 200, 220, true)).toEqual({ x: 1, y: 0.5 });
  });
  it("does not create coordinates for unloaded or nonfinite images", () => {
    const box = { left: 0, top: 0, width: 300, height: 200 };
    expect(containedImageBounds(box, 0, 0)).toBeNull();
    expect(containedImageBounds({ ...box, width: 0 }, 100, 100)).toBeNull();
    expect(containedImageBounds(box, NaN, 100)).toBeNull();
    expect(imageAnnotationPoint(null, 10, 10)).toBeNull();
    expect(imageAnnotationPoint(box, NaN, 10)).toBeNull();
  });
});
