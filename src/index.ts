type LeadInput = {
  fullName: string; email: string; phone?: string; vehicleMake: string;
  vehicleModel: string; vehicleYear: number; mileage?: number;
  location?: string; message?: string; consent: boolean; website?: string;
};

const json = (data: unknown, status = 200) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function scoreLead(input: LeadInput): { score: number; temperature: string; summary: string; action: string } {
  let score = 20;
  if (input.phone) score += 10;
  if (input.location) score += 8;
  if (Number.isFinite(input.mileage)) score += 7;
  if (input.vehicleYear >= new Date().getUTCFullYear() - 8) score += 10;
  if (/today|now|urgent|as soon as|ready to sell|immediately/i.test(input.message ?? "")) score += 25;
  else if ((input.message ?? "").length > 15) score += 8;
  score = Math.max(0, Math.min(100, score));
  const temperature = score >= 75 ? "HOT" : score >= 40 ? "WARM" : "COLD";
  const action = score >= 75 ? "Call this lead immediately." : score >= 40 ? "Contact this lead within one hour." : "Review the enquiry and follow up by email.";
  return { score, temperature, action, summary: `${input.fullName} requested a quotation for a ${input.vehicleYear} ${input.vehicleMake} ${input.vehicleModel}.` };
}

async function createLead(request: Request, env: Env): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) return json({ error: "Request too large" }, 413);
  const input = await request.json<LeadInput>();
  if (input.website) return json({ ok: true });
  if (!input.consent || !input.fullName?.trim() || !validEmail(input.email ?? "") || !input.vehicleMake?.trim() || !input.vehicleModel?.trim() || !Number.isInteger(Number(input.vehicleYear))) {
    return json({ error: "Please provide the required contact, vehicle and consent details." }, 400);
  }

  const clean: LeadInput = {
    fullName: input.fullName.trim().slice(0, 100), email: input.email.trim().toLowerCase().slice(0, 160),
    phone: input.phone?.replace(/[^+\d]/g, "").slice(0, 24), vehicleMake: input.vehicleMake.trim().slice(0, 60),
    vehicleModel: input.vehicleModel.trim().slice(0, 60), vehicleYear: Number(input.vehicleYear),
    mileage: input.mileage ? Number(input.mileage) : undefined, location: input.location?.trim().slice(0, 120),
    message: input.message?.trim().slice(0, 1000), consent: true,
  };
  const result = scoreLead(clean);
  const id = crypto.randomUUID();
  const now = new Date();
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO leads (id,created_at,full_name,email,phone,vehicle_make,vehicle_model,vehicle_year,mileage,location,message,score,temperature,summary,recommended_action,first_reminder_due,second_reminder_due,escalation_due) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, now.toISOString(), clean.fullName, clean.email, clean.phone ?? null, clean.vehicleMake, clean.vehicleModel, clean.vehicleYear, clean.mileage ?? null, clean.location ?? null, clean.message ?? null, result.score, result.temperature, result.summary, result.action, at(15), at(60), at(720)),
    env.DB.prepare(`INSERT INTO messages (id,lead_id,created_at,audience,subject,body,kind) VALUES (?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), id, now.toISOString(), "customer", "We received your vehicle enquiry", `Thanks ${clean.fullName}. We received your enquiry and the quotation team will review it shortly.`, "acknowledgement"),
    env.DB.prepare(`INSERT INTO messages (id,lead_id,created_at,audience,subject,body,kind) VALUES (?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), id, now.toISOString(), "sales team", `${result.temperature} vehicle enquiry`, `${result.summary}\nScore: ${result.score}/100\nAction: ${result.action}`, "team-alert"),
  ]);
  return json({ ok: true, leadId: id, ...result, customerMessage: "Your enquiry has been received. The quotation team will review it shortly." }, 201);
}

async function listDemo(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`SELECT id,created_at,vehicle_make,vehicle_model,vehicle_year,score,temperature,status FROM leads ORDER BY created_at DESC LIMIT 20`).all();
  return json({ leads: results });
}

async function getLead(id: string, env: Env): Promise<Response> {
  const lead = await env.DB.prepare(`SELECT id,created_at,vehicle_make,vehicle_model,vehicle_year,score,temperature,summary,recommended_action,status FROM leads WHERE id=?`).bind(id).first();
  if (!lead) return json({ error: "Lead not found" }, 404);
  const { results: messages } = await env.DB.prepare(`SELECT created_at,audience,subject,body,kind FROM messages WHERE lead_id=? ORDER BY created_at`).bind(id).all();
  return json({ lead, messages });
}

async function runReminders(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(`SELECT id,full_name,temperature,first_reminder_due,first_reminder_sent,second_reminder_due,second_reminder_sent,escalation_due,escalation_sent FROM leads WHERE status='Not Contacted' AND (first_reminder_due<=? OR second_reminder_due<=? OR escalation_due<=?) LIMIT 100`).bind(now, now, now).all<Record<string, unknown>>();
  for (const lead of results) {
    let kind: string | null = null;
    if (!lead.escalation_sent && String(lead.escalation_due) <= now) kind = "12-hour-escalation";
    else if (!lead.second_reminder_sent && String(lead.second_reminder_due) <= now) kind = "1-hour-reminder";
    else if (!lead.first_reminder_sent && String(lead.first_reminder_due) <= now) kind = "15-minute-reminder";
    if (!kind) continue;
    const field = kind === "12-hour-escalation" ? "escalation_sent" : kind === "1-hour-reminder" ? "second_reminder_sent" : "first_reminder_sent";
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO messages (id,lead_id,created_at,audience,subject,body,kind) VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), lead.id, now, "sales team", `${kind}: ${lead.temperature} lead still uncontacted`, `Lead ${lead.id} is still marked Not Contacted.`, kind),
      env.DB.prepare(`UPDATE leads SET ${field}=1 WHERE id=?`).bind(lead.id),
    ]);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return json({ ok: true, runtime: "Cloudflare Workers", database: "D1" });
      if (url.pathname === "/api/leads" && request.method === "POST") return await createLead(request, env);
      if (url.pathname === "/api/demo/leads" && request.method === "GET") return await listDemo(env);
      const match = url.pathname.match(/^\/api\/leads\/([0-9a-f-]+)$/i);
      if (match && request.method === "GET") return await getLead(match[1], env);
      if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: "request_error", path: url.pathname, message: error instanceof Error ? error.message : "Unknown error" }));
      return json({ error: "The demo could not process this request." }, 500);
    }
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(runReminders(env));
  },
} satisfies ExportedHandler<Env>;
