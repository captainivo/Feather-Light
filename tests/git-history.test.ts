import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findGitRepository, gitFirstAddEvidence } from "../src/git-history.js";

function git(root: string, args: string[], date?: string): void {
  execFileSync("git", ["-C", root, ...args], {
    stdio: "ignore",
    env: {
      ...process.env,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  });
}

describe("Git creation evidence", () => {
  it("follows a rename back to the first-add commit", () => {
    const root = join(process.env.TMPDIR ?? "/tmp", `feather-git-${crypto.randomUUID()}`);
    mkdirSync(root, { recursive: true });
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    const original = join(root, "Original.md");
    const renamed = join(root, "Renamed.md");
    writeFileSync(original, "# Original\n");
    git(root, ["add", "Original.md"]);
    git(root, ["commit", "-q", "-m", "add note"], "2020-02-03T12:00:00-07:00");
    git(root, ["mv", "Original.md", "Renamed.md"]);
    git(root, ["commit", "-q", "-m", "rename note"], "2022-05-06T12:00:00-07:00");

    const repository = findGitRepository(root)!;
    expect(repository).toBe(realpathSync(root));
    expect(gitFirstAddEvidence(repository, realpathSync(renamed))).toMatchObject({
      authoredAt: "2020-02-03T12:00:00-07:00",
      createdDate: "2020-02-03",
    });
  });

  it("returns null outside a Git repository", () => {
    const root = join(process.env.TMPDIR ?? "/tmp", `feather-no-git-${crypto.randomUUID()}`);
    mkdirSync(root, { recursive: true });
    expect(findGitRepository(root)).toBeNull();
  });
});
