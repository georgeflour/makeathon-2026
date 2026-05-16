"use client";

import { useChatContext } from "@/context/ChatContext";
import { DashboardRightSidebar } from "@/components/DashboardRightSidebar";
import { ChartPanel } from "@/components/ChartPanel";
import { LayoutDashboard, Plus, Trash2 } from "lucide-react";
import type { Widget } from "@/lib/api";

export default function DashboardPage() {
  const {
    activeReportId,
    reports,
    updateReport,
    setIsRightSidebarOpen,
    isRightSidebarOpen,
  } = useChatContext();

  const activeReport = reports.find((r) => r.id === activeReportId);
  const widgets = activeReport?.widgets || [];

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    try {
      const widgetData = e.dataTransfer.getData("application/json");
      if (!widgetData || !activeReport) return;
      
      const widget = JSON.parse(widgetData) as Widget;
      
      // Check for duplicates
      if (widgets.some(w => w.chart.sql === widget.chart.sql)) {
        return;
      }

      const newWidgetInstance = { ...widget, id: crypto.randomUUID() };
      
      updateReport(activeReport.id, {
        widgets: [...widgets, newWidgetInstance],
      });
    } catch (err) {
      console.error("Drop failed:", err);
    }
  };

  const removeWidget = (id: string) => {
    if (!activeReport) return;
    updateReport(activeReport.id, {
      widgets: widgets.filter((w) => w.id !== id),
    });
  };

  if (!activeReport) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-white dark:bg-[#111] px-4">
        <div className="text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 flex items-center justify-center mx-auto">
            <LayoutDashboard className="h-8 w-8 text-gray-300 dark:text-white/20" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">No active report</h1>
            <p className="text-sm text-gray-500 dark:text-white/40 mt-1 max-w-xs mx-auto">
              Select or create a report from the sidebar to start building your dashboard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-white dark:bg-[#111]">
      <main 
        className="flex-1 overflow-y-auto p-6 lg:p-10"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{activeReport.name}</h1>
              <p className="text-sm text-gray-500 dark:text-white/40">
                Customise your report by dragging widgets from the right sidebar.
              </p>
            </div>
            {!isRightSidebarOpen && (
              <button
                onClick={() => setIsRightSidebarOpen(true)}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-all shadow-lg shadow-blue-500/25"
              >
                <Plus className="h-4 w-4" /> Add Widget
              </button>
            )}
          </div>

          {/* Grid Area */}
          {widgets.length === 0 ? (
            <div 
              className="group min-h-[400px] rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 flex flex-col items-center justify-center p-12 transition-colors hover:border-blue-400/50 hover:bg-blue-50/10"
            >
              <div className="h-12 w-12 rounded-full bg-gray-50 dark:bg-white/5 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Plus className="h-6 w-6 text-gray-300 dark:text-white/20 group-hover:text-blue-500" />
              </div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Your dashboard is empty</p>
              <p className="text-xs text-gray-500 dark:text-white/40 mt-1 text-center max-w-[240px]">
                Drag saved widgets here or use the &quot;Add Widget&quot; button to begin your analysis.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {widgets.map((widget) => (
                <div key={widget.id} className="group relative">
                  <div className="absolute top-4 right-14 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => removeWidget(widget.id)}
                      className="p-1.5 rounded-lg bg-red-500 text-white shadow-lg shadow-red-500/20 hover:bg-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <ChartPanel chart={widget.chart} />
                </div>
              ))}
              
              {/* Drop Target Placeholder */}
              <div 
                className="min-h-[300px] rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/10 flex items-center justify-center transition-colors hover:border-blue-400/50 hover:bg-blue-50/10"
              >
                <div className="text-center">
                  <Plus className="h-5 w-5 text-gray-300 dark:text-white/20 mx-auto mb-2" />
                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 dark:text-white/20">Drop here</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <DashboardRightSidebar />
    </div>
  );
}
