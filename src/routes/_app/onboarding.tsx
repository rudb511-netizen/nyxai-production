import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Wordmark } from "@/components/kchat/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { useMeQuery } from "@/lib/kchat/hooks";
import { NYX_INTERESTS } from "@/lib/kchat/platform";
import { compressImage } from "@/lib/kchat/media-client";
import { completeOnboarding } from "@/lib/kchat/server/profiles";
import { saveInterests } from "@/lib/kchat/server/platform";

export const Route = createFileRoute("/_app/onboarding")({ component: Onboarding });

function Onboarding() {
  const nav = useNavigate();
  const me = useMeQuery();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [dob, setDob] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [interests, setInterests] = useState<string[]>([]);

  useEffect(() => {
    if (!me.data) return;
    setUsername((v) => v || me.data.username);
    setDisplayName((v) => v || me.data.displayName);
    setGender((v) => v || me.data.gender || "");
    setDob((v) => v || me.data.dateOfBirth || "");
    setBio((v) => v || me.data.bio || "");
    setAvatar((v) => v || me.data.avatarUrl);
  }, [me.data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (gender !== "male" && gender !== "female") return toast.error("Select Male or Female.");
    if (interests.length < 3) return toast.error("Pick at least 3 interests.");
    setBusy(true);
    try {
      await completeOnboarding({
        data: {
          username,
          displayName,
          gender,
          dateOfBirth: dob,
          bio,
          avatarUrl: avatar,
        },
      });
      await saveInterests({ data: { tags: interests } });
      await me.refetch();
      nav({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="kc-auth-shell px-6 py-10">
      <div className="kc-auth-card mx-auto max-w-md">
      <Wordmark />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Finish your profile</h1>
      <p className="mt-2 text-sm text-muted">
        Choose a username people can find, and tell us Male or Female to continue.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="grid size-16 place-items-center overflow-hidden rounded-full bg-elevated text-sm font-medium text-muted">
            {avatar ? <img src={avatar} alt="" className="size-full object-cover" /> : "Photo"}
          </div>
          <div className="min-w-0 flex-1">
            <Label htmlFor="avatar">Profile photo</Label>
            <Input
              id="avatar"
              className="mt-1.5"
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
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="display-name">Display name</Label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Gender</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["male", "female"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={`h-11 rounded-xl border text-sm font-medium ${
                  gender === g ? "border-accent bg-accent/10 text-fg" : "border-border text-muted"
                }`}
              >
                {g === "male" ? "Male" : "Female"}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dob">Date of birth</Label>
          <Input
            id="dob"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bio">Bio (optional)</Label>
          <Textarea
            id="bio"
            value={bio}
            maxLength={160}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A line about you"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Interests (pick at least 3)</Label>
          <p className="text-xs text-muted">Used to rank your For You feed. You can change these later.</p>
          <div className="flex flex-wrap gap-2">
            {NYX_INTERESTS.map((i) => {
              const on = interests.includes(i.tag);
              return (
                <button
                  key={i.tag}
                  type="button"
                  onClick={() =>
                    setInterests((cur) => (on ? cur.filter((t) => t !== i.tag) : [...cur, i.tag]))
                  }
                  className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-fg text-bg" : "bg-elevated text-muted"}`}
                >
                  {i.label}
                </button>
              );
            })}
          </div>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Saving…" : "Continue"}
        </Button>
      </form>
      </div>
    </main>
  );
}
