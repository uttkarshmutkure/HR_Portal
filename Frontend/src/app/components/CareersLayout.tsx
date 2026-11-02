import { ReactNode } from 'react';
import { Link } from 'react-router';
import AtgeirLogo from './AtgeirLogo';

// Public shell: no AuthContext, no sidebar, no HR chat widget.
export default function CareersLayout({ children }: { children: ReactNode }) {
  return (
    // Explicit bg/text so a saved dark-mode preference from the HR portal never leaks in here.
    <div className="flex min-h-screen flex-col bg-[#F6F7FA] font-[Inter,sans-serif] text-[#050C26]">
      <header className="sticky top-0 z-30 border-b border-[#1C2951] bg-[#050C26]/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/careers" className="flex items-center gap-3 rounded-md text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#F26522]" aria-label="Atgeir Solutions careers home">
            <img src="/company-logo1.png" alt="Atgeir Solutions" className="h-9 w-auto object-contain" />
            <span className="hidden h-5 w-px bg-[#1C2951] sm:block" />
            <span className="hidden text-sm text-[#D1D3D4] sm:block">Careers</span>
          </Link>
          <a
            href="https://www.atgeirsolutions.com"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-2 py-1 text-sm text-[#D1D3D4] transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F26522]"
          >
            About Atgeir
          </a>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[#E3E6EB] bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-6 text-[13px] text-[#5B6272] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} Atgeir Solutions. All rights reserved.</span>
          <span>You do not need an account to apply.</span>
        </div>
      </footer>
    </div>
  );
}
