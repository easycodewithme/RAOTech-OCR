import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { PerfLogger } from '@/components/PerfLogger'
import { ThemeProvider } from 'next-themes'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'RAO AI - Invoice Management',
  description: 'AI-Powered Invoice Extraction and Analytics',
}

const publishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  (process.env.NODE_ENV === 'production'
    ? 'pk_test_dHVtbXktZHVtbXktMDAuY2xlcmsuYWNjb3VudHMuZGV2JA'
    : '');

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
          >
            <PerfLogger />
            {children}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}