import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hack to the Future",
  description: "Natural-language voicebot analytics powered by SmartRep × Uni AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body
        className={`${inter.className} h-full overflow-hidden bg-background text-foreground antialiased`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
