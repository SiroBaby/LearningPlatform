import type { Locator } from "@/lib/types";

export interface SourceSegment {
  readonly id: string;
  readonly heading: string;
  readonly locator: Locator;
  readonly body: string;
  readonly citationChunkIds: readonly string[];
}

const sourceFixtures: Record<string, readonly SourceSegment[]> = {
  doc_os_ch3: [
    {
      id: "os-page-10",
      heading: "Khái niệm tiến trình",
      locator: { kind: "page", page: 10 },
      body:
        "Tiến trình là chương trình đang thực thi cùng với trạng thái CPU, bộ nhớ và tài nguyên liên quan. Hệ điều hành phải quản lý vòng đời tiến trình để tối ưu khả năng đáp ứng và thông lượng.",
      citationChunkIds: [],
    },
    {
      id: "os-page-12",
      heading: "Context switching và chi phí hệ thống",
      locator: { kind: "page", page: 12 },
      body:
        "Context switch requires saving and restoring process state, which introduces CPU overhead because no useful work is done during the switch. Khi quantum quá nhỏ, chi phí chuyển ngữ cảnh có thể chiếm tỷ lệ đáng kể trong tổng thời gian CPU.",
      citationChunkIds: ["chunk_os_012"],
    },
    {
      id: "os-page-18",
      heading: "Round-Robin và time quantum",
      locator: { kind: "page", page: 18 },
      body:
        "Round-Robin cấp cho mỗi tiến trình một lượng thời gian (time quantum) cố định, sau đó chuyển sang tiến trình kế tiếp trong hàng đợi. Quantum quá dài sẽ gần giống FCFS, còn quá ngắn sẽ làm tăng overhead của context switch.",
      citationChunkIds: ["chunk_os_018"],
    },
    {
      id: "os-page-24",
      heading: "Semaphore và đồng bộ tiến trình",
      locator: { kind: "page", page: 24 },
      body:
        "Semaphore là biến đếm dùng để đồng bộ tiến trình; thao tác wait() giảm giá trị, signal() tăng giá trị một cách nguyên tử. Cơ chế này giúp kiểm soát truy cập tài nguyên dùng chung và tránh race condition khi được thiết kế đúng.",
      citationChunkIds: ["chunk_os_024"],
    },
    {
      id: "os-page-29",
      heading: "Điều kiện Coffman của deadlock",
      locator: { kind: "page", page: 29 },
      body:
        "Deadlock chỉ xảy ra khi đồng thời có loại trừ tương hỗ, giữ-và-chờ, không cưỡng đoạt và chờ vòng tròn. Phá vỡ bất kỳ điều kiện nào cũng là một chiến lược phòng tránh deadlock.",
      citationChunkIds: [],
    },
  ],
  doc_ml_intro: [
    {
      id: "ml-page-5",
      heading: "Loss function và mục tiêu tối ưu",
      locator: { kind: "page", page: 5 },
      body:
        "Loss function đo mức sai lệch giữa dự đoán của mô hình và dữ liệu thực tế. Tối ưu hóa tìm bộ tham số giúp giảm loss trên tập huấn luyện đồng thời vẫn giữ khả năng tổng quát hóa.",
      citationChunkIds: [],
    },
    {
      id: "ml-page-7",
      heading: "Gradient descent cơ bản",
      locator: { kind: "page", page: 7 },
      body:
        "Gradient descent updates parameters in the opposite direction of the gradient of the loss function, scaled by the learning rate. Learning rate quá lớn có thể làm thuật toán dao động, còn quá nhỏ sẽ hội tụ chậm.",
      citationChunkIds: ["chunk_ml_007"],
    },
    {
      id: "ml-page-11",
      heading: "Batch, mini-batch và stochastic updates",
      locator: { kind: "page", page: 11 },
      body:
        "Mini-batch gradient descent cân bằng giữa độ ổn định của batch update và tốc độ của stochastic update. Đây là lựa chọn phổ biến trong huấn luyện thực tế vì tận dụng tốt phần cứng song song.",
      citationChunkIds: [],
    },
  ],
  doc_net_video: [
    {
      id: "net-segment-1",
      heading: "00:00–01:30 · Tổng quan giao thức vận chuyển",
      locator: { kind: "time", startSec: 0, endSec: 90 },
      body:
        "Phần mở đầu giới thiệu vai trò của transport layer, lý do ứng dụng cần cân bằng giữa độ tin cậy, độ trễ và thứ tự gói tin khi lựa chọn TCP hoặc UDP.",
      citationChunkIds: [],
    },
    {
      id: "net-segment-2",
      heading: "05:12–05:58 · TCP three-way handshake",
      locator: { kind: "time", startSec: 312, endSec: 358 },
      body:
        "TCP dùng cơ chế bắt tay ba bước (three-way handshake): SYN, SYN-ACK, ACK để thiết lập kết nối tin cậy trước khi truyền dữ liệu. Giảng viên nhấn mạnh rằng bước này giúp hai phía đồng bộ số thứ tự và trạng thái kết nối.",
      citationChunkIds: ["chunk_net_115"],
    },
    {
      id: "net-segment-3",
      heading: "10:40–11:30 · UDP và bài toán độ trễ",
      locator: { kind: "time", startSec: 640, endSec: 690 },
      body:
        "UDP là giao thức không kết nối, không đảm bảo thứ tự hay độ tin cậy, đổi lại độ trễ thấp — phù hợp cho streaming và game. Đây là ví dụ điển hình khi ứng dụng ưu tiên tính thời gian thực hơn khả năng truyền lại dữ liệu.",
      citationChunkIds: ["chunk_net_140"],
    },
    {
      id: "net-segment-4",
      heading: "12:10–13:10 · Khi nào chọn TCP hay UDP",
      locator: { kind: "time", startSec: 730, endSec: 790 },
      body:
        "Phần kết của video so sánh các tiêu chí chọn giao thức: nếu cần giao hàng đúng thứ tự và đáng tin cậy thì TCP phù hợp; nếu cần tốc độ và chấp nhận mất gói ở mức có kiểm soát thì UDP hợp lý hơn.",
      citationChunkIds: [],
    },
  ],
  doc_db_ch5: [
    {
      id: "db-page-1",
      heading: "Đang trích xuất nội dung",
      locator: { kind: "page", page: 1 },
      body:
        "Bản xem trước nguồn sẽ xuất hiện sau khi hệ thống hoàn tất bước trích xuất và kiểm tra đầu ra. Bạn có thể rời trang này; tiến trình xử lý vẫn tiếp tục ở nền.",
      citationChunkIds: [],
    },
  ],
  doc_calc_notes: [
    {
      id: "calc-page-1",
      heading: "Không đủ nội dung để xem trước",
      locator: { kind: "page", page: 1 },
      body:
        "Tệp văn bản quá ngắn nên hệ thống không trích xuất được đủ bằng chứng để sinh câu hỏi và trích dẫn đáng tin cậy. Hãy tải lên ghi chú dài hơn hoặc ghép nhiều đoạn liên quan thành một document.",
      citationChunkIds: [],
    },
  ],
  doc_hist_audio: [
    {
      id: "hist-segment-1",
      heading: "Sẵn sàng bắt đầu xử lý audio",
      locator: { kind: "time", startSec: 0, endSec: 45 },
      body:
        "Sau khi bạn bắt đầu xử lý, hệ thống sẽ tạo transcript, chia checkpoint theo chủ đề và dựng quiz có trích dẫn theo mốc thời gian của file audio này.",
      citationChunkIds: [],
    },
  ],
};

export function getSourceSegments(documentId: string): readonly SourceSegment[] {
  return sourceFixtures[documentId] ?? [];
}

export function findSegmentByChunkId(
  documentId: string,
  chunkId: string | null,
): SourceSegment | undefined {
  if (!chunkId) {
    return undefined;
  }

  return getSourceSegments(documentId).find((segment) =>
    segment.citationChunkIds.includes(chunkId),
  );
}
