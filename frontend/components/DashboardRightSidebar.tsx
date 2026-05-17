"use client";

import { useCallback, useRef } from "react";
import { Grid3X3, Plus, Trash2, X, Check } from "lucide-react";
import { useChatContext } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import type { Widget } from "@/lib/api";

export function DashboardRightSidebar() {
  const {
    isRightSidebarOpen,
    setIsRightSidebarOpen,
    rightSidebarWidth,
    setRightSidebarWidth,
    activeReportId,
    reports,
    updateReport,
  } = useChatContext();
  const { profile, updateSettings } = useAuth();

  const savedWidgets = profile?.settings?.saved_widgets || [];
  const activeReport = reports.find((r) => r.id === activeReportId);

  const widthRef = useRef(rightSidebarWidth);
  widthRef.current = rightSidebarWidth;

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widthRef.current;
      const handleMove = (ev: MouseEvent) =>
        setRightSidebarWidth(Math.min(450, Math.max(200, startWidth - (ev.clientX - startX))));
      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [setRightSidebarWidth]
  );

  const deleteWidget = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!profile) return;
    const next = savedWidgets.filter((w) => w.id !== id);
    await updateSettings({ saved_widgets: next });
  };

  const addWidgetToReport = (widget: Widget) => {
    if (!activeReport) return;
    const currentWidgets = activeReport.widgets || [];
    
    // Check for duplicates
    if (currentWidgets.some(w => w.chart.sql === widget.chart.sql)) {
      return;
    }

    // Add a copy with a unique ID for the report instance
    const newWidgetInstance = { ...widget, id: crypto.randomUUID() };
    updateReport(activeReport.id, {
      widgets: [...currentWidgets, newWidgetInstance],
    });
    if (window.innerWidth < 768) setIsRightSidebarOpen(false);
  };

  const onDragStart = (e: React.DragEvent, widget: Widget) => {
    e.dataTransfer.setData("application/json", JSON.stringify(widget));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isRightSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 transition-opacity"
          onClick={() => setIsRightSidebarOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <div
        className={`fixed md:relative right-0 flex-shrink-0 h-full z-50 flex transition-all duration-300 ease-in-out overflow-hidden max-w-[90vw] md:max-w-none ${
          isRightSidebarOpen
            ? "translate-x-0 w-[var(--right-sidebar-width)]"
            : "translate-x-full w-[var(--right-sidebar-width)] md:translate-x-0 md:w-0"
        }`}
        style={{ "--right-sidebar-width": `${rightSidebarWidth}px` } as React.CSSProperties}
      >
        {/* Resize handle (desktop only, on the left side of this sidebar) */}
        <div
          onMouseDown={startResize}
          className="hidden md:block absolute top-0 left-0 w-1 h-full cursor-col-resize group z-10"
        >
          <div className="h-full w-full group-hover:bg-gray-400/30 dark:group-hover:bg-white/15 transition-colors" />
        </div>

        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-[#1a1a1a] border-l border-gray-200 dark:border-white/5 overflow-hidden select-none w-[var(--right-sidebar-width)]">
          <div className="px-4 py-4 border-b border-gray-200 dark:border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Grid3X3 className="h-4 w-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Widgets</h2>
            </div>
            <button
              onClick={() => setIsRightSidebarOpen(false)}
              className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-white/10 text-gray-500 dark:text-white/40 md:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {savedWidgets.length === 0 ? (
              <div className="py-10 text-center px-4">
                <p className="text-xs text-gray-400 dark:text-white/20">
                  No saved widgets yet. Save charts from the AI Assistant to see them here.
                </p>
              </div>
            ) : (
              savedWidgets.map((widget) => (
                <div
                  key={widget.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, widget)}
                  className="group relative bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-3 cursor-grab active:cursor-grabbing hover:border-blue-400/50 transition-all shadow-sm hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
                      {widget.name}
                    </p>
                    <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      {activeReport?.widgets?.some(w => w.chart.sql === widget.chart.sql) ? (
                        <div className="p-1 text-emerald-500" title="Already in report">
                          <Check className="h-3 w-3" />
                        </div>
                      ) : (
                        <button
                          onClick={() => addWidgetToReport(widget)}
                          title="Add to report"
                          className="p-1.5 rounded-lg bg-blue-500 text-white md:bg-blue-500/10 md:text-blue-500 md:hover:bg-blue-500/20"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => deleteWidget(widget.id, e)}
                        title="Delete widget"
                        className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Mini preview logic could go here, for now just show type */}
                  <div className="h-16 rounded-lg bg-gray-50 dark:bg-white/5 flex items-center justify-center border border-dashed border-gray-200 dark:border-white/10">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-white/20 font-bold">
                      {widget.chart.type} chart
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-4 border-t border-gray-200 dark:border-white/5 bg-gray-100/50 dark:bg-black/20">
            <p className="text-[10px] text-gray-400 dark:text-white/20 leading-relaxed text-center">
              Drag widgets to the dashboard or tap the plus icon to add them to your active report.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
