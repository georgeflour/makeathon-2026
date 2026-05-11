import Link from "next/link";
import { Rocket } from "lucide-react";

export function Navbar() {
  return (
    <nav className="w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center justify-between px-4 sm:px-8">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <Link href="/" className="font-bold text-lg tracking-tight">
            Starter<span className="text-primary">App</span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Link href="https://github.com" target="_blank" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
            GitHub
          </Link>
          <Link href="/docs" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
            Docs
          </Link>
        </div>
      </div>
    </nav>
  );
}
