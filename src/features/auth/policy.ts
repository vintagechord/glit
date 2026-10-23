// Bump when the corresponding published policy content changes. These identify
// the text presented at signup, not an external/legal approval date.
export const SIGNUP_POLICY_VERSIONS = {
  terms: "2026-10-24",
  privacy: "2026-10-24",
  refund: "2026-10-24",
} as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
