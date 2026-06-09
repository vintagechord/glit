type GlobalEmailTemplateInput = {
  applicantName?: string | null;
  submissionTitle?: string | null;
  paymentStatus?: string | null;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const baseDisclaimer =
  "Onside provides submission support for Korean broadcast review. Approval, broadcast airplay, programming, playlisting, and royalty collection are not guaranteed.";

export const buildGlobalSubmissionReceivedEmail = ({
  applicantName,
  submissionTitle,
  paymentStatus,
}: GlobalEmailTemplateInput) => {
  const name = escapeHtml(applicantName?.trim() || "there");
  const title = escapeHtml(submissionTitle?.trim() || "your submission");
  const status = escapeHtml(paymentStatus?.trim() || "pending");

  return {
    subject: "Your Korean Broadcast Review Submission Has Been Received",
    html: `<p>Hello ${name},</p><p>We have received ${title} for Korean broadcast review submission support.</p><p>Payment status: ${status}</p><p>Our team will review the submitted materials and contact you if additional files or information are required.</p><p>${baseDisclaimer}</p>`,
  };
};

export const buildGlobalPaymentConfirmedEmail = ({
  applicantName,
  submissionTitle,
}: GlobalEmailTemplateInput) => {
  const name = escapeHtml(applicantName?.trim() || "there");
  const title = escapeHtml(submissionTitle?.trim() || "your submission");

  return {
    subject: "Payment Confirmed for Your Onside Submission",
    html: `<p>Hello ${name},</p><p>Payment has been confirmed for ${title}.</p><p>Onside will continue checking your materials for Korean broadcast review submission support.</p><p>${baseDisclaimer}</p>`,
  };
};

export const buildGlobalAdditionalMaterialsEmail = ({
  applicantName,
  submissionTitle,
}: GlobalEmailTemplateInput) => {
  const name = escapeHtml(applicantName?.trim() || "there");
  const title = escapeHtml(submissionTitle?.trim() || "your submission");

  return {
    subject:
      "Additional Materials Required for Your Korean Broadcast Review Submission",
    html: `<p>Hello ${name},</p><p>Additional materials are required for ${title} before the submission can continue.</p><p>Our team will share the requested items and next steps.</p><p>${baseDisclaimer}</p>`,
  };
};
