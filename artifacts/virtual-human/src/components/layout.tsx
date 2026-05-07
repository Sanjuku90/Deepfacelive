import React, { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Monitor, Users, Settings, BookOpen, ChevronDown, Menu } from "lucide-react";

const navItems = [
  { href: "/",        label: "Studio",    icon: Monitor  },
  { href: "/avatars", label: "Avatars",   icon: Users    },
  { href: "/settings",label: "Settings",  icon: Settings },
  { href: "/guide",   label: "OBS Guide", icon: BookOpen },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location]  = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const active = navItems.find(n => n.href === location) ?? navItems[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background text-foreground">

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <header className="h-14 flex-shrink-0 flex items-center px-4 gap-4 border-b border-border bg-card z-50">

        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <div className="w-7 h-7 rounded bg-primary/20 flex items-center justify-center border border-primary/50">
            <Monitor className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="font-bold font-mono tracking-tight text-sm text-primary">
            DEEPFACE<span className="text-foreground">LIVE</span>
          </span>
        </div>

        {/* Dropdown nav */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background/60 hover:bg-white/5 transition-colors text-sm font-medium"
          >
            <active.icon className="w-4 h-4 text-primary" />
            <span>{active.label}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="absolute top-full left-0 mt-1.5 w-44 rounded-lg border border-border bg-card shadow-2xl shadow-black/40 overflow-hidden z-50">
              {navItems.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                    data-testid={`link-nav-${item.label.toLowerCase()}`}
                  >
                    <item.icon className="w-4 h-4" />
                    <span className="font-medium">{item.label}</span>
                    {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Status badge */}
        <div className="text-xs font-mono text-muted-foreground">
          SYS.STATUS <span className="text-emerald-500">ONLINE</span>
        </div>
      </header>

      {/* ── Page content ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-0">
        {children}
      </div>
    </div>
  );
}
