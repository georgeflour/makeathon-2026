import { LayoutDashboard } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-white dark:bg-[#212121] px-4">
      <div className="text-center space-y-4">
        <div className="h-16 w-16 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center mx-auto">
          <LayoutDashboard className="h-8 w-8 text-gray-300 dark:text-white/25" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-500 dark:text-white/70">Dashboard</h1>
          <p className="text-sm text-gray-400 dark:text-white/30 mt-1 max-w-xs mx-auto">
            Analytics dashboard coming soon. Use the chat to explore your data.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/25">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          In progress
        </div>
      </div>
    </div>
  );
}
