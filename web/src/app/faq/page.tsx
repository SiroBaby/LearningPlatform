import type { Metadata } from "next";
import { ArrowRight, CircleAlert, LockKeyhole, SearchCheck, ShieldCheck, Sparkles } from "lucide-react";
import { routes } from "@/lib/routes";
import { PublicShell } from "@/components/layout";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  LinkButton,
  SectionHeading,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Giải đáp về AI trust, quyền riêng tư, giới hạn processing, pricing, credits, video support và cách LearningPlatform dùng citation để giữ câu trả lời có căn cứ.",
};

type FaqItem = {
  question: string;
  answer: string;
};

const faqGroups: readonly {
  title: string;
  eyebrow: string;
  icon: React.ComponentType<{ className?: string }>;
  items: readonly FaqItem[];
}[] = [
  {
    title: "AI trust & citation",
    eyebrow: "Grounded answers first",
    icon: SearchCheck,
    items: [
      {
        question: "LearningPlatform có hứa AI luôn đúng không?",
        answer:
          "Không. Sản phẩm không hứa AI luôn đúng. Điều LearningPlatform hứa là mỗi question, explanation hoặc Tutor answer nên đi kèm citation đủ rõ để bạn kiểm tra lại với tài liệu gốc khi cần.",
      },
      {
        question: "Tại sao citation lại quan trọng đến vậy?",
        answer:
          "Citation biến output từ “một câu trả lời nghe có vẻ hợp lý” thành “một câu trả lời có thể kiểm chứng”. Bạn thấy được trang, timestamp hoặc source snippet nào đã được dùng để tạo question hay explanation đó.",
      },
      {
        question: "Nếu Tutor không tìm thấy đủ bằng chứng trong tài liệu thì sao?",
        answer:
          "Tutor nên nói rõ rằng không tìm thấy đủ source evidence để trả lời tự tin. Mục tiêu là giữ niềm tin bằng cách thừa nhận giới hạn, thay vì bịa thêm nội dung nằm ngoài tài liệu đang học.",
      },
    ],
  },
  {
    title: "Privacy & data handling",
    eyebrow: "Private by default",
    icon: LockKeyhole,
    items: [
      {
        question: "Tài liệu tôi tải lên có riêng tư mặc định không?",
        answer:
          "Có. Public-facing copy và UI của sản phẩm mặc định truyền đạt rằng uploaded documents là private by default. Người dùng cần có cách xóa tài liệu và generated outputs của mình khi cần.",
      },
      {
        question: "LearningPlatform có cho tôi biết file nào bị từ chối và vì sao không?",
        answer:
          "Có. Nếu file vượt giới hạn plan, sai định dạng hoặc không đủ nội dung để sinh output chất lượng, UI phải hiển thị lý do dễ hiểu, tình trạng credits và hành động recovery tiếp theo.",
      },
      {
        question: "Tôi có thể kiểm soát xóa dữ liệu không?",
        answer:
          "Thiết kế sản phẩm hướng tới việc người dùng nhìn thấy privacy settings, delete controls và data-usage notes rõ ràng thay vì giấu trong phần trợ giúp. Với bản mock này, nội dung vẫn nhấn mạnh quyền kiểm soát đó.",
      },
    ],
  },
  {
    title: "Limits & processing",
    eyebrow: "Know the limits before you wait",
    icon: CircleAlert,
    items: [
      {
        question: "Vì sao có lúc processing mất vài phút?",
        answer:
          "Vì pipeline không chỉ upload file mà còn cần trích xuất nội dung, chia chunk, sinh câu hỏi, kiểm tra chất lượng đầu ra rồi mới dựng quiz/flashcards/checkpoints. UI tốt phải cho bạn thấy bước nào đang chạy và bạn có thể rời trang trong lúc chờ.",
      },
      {
        question: "Những giới hạn nào thường chặn người dùng?",
        answer:
          "Những limit state quan trọng gồm: hết credits, file quá lớn so với plan, video processing chưa mở khóa, hoặc quota Tutor trong ngày đã dùng hết. Mỗi trạng thái cần có reason rõ ràng, CTA nâng cấp và phương án thay thế nếu có.",
      },
      {
        question: "Nếu processing thất bại thì credits có mất không?",
        answer:
          "Điều đó tùy nguyên nhân, nhưng UI phải nói rõ credits bị trừ, được hoàn hay không đổi. Đây là một trust surface quan trọng vì người học cần dự đoán được chi phí, nhất là với video dài hoặc tài liệu nhiều trang.",
      },
    ],
  },
  {
    title: "Pricing & plans",
    eyebrow: "Transparent plan boundaries",
    icon: ShieldCheck,
    items: [
      {
        question: "Pricing page nên cho tôi biết những gì?",
        answer:
          "Không chỉ là giá. Pricing cần nêu monthly/yearly toggle, AI credits, số uploads, page/minute limits, max file size, video support, Tutor availability, analytics depth, top-up policy và fair-use note của từng plan.",
      },
      {
        question: "Free plan có đủ để hiểu sản phẩm không?",
        answer:
          "Có — Free nên đủ để thử workflow PDF/text cơ bản và xem grounded quiz hoạt động ra sao. Nhưng nếu bạn muốn process lecture video, dùng Tutor nhiều hoặc chạy analytics sâu hơn, sản phẩm phải nói rõ bạn cần plan cao hơn trước khi upload.",
      },
      {
        question: "Top-up và upgrade khác nhau thế nào?",
        answer:
          "Top-up là mua thêm credits trong phạm vi plan hiện tại nếu plan đó hỗ trợ. Upgrade là đổi hẳn sang tier khác để có quota lớn hơn hoặc mở khóa capability như video processing, classroom analytics hay Tutor quota cao hơn.",
      },
    ],
  },
] as const;

export default function FaqPage() {
  return (
    <PublicShell>
      <section className="border-b border-ink-200 bg-gradient-to-b from-brand-50 via-white to-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <Badge tone="brand">Help & FAQ</Badge>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
              Câu trả lời thẳng thắn về AI trust, privacy, limits, processing và pricing.
            </h1>
            <p className="mt-5 text-lg leading-8 text-ink-600">
              Trang FAQ này giữ cùng giọng điệu như sản phẩm: không hype, không né tránh giới hạn. Nếu AI có thể sai, nếu video cần upgrade, hoặc nếu processing thất bại có thể hoàn credits, nội dung phải nói thẳng điều đó.
            </p>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <FaqStat
              label="AI contract"
              value="Citation trước, trả lời sau"
              detail="Câu trả lời có thể kiểm tra lại với tài liệu gốc là trust surface cốt lõi nhất."
            />
            <FaqStat
              label="Privacy"
              value="Uploaded documents are private by default"
              detail="Người dùng cần thấy rõ delete control và data note, không bị buộc phải đoán."
            />
            <FaqStat
              label="Pricing"
              value="Quota rõ, limit state rõ"
              detail="Credits, uploads, page quota và video limits phải được nêu trước khi xử lý."
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Frequently asked"
          title="Những câu hỏi visitor thường cần trả lời trước khi tin vào sản phẩm"
          description="Các nhóm câu hỏi bên dưới bám vào đúng các bề mặt niềm tin của LearningPlatform: grounded AI, quyền riêng tư, giới hạn processing và policy pricing."
        />
        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          {faqGroups.map((group) => (
            <FaqGroupCard key={group.title} group={group} />
          ))}
        </div>
      </section>

      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="What this product will and won’t do"
            title="Một vài câu quan trọng đáng được nhắc lại nhiều lần"
            description="Những statement này nên xuất hiện xuyên suốt trong marketing, onboarding và billing flows để visitor không hiểu sai bản chất sản phẩm."
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <Card className="border-success-100 bg-success-50/70">
              <CardBody className="space-y-3">
                <p className="text-sm font-semibold text-success-700">What it will do</p>
                <QuoteRow text="Biến tài liệu của bạn thành quiz, checkpoint và feedback có thể kiểm tra lại bằng citation." />
                <QuoteRow text="Cho bạn biết mình đang yếu ở topic nào và nên học gì tiếp theo." />
                <QuoteRow text="Hiển thị processing status, credits estimate và limit state đủ rõ trước khi bạn bị kẹt giữa chừng." />
              </CardBody>
            </Card>
            <Card className="border-warning-100 bg-warning-50/70">
              <CardBody className="space-y-3">
                <p className="text-sm font-semibold text-warning-700">What it won’t claim</p>
                <QuoteRow text="Không hứa AI luôn đúng hoặc biết mọi thứ ngoài tài liệu của bạn." />
                <QuoteRow text="Không giấu limit state cho đến sau khi bạn đã upload xong tài liệu lớn." />
                <QuoteRow text="Không xem pricing chỉ là bảng giá; pricing phải là bản mô tả policy và quota thực tế." />
              </CardBody>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <Card className="border-brand-100 bg-brand-50/70">
          <CardBody className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-700">Still evaluating?</p>
              <h2 className="text-2xl font-semibold text-ink-900 sm:text-3xl">
                Xem examples trước, rồi kiểm tra pricing nếu bạn cần quota lớn hơn hoặc hỗ trợ video.
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-ink-600 sm:text-base">
                FAQ chỉ trả lời policy. Nếu bạn muốn thấy output thực tế, hãy xem example gallery; nếu bạn muốn biết giới hạn cụ thể theo workload, mở pricing comparison.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <LinkButton href={routes.examples}>
                View examples <ArrowRight className="h-4 w-4" />
              </LinkButton>
              <LinkButton href={routes.pricing} variant="outline">
                Compare plans
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </section>
    </PublicShell>
  );
}

function FaqGroupCard({
  group,
}: {
  group: {
    title: string;
    eyebrow: string;
    icon: React.ComponentType<{ className?: string }>;
    items: readonly FaqItem[];
  };
}) {
  const Icon = group.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">{group.eyebrow}</p>
            <CardTitle className="mt-1">{group.title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {group.items.map((item) => (
          <div key={item.question} className="rounded-2xl border border-ink-200 bg-ink-50/70 p-4">
            <h3 className="text-sm font-semibold text-ink-900">{item.question}</h3>
            <p className="mt-2 text-sm leading-6 text-ink-600">{item.answer}</p>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function FaqStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white px-4 py-3 card-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">{label}</p>
      <p className="mt-2 text-base font-semibold text-ink-900">{value}</p>
      <p className="mt-1 text-sm leading-6 text-ink-500">{detail}</p>
    </div>
  );
}

function QuoteRow({ text }: { text: string }) {
  return (
    <div className="flex gap-2 text-sm leading-6 text-ink-700">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
      <span>{text}</span>
    </div>
  );
}
