import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kaya: SG Tax Optimizer",
  description:
    "Singapore household tax optimizer: CPF MA/SA cash top-ups and SRS contributions, with the effective tax rate under at-retirement drawdown and early-withdrawal scenarios.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><TooltipProvider delay={200}>{children}</TooltipProvider></body>
    </html>
  );
}
