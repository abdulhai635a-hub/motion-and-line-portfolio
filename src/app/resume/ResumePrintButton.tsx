"use client";

export default function ResumePrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-105 print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
