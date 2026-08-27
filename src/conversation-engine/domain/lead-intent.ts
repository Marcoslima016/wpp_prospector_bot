export const LEAD_INTENTS = [
  "interested",
  "not_interested",
  "needs_more_info",
  "opt_out",
  "off_topic",
  "unknown",
] as const;

export type LeadIntent = (typeof LEAD_INTENTS)[number];
