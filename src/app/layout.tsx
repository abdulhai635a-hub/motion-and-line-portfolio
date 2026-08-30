import type { Metadata } from "next";
import { Fredoka, Inter } from "next/font/google";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import StickmanGreeter from "@/components/StickmanGreeter";
import "./globals.css";

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Motion & Line — 2D Animator Portfolio",
    template: "%s — Motion & Line",
  },
  description:
    "2D animator & motion designer specializing in character animation, explainers, and motion graphics. A portfolio that performs, not just displays.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fredoka.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
        <StickmanGreeter />
      </body>
    </html>
  );
}
