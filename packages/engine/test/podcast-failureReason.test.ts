import { describe, expect, it } from "vitest";
import { commitFailureReason, errorFailureReason } from "../src/podcast/failureReason.js";
import { InvalidRequestError, PodcastError } from "../src/podcast/types.js";

// The 2026-10-27 Catch up said only "Stopped while publishing"; the listener never learned why.
describe("a failed run's reason", () => {
  it("says an episode that saved nothing in plain words", () => {
    expect(commitFailureReason({ status: "nothing_to_commit" })).toMatch(/nothing was saved/);
  });

  it("has no reason for an outcome that was not a failure", () => {
    expect(commitFailureReason({ status: "saved", paths: [] })).toBeNull();
  });

  it("repeats a request or story problem and hides any other error's words", () => {
    expect(errorFailureReason(new PodcastError("No stories in Design in the last 7 days."))).toBe(
      "No stories in Design in the last 7 days.",
    );
    expect(errorFailureReason(new InvalidRequestError("bad request"))).toBe("bad request");
    expect(errorFailureReason(new Error("ECONNRESET at 10.0.0.1 token=abc"))).not.toMatch(
      /ECONNRESET|token/,
    );
  });
});
