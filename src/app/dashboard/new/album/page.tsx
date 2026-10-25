import { AlbumSubmissionPageView } from "./view";
export const metadata = { title: "음반 심의 접수" };
export default function AlbumSubmissionPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  return AlbumSubmissionPageView(props);
}
