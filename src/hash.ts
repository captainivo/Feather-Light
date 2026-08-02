import { createHash, randomUUID } from "node:crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableId(namespace: string, value: string): string {
  return `${namespace}_${sha256(value).slice(0, 24)}`;
}

export function newIngestId(): string {
  return `ing_${new Date().toISOString().replaceAll(/[-:.TZ]/g, "")}_${randomUUID().slice(0, 8)}`;
}

