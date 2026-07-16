import type { Metadata } from "next";
import { Suspense } from "react";
import { LearnerShell } from "@/components/layout";
import { LibraryBrowser } from "@/components/library/library-browser";
import { SkeletonCard } from "@/components/ui";

export const metadata: Metadata = {
  title: "Thư viện",
  description:
    "Xem lại tài liệu đã tải lên, trạng thái xử lý và quiz liên quan.",
};

export default function LibraryPage() {
  return (
    <LearnerShell
      title="Thư viện"
      subtitle="Tất cả tài liệu của bạn ở đây để xem lại, theo dõi xử lý và mở quiz khi sẵn sàng."
    >
      <Suspense fallback={<SkeletonCard />}>
        <LibraryBrowser />
      </Suspense>
    </LearnerShell>
  );
}
