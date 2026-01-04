import { redirect } from "next/navigation";

export default function AdminSubmissionDetailRedirect({
  params,
}: {
  params: { id: string };
}) {
  const id = params?.id;
  if (id) {
    redirect(`/admin/submissions/detail?id=${id}`);
  }
  redirect("/admin/submissions");
}
