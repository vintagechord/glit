export type GuestLookupIdentity = {
  guest_name?: string | null;
  guest_email?: string | null;
  applicant_name?: string | null;
  applicant_email?: string | null;
};

const normalizeName = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const matchesGuestLookupIdentity = (
  row: GuestLookupIdentity,
  requestedName: string,
  requestedEmail: string,
) => {
  const name = normalizeName(requestedName);
  const email = normalizeEmail(requestedEmail);
  if (!name || !email) return false;
  const matches = (
    candidateName?: string | null,
    candidateEmail?: string | null,
  ) => {
    const normalizedName = normalizeName(candidateName ?? "");
    const normalizedEmail = normalizeEmail(candidateEmail ?? "");
    return (
      Boolean(normalizedName && normalizedEmail) &&
      normalizedName === name &&
      normalizedEmail === email
    );
  };

  // Never combine fields from different identity pairs. A guest name and an
  // applicant email together are not proof of either stored identity.
  return (
    matches(row.guest_name, row.guest_email) ||
    matches(row.applicant_name, row.applicant_email)
  );
};
