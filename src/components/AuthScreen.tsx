import { useState } from "react";
import { extractReferralCode, login, register, type AuthUser } from "@/lib/auth-supabase";

type Mode = "login" | "register";

type Props = {
  onAuth: (user: AuthUser) => void;
};

export default function AuthScreen({ onAuth }: Props) {
  const initialReferralCode =
    typeof window === "undefined" ? "" : (extractReferralCode(window.location.href) ?? "");
  const [mode, setMode] = useState<Mode>(initialReferralCode ? "register" : "login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [referral, setReferral] = useState(initialReferralCode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setPassword("");
    setPassword2("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "register") {
        if (password !== password2) {
          setError("Parollar gabat gelenok");
          return;
        }
        const res = await register(name, phone, password, referral);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onAuth(res.user);
        return;
      }
      const res = await login(phone, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onAuth(res.user);
    } catch (error) {
      console.error("Authentication request failed:", error);
      setError("Häzirki wagtda girip bolmady. Internet birikmesini barlap, täzeden synanyşyň.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="game-shell relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mt-6 text-center">
        <p className="brand-title text-4xl text-foreground">
          MONEY<span className="text-primary"> BLAST</span>
        </p>
        <p className="mt-3 text-sm font-semibold text-muted-foreground">
          {mode === "login" ? "Oýnamak üçin registrasiýa ediň" : "Akkaunt düzmek"}
        </p>
      </div>

      <div className="mx-auto mt-8 flex w-full max-w-sm rounded-2xl bg-[oklch(0.18_0.02_240_/_60%)] p-1">
        <button
          type="button"
          className={`auth-tab ${mode === "login" ? "auth-tab-active" : ""}`}
          onClick={() => switchMode("login")}
        >
          Girmek
        </button>
        <button
          type="button"
          className={`auth-tab ${mode === "register" ? "auth-tab-active" : ""}`}
          onClick={() => switchMode("register")}
        >
          Registrasiýa
        </button>
      </div>

      <form className="mx-auto mt-6 flex w-full max-w-sm flex-col gap-3" onSubmit={submit}>
        {mode === "register" && (
          <label className="auth-field">
            <span>Ady</span>
            <input
              className="auth-input"
              type="text"
              autoComplete="name"
              placeholder="Aman,Resul,Abdy"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              required
            />
          </label>
        )}

        <label className="auth-field">
          <span>Telefon nomery</span>
          <input
            className="auth-input"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+99365 00 00 00"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </label>

        <label className="auth-field">
          <span>Parol</span>
          <input
            className="auth-input"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="iň azyndan 8 simwol"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>

        {mode === "register" && (
          <label className="auth-field">
            <span>Paroly täzeden ýazyň</span>
            <input
              className="auth-input"
              type="password"
              autoComplete="new-password"
              placeholder="Ýene bir gezek"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              required
              minLength={8}
            />
          </label>
        )}

        {mode === "register" && (
          <label className="auth-field">
            <span>Çakylyk linki ýa-da kody (islege görä)</span>
            <input
              className="auth-input"
              type="text"
              autoComplete="off"
              placeholder="https://.../?ref=..."
              value={referral}
              onChange={(e) => setReferral(e.target.value)}
              maxLength={300}
            />
          </label>
        )}

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button className="btn-primary btn-pulse mt-4 w-full" type="submit" disabled={busy}>
          {busy ? "Garaşýaň…" : mode === "login" ? "Girmek" : "Registrilenmek"}
        </button>
      </form>

      <p className="mx-auto mt-auto max-w-xs pt-10 text-center text-xs leading-relaxed text-muted-foreground">
        Made with ❤ by Resul Sopyyev
      </p>
    </div>
  );
}
