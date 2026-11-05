import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../types";

export function useConnectionForm(settings: AppSettings) {
  const [login, setLogin] = useState({ host: "", port: "554", username: "admin", password: "" });
  const [rememberPassword, setRememberPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    setRememberPassword(settings.rememberPassword);
    if (settings.host) setLogin((current) => ({ ...current, host: settings.host ?? "", port: String(settings.port || 554), username: settings.username ?? "admin" }));
  }, [settings.host, settings.port, settings.rememberPassword, settings.username]);
  return { login, setLogin, rememberPassword, setRememberPassword, showPassword, setShowPassword, showHint, setShowHint, formRef };
}
