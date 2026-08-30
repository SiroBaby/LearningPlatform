import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { TutorPageContent } from "@/components/tutor/tutor-page-content";
import { LinkButton } from "@/components/ui";
import { routes } from "@/lib/routes";

interface TutorSearchParams {
  readonly context?: string | string[];
}

export const metadata: Metadata = {
  title: "Trợ giảng",
  description: "Đặt câu hỏi về tài liệu và nhận lời giải thích có trích dẫn rõ ràng.",
};

export default async function TutorPage(props: PageProps<"/tutor">) {
  const searchParams = (await props.searchParams) as TutorSearchParams;
  const selectedContextKey = getFirstString(searchParams.context);

  return (
    <LearnerShell
      title="Trợ giảng"
      subtitle="Chọn tài liệu, đặt câu hỏi, rồi kiểm tra lại phần giải thích ngay trong nguồn học."
      actions={
        <>
          <LinkButton href={routes.review} variant="outline">
            Ôn tập
          </LinkButton>
          <LinkButton href={routes.courses} variant="outline">
            Khóa học
          </LinkButton>
        </>
      }
    >
      <TutorPageContent selectedContextKey={selectedContextKey} />
    </LearnerShell>
  );
}

function getFirstString(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
