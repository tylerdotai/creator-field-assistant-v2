/**
 * Creator Field Assistant — Cloudflare Worker
 * D1 + KV-backed REST API with JWT auth
 */

const CORS_ORIGIN = "https://creator-field-assistant.vercel.app";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "cfa-salt-v1");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function createToken(userId) {
  const payload = {
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
  };
  const encoded = btoa(JSON.stringify(payload));
  return encoded + "." + Math.random().toString(36).slice(2);
}

async function validateToken(token, kv) {
  if (!token) return null;
  const userId = await kv.get("token:" + token);
  return userId || null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": CORS_ORIGIN },
  });
}

function error(msg, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": CORS_ORIGIN },
  });
}

function getUserId(request, kv) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;
  return validateToken(token, kv);
}

// ─── Database helpers ─────────────────────────────────────────────────────────

async function dbGet(stmt) {
  const result = await stmt.first();
  return result;
}

async function dbAll(stmt) {
  return await stmt.all();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

async function handleAuth(request, env) {
  const { DB, KV } = env;
  const body = await request.json();

  if (request.method === "POST" && new URL(request.url).pathname === "/api/auth/register") {
    const { email, password } = body;
    if (!email || !password) return error("email and password required", 400);
    if (password.length < 8) return error("password must be at least 8 characters", 400);

    const existing = await DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) return error("Email already taken", 409);

    const id = crypto.randomUUID();
    const password_hash = await hashPassword(password);
    await DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").bind(id, email, password_hash, Date.now()).run();

    const token = createToken(id);
    await KV.put("token:" + token, id, { expirationTtl: 30 * 24 * 60 * 60 });

    return json({ token, user: { id, email } });
  }

  if (request.method === "POST" && new URL(request.url).pathname === "/api/auth/login") {
    const { email, password } = body;
    if (!email || !password) return error("email and password required", 400);

    const user = await DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) return error("Invalid credentials", 401);

    const hash = await hashPassword(password);
    if (hash !== user.password_hash) return error("Invalid credentials", 401);

    const token = createToken(user.id);
    await KV.put("token:" + token, user.id, { expirationTtl: 30 * 24 * 60 * 60 });

    return json({ token, user: { id: user.id, email: user.email } });
  }

  return error("Not found", 404);
}

async function handleProjects(request, env) {
  const { DB, KV } = env;
  const userId = await getUserId(request, KV);
  if (!userId) return error("Unauthorized", 401);

  const url = new URL(request.url);

  if (request.method === "GET") {
    const rows = await DB.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC").bind(userId).all();
    return json(rows.results);
  }

  if (request.method === "POST") {
    const { name } = await request.json();
    if (!name) return error("name required");
    const id = crypto.randomUUID();
    const now = Date.now();
    await DB.prepare("INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, userId, name, now, now).run();
    return json({ id, user_id: userId, name, created_at: now, updated_at: now }, 201);
  }

  if (request.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    const { name } = await request.json();
    await DB.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(name, Date.now(), id, userId).run();
    return json({ id, name });
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    await DB.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").bind(id, userId).run();
    return json({ ok: true });
  }

  return error("Method not allowed", 405);
}

async function handleDays(request, env) {
  const { DB, KV } = env;
  const userId = await getUserId(request, KV);
  if (!userId) return error("Unauthorized", 401);

  const url = new URL(request.url);

  if (request.method === "GET") {
    const projectId = url.searchParams.get("project_id");
    if (!projectId) return error("project_id required");
    // Verify ownership
    const project = await DB.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").bind(projectId, userId).first();
    if (!project) return error("Not found", 404);
    const rows = await DB.prepare("SELECT * FROM days WHERE project_id = ? ORDER BY \"order\" ASC").bind(projectId).all();
    return json(rows.results);
  }

  if (request.method === "POST") {
    const projectId = url.searchParams.get("project_id");
    if (!projectId) return error("project_id required");
    const { location_name, date } = await request.json();
    if (!location_name) return error("location_name required");

    const count = await DB.prepare("SELECT COUNT(*) as c FROM days WHERE project_id = ?").bind(projectId).first();
    const id = crypto.randomUUID();
    const now = Date.now();
    await DB.prepare("INSERT INTO days (id, project_id, location_name, date, notes, \"order\", created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, projectId, location_name, date || "", "", count.c, now).run();
    await DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(now, projectId).run();

    return json({ id, project_id: projectId, location_name, date: date || "", notes: "", order: count.c, created_at: now }, 201);
  }

  if (request.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    const { location_name, date, notes, order } = await request.json();
    const updates = [];
    const binds = [];
    if (location_name !== undefined) { updates.push("location_name = ?"); binds.push(location_name); }
    if (date !== undefined) { updates.push("date = ?"); binds.push(date); }
    if (notes !== undefined) { updates.push("notes = ?"); binds.push(notes); }
    if (order !== undefined) { updates.push("\"order\" = ?"); binds.push(order); }
    if (!updates.length) return error("No fields to update");
    binds.push(id, userId);
    await DB.prepare(`UPDATE days SET ${updates.join(", ")} WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)`).bind(...binds).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    await DB.prepare("DELETE FROM days WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)").bind(id, userId).run();
    return json({ ok: true });
  }

  return error("Method not allowed", 405);
}

async function handleShots(request, env) {
  const { DB, KV } = env;
  const userId = await getUserId(request, KV);
  if (!userId) return error("Unauthorized", 401);

  const url = new URL(request.url);

  if (request.method === "GET") {
    const dayId = url.searchParams.get("day_id");
    if (!dayId) return error("day_id required");
    const rows = await DB.prepare("SELECT * FROM shots WHERE day_id = ? ORDER BY \"order\" ASC").bind(dayId).all();
    return json(rows.results);
  }

  if (request.method === "POST") {
    const dayId = url.searchParams.get("day_id");
    if (!dayId) return error("day_id required");
    const body = await request.json();
    const count = await DB.prepare("SELECT COUNT(*) as c FROM shots WHERE day_id = ?").bind(dayId).first();
    const id = crypto.randomUUID();
    const now = Date.now();
    await DB.prepare(
      "INSERT INTO shots (id, day_id, type, description, lens, format, status, notes, completed, \"order\", created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id, dayId,
      body.type || "vlog",
      body.description || "",
      body.lens || "35mm",
      body.format || "16:9",
      body.status || "planned",
      body.notes || "",
      body.completed ? 1 : 0,
      count.c,
      now
    ).run();
    return json({ id, day_id: dayId, type: body.type || "vlog", description: body.description || "", lens: body.lens || "35mm", format: body.format || "16:9", status: body.status || "planned", notes: body.notes || "", completed: !!body.completed, order: count.c, created_at: now }, 201);
  }

  if (request.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    const { type, description, lens, format, status, notes, completed, order } = await request.json();
    const updates = [];
    const binds = [];
    if (type !== undefined) { updates.push("type = ?"); binds.push(type); }
    if (description !== undefined) { updates.push("description = ?"); binds.push(description); }
    if (lens !== undefined) { updates.push("lens = ?"); binds.push(lens); }
    if (format !== undefined) { updates.push("format = ?"); binds.push(format); }
    if (status !== undefined) { updates.push("status = ?"); binds.push(status); }
    if (notes !== undefined) { updates.push("notes = ?"); binds.push(notes); }
    if (completed !== undefined) { updates.push("completed = ?"); binds.push(completed ? 1 : 0); }
    if (order !== undefined) { updates.push("\"order\" = ?"); binds.push(order); }
    if (!updates.length) return error("No fields to update");
    binds.push(id);
    await DB.prepare(`UPDATE shots SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    await DB.prepare("DELETE FROM shots WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  return error("Method not allowed", 405);
}

async function handleGear(request, env) {
  const { DB, KV } = env;
  const userId = await getUserId(request, KV);
  if (!userId) return error("Unauthorized", 401);

  const url = new URL(request.url);

  if (request.method === "GET") {
    const rows = await DB.prepare("SELECT * FROM gear WHERE user_id = ? ORDER BY \"order\" ASC").bind(userId).all();
    return json(rows.results);
  }

  if (request.method === "POST") {
    const body = await request.json();
    const count = await DB.prepare("SELECT COUNT(*) as c FROM gear WHERE user_id = ?").bind(userId).first();
    const id = crypto.randomUUID();
    const now = Date.now();
    await DB.prepare(
      "INSERT INTO gear (id, user_id, name, category, weight, weight_unit, is_packed, is_owned, notes, image_data_url, \"order\", created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id, userId,
      body.name || "New Item",
      body.category || "accessory",
      body.weight || 0,
      body.weight_unit || "g",
      body.is_packed ? 1 : 0,
      body.is_owned !== undefined ? (body.is_owned ? 1 : 0) : 1,
      body.notes || "",
      body.image_data_url || "",
      count.c,
      now
    ).run();
    return json({ id, user_id: userId, name: body.name || "New Item", category: body.category || "accessory", weight: body.weight || 0, weight_unit: body.weight_unit || "g", is_packed: !!body.is_packed, is_owned: body.is_owned !== false, notes: body.notes || "", image_data_url: body.image_data_url || "", order: count.c, created_at: now }, 201);
  }

  if (request.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    const { name, category, weight, weight_unit, is_packed, is_owned, notes, order } = await request.json();
    const updates = [];
    const binds = [];
    if (name !== undefined) { updates.push("name = ?"); binds.push(name); }
    if (category !== undefined) { updates.push("category = ?"); binds.push(category); }
    if (weight !== undefined) { updates.push("weight = ?"); binds.push(weight); }
    if (weight_unit !== undefined) { updates.push("weight_unit = ?"); binds.push(weight_unit); }
    if (is_packed !== undefined) { updates.push("is_packed = ?"); binds.push(is_packed ? 1 : 0); }
    if (is_owned !== undefined) { updates.push("is_owned = ?"); binds.push(is_owned ? 1 : 0); }
    if (notes !== undefined) { updates.push("notes = ?"); binds.push(notes); }
    if (order !== undefined) { updates.push("\"order\" = ?"); binds.push(order); }
    if (!updates.length) return error("No fields to update");
    binds.push(id, userId);
    await DB.prepare(`UPDATE gear SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`).bind(...binds).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    await DB.prepare("DELETE FROM gear WHERE id = ? AND user_id = ?").bind(id, userId).run();
    return json({ ok: true });
  }

  return error("Method not allowed", 405);
}

async function handleChecklists(request, env) {
  const { DB, KV } = env;
  const userId = await getUserId(request, KV);
  if (!userId) return error("Unauthorized", 401);

  const url = new URL(request.url);

  if (request.method === "GET") {
    const rows = await DB.prepare("SELECT * FROM checklists WHERE user_id = ?").bind(userId).all();
    return json(rows.results);
  }

  if (request.method === "POST") {
    const { name, project_id } = await request.json();
    if (!name) return error("name required");
    const id = crypto.randomUUID();
    await DB.prepare("INSERT INTO checklists (id, user_id, name, project_id) VALUES (?, ?, ?, ?)").bind(id, userId, name, project_id || "").run();
    return json({ id, user_id: userId, name, project_id: project_id || "" }, 201);
  }

  if (request.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    const { name } = await request.json();
    await DB.prepare("UPDATE checklists SET name = ? WHERE id = ? AND user_id = ?").bind(name, id, userId).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    await DB.prepare("DELETE FROM checklists WHERE id = ? AND user_id = ?").bind(id, userId).run();
    return json({ ok: true });
  }

  return error("Method not allowed", 405);
}

async function handleChecklistItems(request, env) {
  const { DB, KV } = env;
  const userId = await getUserId(request, KV);
  if (!userId) return error("Unauthorized", 401);

  const url = new URL(request.url);

  if (request.method === "GET") {
    const checklistId = url.searchParams.get("checklist_id");
    if (!checklistId) return error("checklist_id required");
    const rows = await DB.prepare("SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY \"order\" ASC").bind(checklistId).all();
    return json(rows.results);
  }

  if (request.method === "POST") {
    const checklistId = url.searchParams.get("checklist_id");
    if (!checklistId) return error("checklist_id required");
    const { text } = await request.json();
    if (!text) return error("text required");
    const count = await DB.prepare("SELECT COUNT(*) as c FROM checklist_items WHERE checklist_id = ?").bind(checklistId).first();
    const id = crypto.randomUUID();
    await DB.prepare("INSERT INTO checklist_items (id, checklist_id, text, checked, \"order\", is_custom) VALUES (?, ?, ?, 0, ?, 1)").bind(id, checklistId, text, count.c).run();
    return json({ id, checklist_id: checklistId, text, checked: false, order: count.c, is_custom: true }, 201);
  }

  if (request.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    const { text, checked, order } = await request.json();
    const updates = [];
    const binds = [];
    if (text !== undefined) { updates.push("text = ?"); binds.push(text); }
    if (checked !== undefined) { updates.push("checked = ?"); binds.push(checked ? 1 : 0); }
    if (order !== undefined) { updates.push("\"order\" = ?"); binds.push(order); }
    if (!updates.length) return error("No fields to update");
    binds.push(id);
    await DB.prepare(`UPDATE checklist_items SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    await DB.prepare("DELETE FROM checklist_items WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  return error("Method not allowed", 405);
}

async function handleLocations(request, env) {
  const { DB, KV } = env;
  const userId = await getUserId(request, KV);
  if (!userId) return error("Unauthorized", 401);

  const url = new URL(request.url);

  if (request.method === "GET") {
    const rows = await DB.prepare("SELECT * FROM locations WHERE user_id = ?").bind(userId).all();
    return json(rows.results);
  }

  if (request.method === "POST") {
    const body = await request.json();
    if (!body.name || body.lat === undefined || body.lng === undefined) {
      return error("name, lat, and lng required");
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    await DB.prepare(
      "INSERT INTO locations (id, user_id, name, lat, lng, type, description, photo_data_url, project_id, day_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, userId, body.name, body.lat, body.lng, body.type || "photo_spot", body.description || "", body.photo_data_url || "", body.project_id || "", body.day_id || "", now).run();
    return json({ id, user_id: userId, name: body.name, lat: body.lat, lng: body.lng, type: body.type || "photo_spot", description: body.description || "", photo_data_url: body.photo_data_url || "", project_id: body.project_id || "", day_id: body.day_id || "", created_at: now }, 201);
  }

  if (request.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    const { name, lat, lng, type, description } = await request.json();
    const updates = [];
    const binds = [];
    if (name !== undefined) { updates.push("name = ?"); binds.push(name); }
    if (lat !== undefined) { updates.push("lat = ?"); binds.push(lat); }
    if (lng !== undefined) { updates.push("lng = ?"); binds.push(lng); }
    if (type !== undefined) { updates.push("type = ?"); binds.push(type); }
    if (description !== undefined) { updates.push("description = ?"); binds.push(description); }
    if (!updates.length) return error("No fields to update");
    binds.push(id, userId);
    await DB.prepare(`UPDATE locations SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`).bind(...binds).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return error("id required");
    await DB.prepare("DELETE FROM locations WHERE id = ? AND user_id = ?").bind(id, userId).run();
    return json({ ok: true });
  }

  return error("Method not allowed", 405);
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function handleRequest(request, env) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\//, "");

  // Auth — no token required
  if (path === "auth/register" || path === "auth/login") {
    return handleAuth(request, env);
  }

  // All other routes require auth
  if (path === "projects") return handleProjects(request, env);
  if (path === "days") return handleDays(request, env);
  if (path === "shots") return handleShots(request, env);
  if (path === "gear") return handleGear(request, env);
  if (path === "checklists") return handleChecklists(request, env);
  if (path === "checklist-items") return handleChecklistItems(request, env);
  if (path === "locations") return handleLocations(request, env);

  return error("Not found", 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      return error("Internal server error: " + e.message, 500);
    }
  },
};
