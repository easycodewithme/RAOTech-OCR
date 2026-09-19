import React from "react";
import { cn } from "@/lib/utils";

export interface AnimatedButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  className?: string;
}

export const AnimatedButton = React.forwardRef<
  HTMLButtonElement,
  AnimatedButtonProps
>(({ children, className, ...props }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "group relative inline-flex items-center justify-center overflow-hidden cursor-pointer select-none",
        "rounded-full bg-[#111827] text-white border border-white/10 shadow-xs",
        "px-8 py-2.5 text-xs font-semibold tracking-wide",
        "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "hover:shadow-[0_4px_22px_-2px_rgba(37,99,235,0.45)] hover:border-blue-500/30",
        "active:scale-95 active:ring-2 active:ring-blue-400/50",
        className
      )}
      {...props}
    >
      {/* Arrow 2: Enters from left on hover */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute -left-8 w-3.5 h-3.5 fill-white z-20 opacity-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:left-4 group-hover:opacity-100"
      >
        <path d="M16.1716 10.9999L10.8076 5.63589L12.2218 4.22168L20 11.9999L12.2218 19.7781L10.8076 18.3638L16.1716 12.9999H4V10.9999H16.1716Z" />
      </svg>

      {/* Button text: Shifts slightly right on hover */}
      <span className="relative z-10 -translate-x-2 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-2 whitespace-nowrap">
        {children}
      </span>

      {/* Expanding circle ripple background in RAO AI blue theme */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#2563eb] opacity-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:w-96 group-hover:h-96 group-hover:opacity-100"
      />

      {/* Arrow 1: Exits to right on hover */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute right-4 w-3.5 h-3.5 fill-white z-20 opacity-100 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-8 group-hover:opacity-0"
      >
        <path d="M16.1716 10.9999L10.8076 5.63589L12.2218 4.22168L20 11.9999L12.2218 19.7781L10.8076 18.3638L16.1716 12.9999H4V10.9999H16.1716Z" />
      </svg>
    </button>
  );
});

AnimatedButton.displayName = "AnimatedButton";
