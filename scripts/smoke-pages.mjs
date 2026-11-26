// Page-level smoke test: role gating (redirects) and server-rendered content
// for each role, against a running app and a fresh local seed.
//   npm run db:reset && npm run dev   (in another terminal)
//   npm run test:pages                (BASE=http://localhost:3001 to override)
const BASE = process.env.BASE ?? "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SUPA || !KEY) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY (see .env.example)");
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;
async function login(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "password123" }) });
  return `${COOKIE}=base64-` + Buffer.from(JSON.stringify(await r.json())).toString("base64url");
}
const users = { anon: null, student: await login("student@example.com"), tutor: await login("marcus.lindqvist@tutors.example.com"), admin: await login("admin@example.com") };
// Any day next week, as YYYY-MM-DD (the page normalises it to the Monday).
const NEXT_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

const checks = [
  ["anon", "/student", { redirectTo: "/auth/login" }],
  ["anon", "/", { contains: ["Sign in", "Create an account"] }],
  ["student", "/", { contains: ["Go to your dashboard"] }],
  ["student", "/dashboard", { redirectTo: "/student" }],
  ["tutor", "/dashboard", { redirectTo: "/tutor" }],
  ["admin", "/dashboard", { redirectTo: "/admin" }],
  ["student", "/admin", { redirectTo: "/student" }],
  ["tutor", "/student/book", { redirectTo: "/tutor" }],
  ["admin", "/tutor", { redirectTo: "/admin" }],
  ["student", "/student", { contains: ["My consultations", "Review of assignment 1 feedback", "Book a consultation", "Sam Student"] , absent: ["Exam preparation"] }],
  ["student", "/student?status=cancelled", { contains: ["Exam preparation"] }],
  ["student", "/student?status=completed", { contains: ["Course selection advice"] }],
  ["student", "/student/book", { contains: ["Book a consultation", "Specialist Math", "First name", "Reason for consultation"] }],
  ["tutor", "/tutor", { contains: ["My sessions", "Riley", "Specialist Math revision", "Load more"] }],
  ["admin", "/admin", { contains: ["All consultations", "Riley", "Marcus Lindqvist", "Load more"] }],
  ["admin", "/admin?status=completed", { contains: ["Sam", "Course selection advice", "Lucas Ferreira"], absent: ["Riley"] }],
  ["admin", "/admin?status=bogus", { contains: ["All consultations"] }],
  ["admin", "/admin?q=sam+student", { contains: ["Sam", "Course selection advice", "Search student name"], absent: ["Riley"] }],
  ["admin", "/admin?q=nobody", { contains: ["No consultations for a student matching"] }],
  // Week calendar (D47). Riley fills Marcus's free hours for the next 14 days.
  ["student", "/student?view=calendar", { contains: ["This week", "Melbourne time", "(today)", "Calendar"] }],
  ["student", "/student?view=calendar&week=bogus", { contains: ["This week", "(today)"] }],
  ["tutor", `/tutor?view=calendar&week=${NEXT_WEEK}`, { contains: ["Riley Example", "Specialist Math"], absent: ["(today)"] }],
  ["admin", `/admin?view=calendar&week=${NEXT_WEEK}&q=riley`, { contains: ["Riley Example", "Marcus Lindqvist"], absent: ["Sam Student"] }],
  // Availability editor (D46).
  ["tutor", "/tutor/availability", { contains: ["Availability", "Save availability", "Has upcoming sessions"] }],
  ["student", "/tutor/availability", { redirectTo: "/student" }],
];
let fail = 0;
for (const [who, path, exp] of checks) {
  // Follow redirects manually, including the streamed (in-body) redirect that
  // Next.js emits when redirect() runs inside a Suspense boundary.
  const res = await fetch(BASE + path, { headers: users[who] ? { cookie: users[who] } : {}, redirect: "manual" });
  const html = await res.text();
  const loc = res.headers.get("location") ?? (html.match(/NEXT_REDIRECT;(?:replace|push);([^;"]+);/)?.[1]) ?? null;
  const errs = [];
  if (exp.redirectTo && !(loc && new URL(loc, BASE).pathname === exp.redirectTo)) errs.push(`expected redirect to ${exp.redirectTo}, got ${loc} (${res.status})`);
  for (const s of exp.contains ?? []) if (!html.includes(s)) errs.push(`missing "${s}"`);
  for (const s of exp.absent ?? []) if (html.includes(s)) errs.push(`unexpected "${s}"`);
  if (errs.length) fail++;
  console.log(`${errs.length ? "FAIL" : "PASS"} ${who.padEnd(7)} ${path}${errs.length ? "  " + errs.join("; ") : ""}`);
}
console.log(fail ? `${fail} FAILED` : "ALL PASSED");
process.exit(fail ? 1 : 0);
