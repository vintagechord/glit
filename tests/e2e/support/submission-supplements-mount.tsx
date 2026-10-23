import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { SubmissionSupplements } from "../../../src/features/submissions/submission-supplements";

export function SubmissionSupplementsFixture() {
  const query = new URLSearchParams(window.location.search);
  return <PathnameContext.Provider value={query.has("en") ? "/en/track/fixture" : "/track/fixture"}>
    <main className="mx-auto max-w-4xl p-4">
      <SubmissionSupplements
        submissionId="00000000-0000-4000-8000-000000000001"
        guestToken={query.has("admin") ? undefined : "fixture-guest-ownership-token"}
        admin={query.has("admin")}
      />
    </main>
  </PathnameContext.Provider>;
}
