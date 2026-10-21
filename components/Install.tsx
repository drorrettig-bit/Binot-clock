"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/* ---------- זיהוי מצב ההתקנה ---------- */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** נטען פעם אחת בשורש האפליקציה: רושם service worker ותופס את הצעת ההתקנה של הדפדפן */
export function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onPrompt = (e: Event) => {
      e.preventDefault(); // נציג את ההצעה בעצמנו, בזמן הנכון
      deferred = e as BeforeInstallPromptEvent;
      emit();
    };
    const onInstalled = () => {
      deferred = null;
      emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function useCanPrompt(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => deferred !== null,
    () => false,
  );
}

const ASKED_KEY = "install-asked-v1";
const getAsked = () => {
  try { return localStorage.getItem(ASKED_KEY) === "1"; } catch { return false; }
};
const setAsked = () => {
  try { localStorage.setItem(ASKED_KEY, "1"); } catch {}
};

/* ---------- החלון: "להוסיף למסך הבית?" ---------- */

type Mode = "ask" | "ios" | "manual";

export function InstallSheet({ open, onClose, onInstalled }: { open: boolean; onClose: () => void; onInstalled: () => void }) {
  useCanPrompt(); // מתעדכן כשהדפדפן מציע התקנה
  const [mode, setMode] = useState<Mode>("ask");

  useEffect(() => {
    if (open) setMode("ask");
  }, [open]);

  if (!open) return null;

  async function yes() {
    setAsked();
    if (deferred) {
      const ev = deferred;
      await ev.prompt();
      const choice = await ev.userChoice;
      deferred = null;
      emit();
      if (choice.outcome === "accepted") onInstalled();
      onClose();
      return;
    }
    setMode(isIOS() ? "ios" : "manual");
  }

  function later() {
    setAsked();
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={later}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="app-icon">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={40} height={40} />
          </span>
          <h2 id="install-title">
            {mode === "ask" ? "להוסיף את שעון הנוכחות למסך הבית?" : "עוד שני צעדים קטנים"}
          </h2>
        </div>

        {mode === "ask" && (
          <>
            <p className="lead">ככה פותחים את האפליקציה בלחיצה אחת, כמו כל אפליקציה אחרת, ונשארים מחוברים תמיד.</p>
            <div className="sheet-actions">
              <button className="primary-btn press" onClick={yes}>כן, להוסיף</button>
              <button className="btn press" onClick={later}>לא עכשיו</button>
            </div>
          </>
        )}

        {mode === "ios" && (
          <>
            <ol className="steps">
              <li>
                לוחצים על כפתור השיתוף
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="כפתור שיתוף">
                  <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
                </svg>
                בשורת הדפדפן (בתחתית או בראש המסך)
              </li>
              <li>גוללים ובוחרים <b>&quot;הוספה למסך הבית&quot;</b>, ואז <b>&quot;הוספה&quot;</b></li>
            </ol>
            <p className="help">ב-iPhone אין לאפליקציות אינטרנט אפשרות להוסיף את עצמן אוטומטית, לכן זה נעשה בשתי לחיצות.</p>
            <div className="sheet-actions"><button className="btn press" onClick={onClose}>הבנתי</button></div>
          </>
        )}

        {mode === "manual" && (
          <>
            <ol className="steps">
              <li>פותחים את תפריט הדפדפן <b>⋮</b> (בדרך כלל בפינה העליונה)</li>
              <li>בוחרים <b>&quot;התקנת אפליקציה&quot;</b> או <b>&quot;הוספה למסך הבית&quot;</b></li>
            </ol>
            <p className="help">אם האפשרות לא מופיעה, כדאי לפתוח את האתר ב-Chrome.</p>
            <div className="sheet-actions"><button className="btn press" onClick={onClose}>הבנתי</button></div>
          </>
        )}
      </div>
    </div>
  );
}

/** מנהל מתי לשאול: פעם אחת אחרי ההתחברות הראשונה, ורק אם האפליקציה עוד לא מותקנת */
export function useInstallOffer(ready: boolean) {
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    const standalone = isStandalone();
    setInstalled(standalone);
    if (!ready || standalone || getAsked()) return;
    const t = setTimeout(() => setOpen(true), 900); // נותנים למסך להיטען לפני שקופץ חלון
    return () => clearTimeout(t);
  }, [ready]);

  return { open, setOpen, installed, markInstalled: () => setInstalled(true) };
}
