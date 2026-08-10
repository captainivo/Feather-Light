import { describe, expect, it } from "vitest";
import { renderArchiveMigrationReviewPage } from "../src/archive-migration-review-page.js";

describe("offline archive migration review page", () => {
  it("renders controls and safely embeds private review data", () => {
    const html = renderArchiveMigrationReviewPage({
      reviewVersion: 1,
      planVersion: 1,
      planHash: "a".repeat(64),
      rootId: "private-root",
      decisions: [{
        relativePath: "private/</script><script>alert(1)</script>.md",
        sourceHash: "b".repeat(64),
        field: "status",
        action: "pending",
        proposal: { value: "draft", level: "review", source: "test", reason: "Synthetic reason" },
      }],
    });
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("Download review JSON");
    expect(html).toContain("Approve visible review proposals");
    expect(html).not.toContain("private/</script><script>alert(1)</script>.md");
    expect(html).toContain("private/\\u003c/script>");
  });
});
