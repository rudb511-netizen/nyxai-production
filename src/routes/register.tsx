import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Wordmark } from "@/components/kchat/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { compressImage } from "@/lib/kchat/media-client";
import { completeOnboarding } from "@/lib/kchat/server/profiles";
import { usernameError, validateUsername } from "@/lib/kchat/usernames";
import { passwordIssue } from "@/lib/kchat/password-policy";
import { noteAuthSuccess } from "@/lib/kchat/server/security";

export const Route = createFileRoute("/register")({ component: Register });

function Register() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    email: "",
    password: "",
    confirm: "",
    username: "",
    displayName: "",
    gender: "" as "" | "male" | "female",
    dob: "",
    bio: "",
  });
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const issue = validateUsername(form.username);
    if (issue) return toast.error(usernameError(issue));
    const pw = passwordIssue(form.password, form.email);
    if (pw) return toast.error(pw);
    if (form.password !== form.confirm) return toast.error("Passwords do not match.");
    if (form.gender !== "male" && form.gender !== "female") {
      return toast.error("Select Male or Female.");
    }
    if (!form.dob) return toast.error("Enter your date of birth.");
    setBusy(true);
    try {
      const { error } = await authClient.signUp.email({
        email: form.email,
        password: form.password,
        name: form.displayName.trim(),
      });
      if (error) throw new Error(error.message ?? "Could not create account.");
      await completeOnboarding({
        data: {
          username: form.username,
          displayName: form.displayName.trim(),
          gender: form.gender,
          dateOfBirth: form.dob,
          bio: form.bio,
          avatarUrl: avatar,
        },
      });
      await noteAuthSuccess().catch(() => {});
      nav({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="kc-auth-shell px-6 py-10">
      <div className="kc-auth-card mx-auto max-w-md">
      <Wordmark />
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-muted">Pick a username people can find you with.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label>Profile photo</Label>
          <div className="flex items-center gap-3">
            <div className="size-16 overflow-hidden rounded-full bg-elevated">
              {avatar ? <img src={avatar} alt="" className="size-full object-cover" /> : null}
            </div>
            <Input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const c = await compressImage(f, { maxEdge: 640, maxBytes: 180_000 });
                  setAvatar(c.dataUrl);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not use that photo.");
                }
              }}
            />
          </div>
        </div>
        <Field label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} autoComplete="email" />
        <Field label="Password" type="password" value={form.password} onChange={(v) => set("password", v)} autoComplete="new-password" />
        <p className="-mt-2 text-xs text-muted">At least 10 characters, with letters and numbers.</p>
        <Field label="Confirm password" type="password" value={form.confirm} onChange={(v) => set("confirm", v)} autoComplete="new-password" />
        <Field label="Username" value={form.username} onChange={(v) => set("username", v)} placeholder="yourname" />
        <Field label="Display name" value={form.displayName} onChange={(v) => set("displayName", v)} />
        <div className="space-y-1.5">
          <Label>Gender</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["male", "female"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => set("gender", g)}
                className={`h-11 rounded-xl border text-sm font-medium capitalize ${
                  form.gender === g ? "border-accent bg-accent/10 text-fg" : "border-border text-muted"
                }`}
              >
                {g === "male" ? "Male" : "Female"}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dob">Date of birth</Label>
          <Input id="dob" type="date" required value={form.dob} onChange={(e) => set("dob", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bio">Bio (optional)</Label>
          <Textarea id="bio" maxLength={160} value={form.bio} onChange={(e) => set("bio", e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-fg underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        required
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
