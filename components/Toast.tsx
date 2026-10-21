"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastCtx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((m: string) => {
    setMsg(m);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 2800);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={`toast${visible ? "" : " hide"}`} role="status" aria-live="polite">
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
