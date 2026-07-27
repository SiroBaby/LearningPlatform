import type { Metadata } from "next";
import { LearnerShell } from "@/components/layout";
import { TutorPageContent } from "@/components/tutor/tutor-page-content";
import { LinkButton } from "@/components/ui";
import { routes } from "@/lib/routes";

interface TutorSearchParams {
  readonly context?: string | string[];
}

export const metadata: Metadata = {
  title: "Tutor",
  description: "Chat với Tutor có source grounding, citation rõ ràng, và no-evidence state khi thiếu bằng chứng.",
};

export default async function TutorPage(props: PageProps<"/tutor">) {
  const searchParams = (await props.searchParams) as TutorSearchParams;
  const selectedContextKey = getFirstString(searchParams.context);

  return (
    <LearnerShell
      title="Tutor"
      subtitle="Chat layout với context selector, suggested prompts, answer cards có citation, và no-evidence state khi không đủ nguồn."
      actions={
        <>
          <LinkButton href={routes.review} variant="outline">
            Review queue
          </LinkButton>
          <LinkButton href={routes.courses} variant="outline">
            Courses
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
