import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Outlet } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Contact, Home, LogOut, Plus, Settings, Upload } from "lucide-react";
import { api } from "../lib/api";
import { Button, cx, ErrorText, Input } from "./ui";
import { ContactFormDialog } from "./ContactForm";

const nav = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/contacts", label: "Contacts", icon: Contact },
  { to: "/reminders", label: "Reminders", icon: Bell },
  { to: "/import", label: "Import", icon: Upload },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Layout() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ authenticated: boolean }>("/auth/me") });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => queryClient.setQueryData(["me"], { authenticated: false });
    window.addEventListener("prm:unauthorized", onUnauthorized);
    return () => window.removeEventListener("prm:unauthorized", onUnauthorized);
  }, [queryClient]);

  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["me"], { authenticated: false });
    },
  });

  if (me.isPending) return null;
  if (me.error) return <FatalError error={me.error} />;
  if (!me.data.authenticated) return <Login />;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="sticky top-0 z-20 flex shrink-0 items-center gap-1 border-b border-zinc-200 bg-zinc-50/90 px-3 py-2 backdrop-blur md:h-dvh md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-4 dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mr-2 hidden items-center gap-2 px-2 pb-4 font-semibold md:flex">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-accent-600 text-white">◎</span>
          PRM
        </div>
        <nav className="flex flex-1 gap-1 md:flex-col">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                )
              }
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex gap-1 md:flex-col">
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">New contact</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => logout.mutate()} aria-label="Sign out">
            <LogOut className="size-4" />
            <span className="hidden md:inline">Sign out</span>
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
      <ContactFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function Login() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api("/auth/login", { method: "POST", body: { password } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="space-y-1 text-center">
          <span className="mx-auto mb-3 inline-flex size-10 items-center justify-center rounded-xl bg-accent-600 text-lg text-white">
            ◎
          </span>
          <h1 className="text-xl font-semibold">PRM</h1>
          <p className="text-sm text-zinc-500">Enter your password to continue.</p>
        </div>
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorText error={login.error} />
        <Button type="submit" variant="primary" className="w-full" disabled={!password || login.isPending}>
          Sign in
        </Button>
      </form>
    </div>
  );
}

function FatalError({ error }: { error: Error }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 text-center">
      <div className="space-y-2">
        <h1 className="font-semibold">Can't reach the server</h1>
        <ErrorText error={error} />
      </div>
    </div>
  );
}
