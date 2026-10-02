import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useState } from "react";
import { Toaster } from "sonner";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { ThemeBoot } from "@/components/kchat/theme";
import { StartupSplash } from "@/components/kchat/startup-splash";
import { NativeRuntime } from "@/components/kchat/native-runtime";
import { AuthProvider } from "@/lib/auth/provider";
import appCss from "../styles.css?url";

const APP_NAME = "NYX";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" },
      { title: APP_NAME },
      { name: "theme-color", content: "#07090f" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "referrer", content: "strict-origin-when-cross-origin" },
      { name: "robots", content: "index, follow" },
      { name: "googlebot", content: "index, follow" },
      {
        name: "description",
        content: "NYX is a social network for posts, Flashes, stories, Atlas, live, and NYXAI.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 12_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <html lang="en" className="dark antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <PreviewHostBridge />
        <ThemeBoot />
        <QueryClientProvider client={client}>
          <AuthProvider>
            <NativeRuntime />
            <StartupSplash ready />
            <Outlet />
            <Toaster
              theme="system"
              position="top-center"
              toastOptions={{
                className: "bg-surface text-fg border-border",
              }}
            />
          </AuthProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
