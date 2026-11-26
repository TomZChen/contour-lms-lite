// End-to-end API smoke test against a running app and the local Supabase seed.
//   npm run db:reset && npm run dev   (in another terminal)
//   npm run test:api                  (BASE=http://localhost:3001 to override)
// Logs in as seeded users, builds the @supabase/ssr session cookie, and
// exercises every route, including the role, CSRF and booking-rule failures.
// It creates (and cancels) a booking, so re-run `npm run db:reset` for a clean slate.
const BASE = process.env.BASE ?? "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SUPA || !KEY) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY (see .env.example)");
// @supabase/ssr names the cookie after the first label of the Supabase host.
const COOKIE = `sb-${new URL(SUPA).hostname.split(".")[0]}-auth-token`;

async function login(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const session = await r.json();
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  // @supabase/ssr chunks cookies above ~3180 chars
  const chunks = value.match(/.{1,3180}/g);
  return chunks.length === 1
    ? `${COOKIE}=${value}`
    : chunks.map((c, i) => `${COOKIE}.${i}=${c}`).join("; ");
}

let failures = 0;
async function call(label, cookie, method, path, { body, expect, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      origin: BASE,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 80); }
  const ok = expect === undefined || res.status === expect;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${res.status} ${label}${data?.error ? `  [${data.error.code}]` : ""}`);
  return data;
}

const student = await login("student@example.com");
const tutor = await login("marcus.lindqvist@tutors.example.com");
const admin = await login("admin@example.com");

await call("anon -> 401", null, "GET", "/api/consultations", { expect: 401 });
const me = await call("me", student, "GET", "/api/me", { expect: 200 });
console.log("     ", me.role, me.fullName);

const subjects = await call("subjects", student, "GET", "/api/subjects", { expect: 200 });
const spec = subjects.items.find((s) => s.slug === "specialist-math");
const marcus = spec.tutors.find((t) => t.fullName === "Marcus Lindqvist");
console.log("      subjects:", subjects.items.map((s) => `${s.name}(${s.tutors.length})`).join(", "));

const av = await call("availability w/ booked-out tutor", student, "GET",
  `/api/subjects/${spec.id}/availability?tutorId=${marcus.id}`, { expect: 200 });
console.log("      requested:", av.requestedTutor.fullName, "bookedOut=", av.requestedTutor.bookedOut,
  "| recommended:", av.recommendations.map((r) => `${r.fullName} next ${r.nextFreeSlot}`).join("; "));

const chloe = av.recommendations[0];
const slot = chloe.freeSlots[0];
const slot2 = chloe.freeSlots[1];

await call("book: invalid body", student, "POST", "/api/consultations", { body: { firstName: "" }, expect: 400 });
await call("book: not on the hour", student, "POST", "/api/consultations", {
  body: { firstName: "Sam", lastName: "Student", reason: "x", subjectId: spec.id, tutorId: chloe.id,
          scheduledAt: new Date(new Date(slot).getTime() + 30 * 60e3).toISOString() }, expect: 400 });
await call("book: booked-out tutor (DB rejects)", student, "POST", "/api/consultations", {
  body: { firstName: "Sam", lastName: "Student", reason: "x", subjectId: spec.id, tutorId: marcus.id,
          scheduledAt: slot }, expect: 422 });
await call("book: no CSRF (cross-site)", student, "POST", "/api/consultations", {
  body: { firstName: "Sam", lastName: "Student", reason: "x", subjectId: spec.id, tutorId: chloe.id, scheduledAt: slot },
  headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" }, expect: 403 });
await call("book: as tutor -> 403", tutor, "POST", "/api/consultations", {
  body: { firstName: "M", lastName: "L", reason: "x", subjectId: spec.id, tutorId: chloe.id, scheduledAt: slot }, expect: 403 });
const booked = await call("book: valid with Chloe", student, "POST", "/api/consultations", {
  body: { firstName: "Sam", lastName: "Student", reason: "Vectors help", subjectId: spec.id, tutorId: chloe.id, scheduledAt: slot },
  expect: 201 });
await call("book: same slot again (overlap)", student, "POST", "/api/consultations", {
  body: { firstName: "Sam", lastName: "Student", reason: "dup", subjectId: spec.id, tutorId: chloe.id, scheduledAt: slot }, expect: 409 });

await call("get own", student, "GET", `/api/consultations/${booked.id}`, { expect: 200 });
await call("get as other tutor -> 404", tutor, "GET", `/api/consultations/${booked.id}`, { expect: 404 });
await call("get malformed id -> 404", student, "GET", `/api/consultations/not-a-uuid`, { expect: 404 });

await call("complete before ended -> 422", student, "PUT", `/api/consultations/${booked.id}/completion`, { expect: 422 });
await call("reschedule", student, "POST", `/api/consultations/${booked.id}/reschedule`, {
  body: { scheduledAt: slot2 }, expect: 200 });
await call("reschedule: unknown field rejected", student, "POST", `/api/consultations/${booked.id}/reschedule`, {
  body: { scheduledAt: slot2, cancelledAt: null }, expect: 400 });
await call("admin cannot cancel -> 403", admin, "POST", `/api/consultations/${booked.id}/cancel`, { expect: 403 });
await call("cancel", student, "POST", `/api/consultations/${booked.id}/cancel`, { expect: 200 });
await call("cancel again -> 409", student, "POST", `/api/consultations/${booked.id}/cancel`, { expect: 409 });

const mine = await call("list mine", student, "GET", "/api/consultations?limit=2", { expect: 200 });
console.log("      page1:", mine.items.length, "items, nextCursor?", Boolean(mine.nextCursor));
const page2 = await call("list mine page 2", student, "GET",
  `/api/consultations?limit=2&cursor=${mine.nextCursor}`, { expect: 200 });
console.log("      page2:", page2.items.map((c) => `${c.reason}/${c.status}`).join(", "));
await call("list: bad cursor -> 400", student, "GET", "/api/consultations?cursor=abc", { expect: 400 });

const past = [...mine.items, ...page2.items].find((c) => c.reason === "Course selection advice");
await call("incomplete past", student, "DELETE", `/api/consultations/${past.id}/completion`, { expect: 200 });
await call("complete past", student, "PUT", `/api/consultations/${past.id}/completion`, { expect: 200 });

const tutorList = await call("tutor: list mine", tutor, "GET", "/api/consultations?limit=100", { expect: 200 });
console.log("      Marcus sessions:", tutorList.items.length);
await call("student -> admin list 403", student, "GET", "/api/admin/consultations", { expect: 403 });
const all = await call("admin list", admin, "GET", "/api/admin/consultations?limit=5&order=desc", { expect: 200 });
console.log("      admin page:", all.items.length, "nextCursor?", Boolean(all.nextCursor));
await call("admin list filter by tutor", admin, "GET", `/api/admin/consultations?tutorId=${chloe.id}&status=cancelled`, { expect: 200 });

// Student-name search: every word must match the first or last name, any case.
const check = (label, cond) => { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}     ${label}`); };
const sam = await call("admin search 'sam stu'", admin, "GET", "/api/admin/consultations?q=sam%20stu&limit=100", { expect: 200 });
check("  every result is Sam Student", sam.items.length > 0 && sam.items.every((c) => c.firstName === "Sam" && c.lastName === "Student"));
const riley = await call("admin search 'EXAMPLE'", admin, "GET", "/api/admin/consultations?q=EXAMPLE&limit=100", { expect: 200 });
check("  every result is Riley Example", riley.items.length > 0 && riley.items.every((c) => c.lastName === "Example"));
const none = await call("admin search 'sam example' (no match)", admin, "GET", "/api/admin/consultations?q=sam%20example", { expect: 200 });
check("  no results", none.items.length === 0);
await call("admin search rejects filter syntax", admin, "GET", "/api/admin/consultations?q=a%22%2Cid.neq.x", { expect: 400 });

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
