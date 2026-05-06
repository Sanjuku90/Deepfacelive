import React from "react";
import { Link, useLocation } from "wouter";
import { Monitor, Users, Settings, BookOpen } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Studio", icon: Monitor },
    { href: "/avatars", label: "Avatars", icon: Users },
    { href: "/settings", label: "Settings", icon: Settings },
    { href: "/guide", label: "OBS Guide", icon: BookOpen },
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/50">
              <Monitor className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold font-mono tracking-tight text-primary">DEEPFACE<span className="text-foreground">LIVE</span></span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-2">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
                }`}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
              >
                <item.icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
        
        <div className="p-4 border-t border-border">
          <div className="text-xs text-muted-foreground font-mono">
            SYS.STATUS <span className="text-emerald-500">ONLINE</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden relative z-0">
        {children}
      </div>
    </div>
  );
}
