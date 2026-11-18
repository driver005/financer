import { describe, expect, it } from "vitest";
import { aiErrorReason } from "@/lib/ocr.server";

describe("aiErrorReason", () => {
  it("reads OpenAI-style and Gemini array errors", () => {
    expect(aiErrorReason('{"error":{"message":"model not found"}}')).toBe("model not found");
    expect(aiErrorReason('[{"error":{"code":400,"message":"API key not valid."}}]')).toBe(
      "API key not valid.",
    );
  });

  it("returns null for non-JSON or missing message", () => {
    expect(aiErrorReason("<html>Bad Request</html>")).toBeNull();
    expect(aiErrorReason('{"error":{}}')).toBeNull();
  });

  it("masks keys and caps length", () => {
    const r = aiErrorReason(
      JSON.stringify({
        error: { message: `bad key=AIzaSyABCDEFGHIJKLMNOP and sk-abcdefghijkl ${"x".repeat(300)}` },
      }),
    )!;
    expect(r).not.toMatch(/AIzaSy|sk-abc/);
    expect(r.length).toBeLessThanOrEqual(160);
  });
});
