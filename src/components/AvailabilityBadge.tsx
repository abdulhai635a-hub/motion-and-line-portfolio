import { availability } from "@/lib/data";

export default function AvailabilityBadge({ compact = false }: { compact?: boolean }) {
  const isOpen = availability.status === "open";

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-border ${
        compact ? "px-3 py-1 text-xs" : "px-4 py-2 text-sm"
      } font-medium`}
      title={availability.note}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${
            isOpen ? "bg-teal" : "bg-coral"
          } opacity-75`}
        />
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            isOpen ? "bg-teal" : "bg-coral"
          }`}
        />
      </span>
      {isOpen ? "Open for freelance" : "Currently booked"}
    </div>
  );
}
