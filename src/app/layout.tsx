import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
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

function getMetadataBase(requestHeaders: Headers): URL {
  const host =
    requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol =
    forwardedProtocol || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");

  try {
    return new URL(`${protocol}://${host}`);
  } catch {
    return new URL("http://localhost:3000");
  }
}

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const requestHeaders = await headers();
  const { wordmark } = getNovoBrand();
  const metadataBase = getMetadataBase(requestHeaders);
  const socialImage = {
    url: new URL("/api/opengraph-image", metadataBase),
    width: 1200,
    height: 630,
    alt: "Novo electronic lab notebook",
  };

  return {
    metadataBase,
    title: wordmark,
    description: "Electronic lab notebook.",
    openGraph: {
      title: wordmark,
      description: "Electronic lab notebook.",
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title: wordmark,
      description: "Electronic lab notebook.",
      images: [socialImage],
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
