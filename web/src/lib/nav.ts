import {
  BarChart3,
  BookOpen,
  Bot,
  CreditCard,
  FileStack,
  Gauge,
  GraduationCap,
  Home,
  Library,
  MessageSquare,
  Settings,
  Shield,
  Upload,
  Users,
} from "lucide-react";
import { routes } from "@/lib/routes";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const learnerPrimaryNav: NavItem[] = [
  { href: routes.home, label: "Trang chủ", icon: Home },
  { href: routes.library, label: "Thư viện", icon: Library },
  { href: routes.review, label: "Ôn tập", icon: BookOpen },
  { href: routes.tutor, label: "Trợ giảng", icon: Bot },
  { href: routes.analytics, label: "Tiến độ", icon: BarChart3 },
  { href: routes.courses, label: "Khóa học", icon: FileStack },
  { href: routes.upload, label: "Tải lên", icon: Upload },
];

export const learnerBottomNav: NavItem[] = [
  { href: routes.home, label: "Trang chủ", icon: Home },
  { href: routes.library, label: "Thư viện", icon: Library },
  { href: routes.review, label: "Ôn tập", icon: BookOpen },
  { href: routes.tutor, label: "Trợ giảng", icon: MessageSquare },
  { href: routes.upload, label: "Tải lên", icon: Upload },
];

export const learnerSecondaryNav: NavItem[] = [
  { href: routes.billing, label: "Mức sử dụng", icon: CreditCard },
  { href: routes.settings, label: "Cài đặt", icon: Settings },
];

export const teacherNav: NavItem[] = [
  { href: routes.teacherHome, label: "Teacher Home", icon: GraduationCap },
  { href: routes.teacherClasses, label: "Classes", icon: Users },
  { href: routes.teacherAssignmentNew, label: "Assignments", icon: FileStack },
  { href: routes.billing, label: "Billing", icon: CreditCard },
];

export const adminNav: NavItem[] = [
  { href: routes.adminOverview, label: "Overview", icon: Gauge },
  { href: routes.adminJobs, label: "Jobs", icon: FileStack },
  { href: routes.adminCost, label: "AI Cost", icon: BarChart3 },
  { href: routes.adminModeration, label: "Moderation", icon: Shield },
  { href: routes.adminSupport, label: "Support", icon: MessageSquare },
];

export const publicNav = [
  { href: routes.product, label: "Product" },
  { href: routes.examples, label: "Examples" },
  { href: routes.pricing, label: "Pricing" },
  { href: routes.faq, label: "FAQ" },
] as const;
