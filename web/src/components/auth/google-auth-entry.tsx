import type { ReactNode } from "react";

export function GoogleAuthEntry(): ReactNode {
  return (
    <form action="/auth/google/start" method="get" className="space-y-4">
      <label htmlFor="login_hint" className="block text-sm font-medium text-ink-800">
        Email tài khoản Google <span className="font-normal text-ink-500">(tùy chọn)</span>
      </label>
      <input
        id="login_hint"
        name="login_hint"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        className="w-full rounded-xl border border-ink-200 px-4 py-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
      />
      <button
        type="submit"
        className="w-full rounded-xl bg-ink-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
      >
        Tiếp tục với Google
      </button>
      <p className="text-xs leading-5 text-ink-500">
        Email chỉ dùng để gợi ý tài khoản trên Google. Danh tính thật được xác minh bởi Google.
      </p>
    </form>
  );
}
