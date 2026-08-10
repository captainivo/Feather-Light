import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

export interface GitFirstAddEvidence {
  commit: string;
  authoredAt: string;
  createdDate: string;
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

export function findGitRepository(path: string): string | null {
  const result = git(["-C", resolve(path), "rev-parse", "--show-toplevel"]);
  return result ? resolve(result) : null;
}

export function gitFirstAddEvidence(repositoryRoot: string, absolutePath: string): GitFirstAddEvidence | null {
  const path = relative(repositoryRoot, absolutePath);
  if (path === "" || path.startsWith("..")) throw new Error("Git evidence path is outside the repository");
  const output = git([
    "-C", repositoryRoot,
    "log", "--follow", "--diff-filter=A", "--format=%H%x09%aI", "--", path,
  ]);
  if (!output) return null;
  const line = output.split("\n").map((value) => value.trim()).filter(Boolean).at(-1);
  if (!line) return null;
  const [commit, authoredAt] = line.split("\t");
  if (!commit || !authoredAt || !/^\d{4}-\d{2}-\d{2}T/.test(authoredAt)) return null;
  return { commit, authoredAt, createdDate: authoredAt.slice(0, 10) };
}
