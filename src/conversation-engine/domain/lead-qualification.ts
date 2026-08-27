export const LEAD_QUALIFICATIONS = ["hot", "warm", "cold"] as const;

export type LeadQualification = (typeof LEAD_QUALIFICATIONS)[number];
