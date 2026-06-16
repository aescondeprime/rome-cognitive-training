import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Swords,
  ScrollText,
  BookMarked,
  User,
  Users,
  Brain,
  FlaskConical,
  Feather,
  Settings,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const NAV = [
  { href: "/",            icon: LayoutDashboard, label: "Command Center" },
  { href: "/training",    icon: Swords,          label: "Athena Trials"  },
  { href: "/scenarios",   icon: ScrollText,      label: "Scenarios"       },
  { href: "/vault",       icon: BookMarked,      label: "Memory Vault"    },
  { href: "/memory",      icon: Brain,           label: "Memory Archive"  },
  { href: "/philosophy",  icon: Feather,         label: "Philosophy"      },
  { href: "/profile",     icon: User,            label: "My Profile"      },
  { href: "/profiles",    icon: Users,           label: "Profiles"        },
  { href: "/research",    icon: FlaskConical,    label: "Research"        },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useHashLocation();
  const { data: user } = useQuery<any>({ queryKey: ["/api/user"] });
  const { data: activeProfile } = useQuery<any>({ queryKey: ["/api/active-profile"] });

  return (
    <div className="flex h-full relative">
      {/* Sidebar */}
      <nav
        className="rome-sidebar flex flex-col w-[200px] shrink-0 h-full overflow-y-auto py-5"
        aria-label="Main navigation"
      >
        {/* ROME wordmark */}
        <div className="px-5 mb-8">
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer group">
              {/* Laurel SVG icon */}
              <svg
                width="28" height="28" viewBox="0 0 28 28" fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className="shrink-0"
              >
                <circle cx="14" cy="14" r="12" stroke="hsl(43,88%,55%)" strokeWidth="1.2" fill="none"/>
                {/* Laurel left */}
                <path d="M7 14 C5 11 6 8 9 8 C8 11 8 13 10 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
                <path d="M7 14 C5 16 6 19 9 19 C8 16 8 15 10 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
                {/* Laurel right */}
                <path d="M21 14 C23 11 22 8 19 8 C20 11 20 13 18 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
                <path d="M21 14 C23 16 22 19 19 19 C20 16 20 15 18 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
                {/* Center column */}
                <rect x="13" y="9" width="2" height="10" rx="1" fill="hsl(43,88%,55%)" opacity="0.7"/>
              </svg>
              <span
                className="text-lg font-roman font-bold gold-shimmer tracking-[0.12em]"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                ROME
              </span>
            </div>
          </Link>
        </div>

        {/* Nav items */}
        <div className="flex-1 flex flex-col gap-0.5 px-3">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = location === href || (href !== "/" && location.startsWith(href));
            return (
              <Link key={href} href={href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 group",
                    active
                      ? "bg-gold-500/8 text-gold-400 border border-gold-500/15 border-l-[2px] border-l-[hsl(0_50%_35%/0.7)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-cave-750/80"
                  )}
                >
                  <Icon
                    className={cn(
                      "w-4 h-4 shrink-0 transition-colors",
                      active ? "text-gold-400" : "text-muted-foreground group-hover:text-gold-400/70"
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs transition-colors",
                      active ? "font-roman font-semibold tracking-wider" : "font-medium"
                    )}
                    style={active ? { fontFamily: "'Cinzel', serif", letterSpacing: "0.08em" } : {}}
                  >
                    {label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Roman meander divider above bottom section */}
        <div className="mx-3 mt-4 mb-1 rome-meander-crimson opacity-60" />

        {/* Bottom — user + mode toggle */}
        <div className="px-3 space-y-1">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-cave-750/80 cursor-pointer transition-all group">
            <Settings className="w-4 h-4 shrink-0 group-hover:text-gold-400/70 transition-colors" />
            <Link href="/settings">
              <span className="text-xs font-medium">Settings</span>
            </Link>
          </div>
          {/* Active profile indicator */}
          {activeProfile && (
            <div className="px-3 py-1.5">
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-0.5">Profile</p>
              <p
                className="text-xs text-gold-400/80 font-semibold truncate"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                {activeProfile.name}
              </p>
            </div>
          )}
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
            <div className="w-5 h-5 rounded-full bg-gold-600/30 border border-gold-500/30 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-roman font-bold text-gold-400">
                {(user?.name || "T")[0].toUpperCase()}
              </span>
            </div>
            <span className="text-xs text-muted-foreground font-medium truncate">
              {user?.name || "Trainee"}
            </span>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden">
        <div className="min-h-full p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
