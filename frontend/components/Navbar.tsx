import Link from "next/link";
import { BarChart2 } from "lucide-react";

export function Navbar() {
  return (
    <nav className="w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center justify-between px-4 sm:px-8">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-5 w-5 text-primary" />
          <Link href="/" className="font-bold text-lg tracking-tight">
            NR2<span className="text-primary">Dashboard</span>
          </Link>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Powered by</span>
          <span className="font-semibold text-foreground ml-1">SmartRep × Uni AI</span>
        </div>
      </div>
    </nav>
  );
}
