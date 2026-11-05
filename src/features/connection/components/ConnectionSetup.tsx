import type { FormEventHandler, RefObject } from "react";
import {
  Check,
  CircleHelp,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  MonitorPlay,
  Play,
  ShieldCheck,
  Signal,
  SignalZero,
  Video,
  X,
} from "lucide-react";
import type { AppSettings } from "../types";

interface LoginDetails {
  host: string;
  port: string;
  username: string;
  password: string;
}

interface ConnectionSetupProps {
  desktop: boolean;
  settings: AppSettings;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  connectionError: string;
  isConnecting: boolean;
  login: LoginDetails;
  setLogin: (login: LoginDetails) => void;
  rememberPassword: boolean;
  setRememberPassword: (remember: boolean) => void;
  showPassword: boolean;
  setShowPassword: (show: boolean | ((visible: boolean) => boolean)) => void;
  showHint: boolean;
  setShowHint: (show: boolean | ((visible: boolean) => boolean)) => void;
  formRef: RefObject<HTMLFormElement | null>;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

export default function ConnectionSetup({
  desktop,
  settings,
  showSettings,
  setShowSettings,
  connectionError,
  isConnecting,
  login,
  setLogin,
  rememberPassword,
  setRememberPassword,
  showPassword,
  setShowPassword,
  showHint,
  setShowHint,
  formRef,
  onSubmit,
}: ConnectionSetupProps) {
  return (
    <main className="setup-shell">
      <header className="setup-topbar">
        <div className="brand-mark"><Video size={17} strokeWidth={2.3} /></div>
        <span className="brand-name">Local Cam</span>
        <span className="topbar-separator" />
        <span className="topbar-current">{showSettings ? "Recorder settings" : "First-time setup"}</span>
        {showSettings && <button className="icon-button topbar-close" onClick={() => setShowSettings(false)} aria-label="Close settings"><X size={18} /></button>}
      </header>
      <section className="setup-content">
        <div className="setup-copy">
          <div className="setup-symbol"><MonitorPlay size={22} /></div>
          <h1>{settings.configured ? "Connect to your recorder" : "Set up your recorder"}</h1>
          <p>Connect on your local network. Your camera video and saved preferences stay on this computer.</p>
        </div>
        <form ref={formRef} className="connect-form" onSubmit={onSubmit}>
          <label className="field-label" htmlFor="recorder-ip">Recorder IP address</label>
          <div className="input-with-icon"><Signal size={16} /><input id="recorder-ip" autoFocus required inputMode="url" placeholder="192.168.1.100" value={login.host} onChange={(e) => setLogin({ ...login, host: e.target.value })} /></div>
          <div className="field-row">
            <div className="field-group">
              <label className="field-label" htmlFor="rtsp-port">RTSP port</label>
              <input id="rtsp-port" required type="number" min="1" max="65535" value={login.port} onChange={(e) => setLogin({ ...login, port: e.target.value })} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="recorder-user">Username</label>
              <input id="recorder-user" required autoComplete="username" value={login.username} onChange={(e) => setLogin({ ...login, username: e.target.value })} />
            </div>
          </div>
          <label className="field-label" htmlFor="recorder-password">Password</label>
          <div className="password-field">
            <LockKeyhole size={16} />
            <input id="recorder-password" required type={showPassword ? "text" : "password"} autoComplete="current-password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} />
            <button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          <label className="remember-row">
            <input type="checkbox" checked={rememberPassword} onChange={(e) => setRememberPassword(e.target.checked)} />
            <span className="custom-check"><Check size={12} /></span>
            <span>Remember password for 30 days</span>
            <button type="button" className="hint-button" onClick={() => setShowHint((visible) => !visible)} aria-label="About saved passwords"><CircleHelp size={15} /></button>
          </label>
          {showHint && <p className="hint-copy">When selected, the password is kept in your operating system’s credential store. It is never saved in the app’s SQLite settings file.</p>}
          {connectionError && <div className="form-error" role="alert"><SignalZero size={16} /><span>{connectionError}</span></div>}
          <button className="primary-button connect-button" type="submit" disabled={isConnecting || !desktop}>
            {isConnecting ? <LoaderCircle className="spin" size={17} /> : <Play size={16} fill="currentColor" />}
            {isConnecting ? "Connecting…" : "Connect and open Live"}
          </button>
          <div className="security-note"><ShieldCheck size={15} /><span>Local connection · no cloud account</span></div>
        </form>
        {!desktop && <div className="runtime-notice">Browser preview only. To connect to a recorder, run <code>npm run tauri dev</code> in a terminal to open the Local Cam desktop app.</div>}
      </section>
    </main>
  );
}
