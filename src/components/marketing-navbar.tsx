"use client";

import Link from "next/link";
import { useState } from "react";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { ChevronRight, Menu, X } from "lucide-react";

import { InteractiveHoverButton } from "@/registry/magicui/interactive-hover-button";

export default function MarketingNavbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="text-xl font-bold tracking-tight text-foreground">
              RAO AI
            </span>
          </Link>

          <nav className="hidden items-center gap-7 text-[13.5px] font-semibold text-foreground/80 md:flex">
            <Link href="/#platform" className="transition-colors hover:text-foreground">
              Platform
            </Link>
            <Link href="/#problem-solution" className="transition-colors hover:text-foreground">
              Overview
            </Link>
            <Link href="/#testimonials" className="transition-colors hover:text-foreground">
              Testimonials
            </Link>
            <Link href="/#faq" className="transition-colors hover:text-foreground">
              FAQ
            </Link>
            <Link href="/pricing" className="transition-colors hover:text-foreground">
              Pricing
            </Link>
          </nav>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/book-your-demo"
            className="hidden rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-foreground shadow-xs transition-all hover:bg-secondary sm:inline-flex"
          >
            Book a Demo
          </Link>

          <SignedOut>
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <InteractiveHoverButton className="px-5 py-2 text-xs shadow-xs">
                Try RAO AI
              </InteractiveHoverButton>
            </SignInButton>
          </SignedOut>

          <SignedIn>
            <Link href="/dashboard">
              <InteractiveHoverButton className="px-5 py-2 text-xs shadow-xs">
                Dashboard
              </InteractiveHoverButton>
            </Link>
          </SignedIn>

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground md:hidden"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="border-t border-border bg-background/95 backdrop-blur-md px-4 py-4 shadow-xl md:hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <nav className="flex flex-col space-y-1">
            {[
              { href: "/#platform", label: "Platform" },
              { href: "/#problem-solution", label: "Overview" },
              { href: "/#results", label: "Results" },
              { href: "/#testimonials", label: "Testimonials" },
              { href: "/#faq", label: "FAQ" },
              { href: "/pricing", label: "Pricing" },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary transition-colors"
              >
                <span>{item.label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </a>
            ))}
          </nav>

          <div className="mt-4 border-t border-border pt-4 flex flex-col gap-2.5">
            <Link
              href="/book-your-demo"
              onClick={() => setMobileMenuOpen(false)}
              className="w-full flex items-center justify-center rounded-full border border-border bg-card py-2.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-secondary transition-colors"
            >
              Book a Demo
            </Link>
            <SignedOut>
              <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                <InteractiveHoverButton className="w-full py-2.5 text-xs shadow-xs justify-center">
                  Try RAO AI
                </InteractiveHoverButton>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)} className="w-full">
                <InteractiveHoverButton className="w-full py-2.5 text-xs shadow-xs justify-center">
                  Go to Dashboard
                </InteractiveHoverButton>
              </Link>
            </SignedIn>
          </div>
        </div>
      )}
    </header>
  );
}
