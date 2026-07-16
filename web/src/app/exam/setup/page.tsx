import { LearnerShell } from "@/components/layout";
import { ExamSetupScreen } from "@/components/exam/exam-setup-screen";

export default function ExamSetupPage() {
  return (
    <LearnerShell
      title="Exam setup"
      subtitle="Định nghĩa kỳ thi, chọn tài liệu, target score và kiểu câu hỏi để hệ thống dựng practice flow và lịch ôn phù hợp."
    >
      <ExamSetupScreen />
    </LearnerShell>
  );
}
