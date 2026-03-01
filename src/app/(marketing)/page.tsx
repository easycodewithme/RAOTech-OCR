import Link from "next/link";
import { Button } from "@/components/ui/button"; // Run: npx shadcn@latest add button
import { ArrowRight, BarChart3, FileText, Zap } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Navbar */}
      <header className="px-4 lg:px-6 h-14 flex items-center border-b">
        <Link className="flex items-center justify-center font-bold text-xl" href="#">
          RAO AI
        </Link>
        <nav className="ml-auto flex gap-4 sm:gap-6">
          <Link href="/dashboard">
            <Button>Login / Get Started</Button>
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48 bg-gray-50">
          <div className="container px-4 md:px-6 mx-auto text-center">
            <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl">
              Manage Invoices with <span className="text-blue-600">AI Precision</span>
            </h1>
            <p className="mx-auto mt-4 max-w-[700px] text-gray-500 md:text-xl">
              Upload bulk invoices, extract data automatically, and chat with your financial data using our RAG-powered AI.
            </p>
            <div className="mt-8">
              <Link href="/dashboard">
                <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                  Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="w-full py-12 md:py-24 lg:py-32">
          <div className="container px-4 md:px-6 mx-auto grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col items-center text-center space-y-2">
              <FileText className="h-10 w-10 text-blue-500" />
              <h2 className="text-xl font-bold">Smart OCR</h2>
              <p className="text-gray-500">Auto-extract details from PDF, PNG, or Zip files instantly.</p>
            </div>
            <div className="flex flex-col items-center text-center space-y-2">
              <Zap className="h-10 w-10 text-blue-500" />
              <h2 className="text-xl font-bold">AI Chatbot</h2>
              <p className="text-gray-500">Ask questions like "What was my total sales last October?"</p>
            </div>
            <div className="flex flex-col items-center text-center space-y-2">
              <BarChart3 className="h-10 w-10 text-blue-500" />
              <h2 className="text-xl font-bold">Analytics</h2>
              <p className="text-gray-500">Visual dashboards for Monthly and Yearly sales trends.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}