import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { NAV_ROUTES } from "../config/navRoutes";
import "./NavMenu.css";

export default function NavMenu() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const node = containerRef.current;
      if (node && !node.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div className="nav-menu" ref={containerRef}>
      <button
        type="button"
        className="nav-menu__toggle"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        ☰
      </button>
      {open && (
        <div className="nav-menu__popup" role="menu">
          {NAV_ROUTES.map((route) => {
            const isActive = location.pathname === route.path;
            const className =
              "nav-menu__item" +
              (isActive ? " nav-menu__item--active" : "");
            if (route.external) {
              return (
                <a
                  key={route.path}
                  href={route.path}
                  className={className}
                  role="menuitem"
                  onClick={close}
                >
                  {route.label}
                </a>
              );
            }
            return (
              <Link
                key={route.path}
                to={route.path}
                className={className}
                role="menuitem"
                onClick={close}
              >
                {route.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
