const WEAK = [
  "password",
  "1234567890",
  "qwertyuiop",
  "letmein",
  "1111111111",
  "abcdefghij",
];

export function passwordIssue(password: string, email?: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 128) return "Password is too long.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Use both letters and numbers.";
  }
  const lower = password.toLowerCase();
  if (WEAK.some((w) => lower.includes(w))) return "Choose a stronger password.";
  const local = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && lower.includes(local)) return "Don’t put your email in the password.";
  return null;
}
