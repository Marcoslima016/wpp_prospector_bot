import type { z } from "zod";

export class DomainValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}
