"use client";

import { useEffect, useState } from "react";

export type Os = "windows" | "macos" | "android" | "ios" | "linux" | "other";

/** Detect the visitor's OS from the user agent. Returns "other" on the
 *  server (and until the client hydrates). */
export function useOsDetect(): Os {
  const [os, setOs] = useState<Os>("other");

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (/android/.test(ua)) setOs("android");
    else if (/iphone|ipad|ipod/.test(ua)) setOs("ios");
    else if (/win/.test(ua)) setOs("windows");
    else if (/mac/.test(ua)) setOs("macos");
    else if (/linux/.test(ua)) setOs("linux");
    else setOs("other");
  }, []);

  return os;
}
