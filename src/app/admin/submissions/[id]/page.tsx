import AdminSubmissionDetailPage, {
  dynamic,
  metadata,
  revalidate,
} from "../detail/page";

export { dynamic, metadata, revalidate };

export default function AdminSubmissionDetailById({
  params,
}: {
  params: { id: string };
}) {
  return AdminSubmissionDetailPage({
    params,
    searchParams: { id: params.id },
  });
}
