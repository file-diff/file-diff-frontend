export interface NavRoute {
  /** Path used by the React Router Link. */
  path: string;
  /** Whether this nav entry uses a plain anchor instead of a Link. */
  external?: boolean;
  /** Label displayed in the navigation menu. */
  label: string;
  /** Title displayed in the top bar when this route is active. */
  title?: string;
}

export const NAV_ROUTES: NavRoute[] = [
  { path: "/", label: "📂 Directory Compare", title: "📂 Directory Compare" },
  { path: "/files", label: "📄 File Compare", title: "📄 File Compare" },
  { path: "/history", label: "📜 History", title: "📜 History" },
  { path: "/commits", label: "🔀 Commits", title: "🔀 Commits" },
  { path: "/repository", label: "🗂️ Repository", title: "🗂️ Repository View" },
  { path: "/branches", label: "🌿 Branches", title: "🌿 Branches" },
  { path: "/tags", label: "🏷️ Tags", title: "🏷️ Tags" },
  { path: "/actions", label: "⚙️ Actions", title: "⚙️ Actions" },
  { path: "/browse", label: "🏢 Browse Org", title: "🏢 Browse Org" },
  { path: "/create-task", label: "🤖 Create Task", title: "🤖 Create Task" },
  { path: "/agent-tasks", label: "📋 Agent Tasks", title: "📋 Agent Tasks" },
  { path: "/tokenize", label: "🎨 Tokenize", title: "🎨 Tokenize" },
  { path: "/grep", label: "🔎 Grep", title: "🔎 Grep" },
  { path: "/health", label: "🩺 Backend Check", title: "🩺 Backend Check" },
  { path: "/pelican", label: "🚲 Pelican Ride", title: "🚲 Pelican Ride" },
  {
    path: "/ssr-health",
    label: "🖥️ SSR Health",
    title: "🖥️ SSR Health",
    external: true,
  },
];

export function findNavRouteTitle(pathname: string): string | undefined {
  const match = NAV_ROUTES.find((r) => r.path === pathname);
  return match?.title;
}
