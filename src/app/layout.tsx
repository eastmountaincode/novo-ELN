import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { NovoInstanceProvider } from "@/components/NovoInstanceProvider";
import { getNovoBrand } from "@/lib/novoInstance";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const { wordmark } = getNovoBrand();

  return {
    title: wordmark,
    description: "Electronic lab notebook.",
    openGraph: {
      title: wordmark,
      description: "Electronic lab notebook.",
    },
    twitter: {
      card: "summary",
      title: wordmark,
      description: "Electronic lab notebook.",
    },
    icons: {
      icon: [
        { url: "/favicon.ico" },
        { url: "/icon.png", type: "image/png", sizes: "512x512" },
      ],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const { instance, wordmark, deploymentLabel } = getNovoBrand();

  return (
    <html lang="en" data-novo-instance={instance} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <NovoInstanceProvider wordmark={wordmark} deploymentLabel={deploymentLabel}>
          {children}
        </NovoInstanceProvider>
      </body>
    </html>
  );
}
