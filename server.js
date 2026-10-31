require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const nodemailer = require("nodemailer");
const twilio = require("twilio");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const cfg = {
  city: process.env.CITY || "Indore",
  lat: Number(process.env.LATITUDE || 22.7196),
  lon: Number(process.env.LONGITUDE || 75.8577),
  pollMs: Math.max(60000, Number(process.env.POLL_INTERVAL_MS || 300000)),
  rainWarn: Number(process.env.RAIN_WARN_MM_H || 15),
  rainHigh: Number(process.env.RAIN_HIGH_MM_H || 30),
  cooldownMs: Number(process.env.ALERT_COOLDOWN_MIN || 30) * 60000
};

let latest = null;
let alertHistory = [];
let lastAlertAt = 0;
let lastAlertLevel = "LOW";
let communityReports = [];

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

async function getJson(url, params = {}, headers = {}) {
  const response = await axios.get(url, { params, headers, timeout: 12000 });
  return response.data;
}

async function getOpenMeteoWeather() {
  const data = await getJson("https://api.open-meteo.com/v1/forecast", {
    latitude: cfg.lat, longitude: cfg.lon,
    current: "temperature_2m,relative_humidity_2m,precipitation,rain,wind_speed_10m",
    hourly: "precipitation,rain,precipitation_probability",
    forecast_days: 2, timezone: "Asia/Kolkata"
  });
  const currentRain = num(data.current?.rain ?? data.current?.precipitation);
  const times = data.hourly?.time || [];
  const startIndex = Math.max(0, times.findIndex(t => t >= (data.current?.time || "")));
  const hourlyRain = data.hourly?.rain || data.hourly?.precipitation || [];
  const next3hRainMm = hourlyRain.slice(startIndex, startIndex + 3).reduce((sum, value) => sum + num(value), 0);
  const next6hRainMm = hourlyRain.slice(startIndex, startIndex + 6).reduce((sum, value) => sum + num(value), 0);
  const next12hRainMm = hourlyRain.slice(startIndex, startIndex + 12).reduce((sum, value) => sum + num(value), 0);
  const probability = (data.hourly?.precipitation_probability || []).slice(startIndex, startIndex + 6).map(v => num(v));
  return {
    source: "Open-Meteo", sourceRole: "PRIMARY", temperatureC: data.current?.temperature_2m ?? null,
    humidity: data.current?.relative_humidity_2m ?? null, windKmh: data.current?.wind_speed_10m ?? null,
    observedPrecipitationMm: data.current?.precipitation ?? null, currentRainMm: currentRain,
    nextHourRainMm: num(hourlyRain[startIndex]), next3hRainMm: Number(next3hRainMm.toFixed(1)),
    next6hRainMm: Number(next6hRainMm.toFixed(1)), next12hRainMm: Number(next12hRainMm.toFixed(1)), precipitationProbability: probability[0] ?? null,
    next6hPrecipitationProbability: probability.length ? Math.max(...probability) : null,
    forecastHours: times.slice(startIndex, startIndex + 12).map((time, i) => ({ time, rainMm: num(hourlyRain[startIndex + i]), probability: num((data.hourly?.precipitation_probability || [])[startIndex + i], null) })),
    observedAt: data.current?.time || new Date().toISOString(), fetchedAt: new Date().toISOString(),
    dataType: "provider current conditions and forecast; forecast is not a local rain-gauge measurement"
  };
}

async function getMetNoWeather() {
  // Independent public fallback provider. MET Norway requires an identifying User-Agent.
  const url = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
  const data = await getJson(url, { lat: cfg.lat, lon: cfg.lon }, {
    "User-Agent": process.env.WEATHER_USER_AGENT || "UrbanFloodWatchHackathon/1.0 contact=team@example.com"
  });
  const series = data.properties?.timeseries || [];
  if (!series.length) throw new Error("MET Norway returned no forecast timeseries");
  const now = Date.now();
  const future = series.filter(x => new Date(x.time).getTime() >= now).slice(0, 12);
  if (!future.length) throw new Error("MET Norway returned no future forecast points");
  const first = future[0].data || {};
  const instant = first.instant?.details || {};
  const hourlyRain = future.map(x => num(x.data?.next_1_hours?.details?.precipitation_amount ?? x.data?.next_6_hours?.details?.precipitation_amount));
  const next3 = hourlyRain.slice(0, 3).reduce((a, b) => a + b, 0);
  const next6 = hourlyRain.slice(0, 6).reduce((a, b) => a + b, 0);
  const next12 = hourlyRain.reduce((a, b) => a + b, 0);
  return {
    source: "MET Norway Locationforecast", sourceRole: "BACKUP", temperatureC: instant.air_temperature ?? null,
    humidity: instant.relative_humidity ?? null, windKmh: instant.wind_speed != null ? Number((instant.wind_speed * 3.6).toFixed(1)) : null,
    observedPrecipitationMm: null, currentRainMm: 0, nextHourRainMm: hourlyRain[0] ?? null,
    next3hRainMm: Number(next3.toFixed(1)), next6hRainMm: Number(next6.toFixed(1)), next12hRainMm: Number(next12.toFixed(1)),
    precipitationProbability: null, next6hPrecipitationProbability: null,
    forecastHours: future.map((item, i) => ({ time: item.time, rainMm: hourlyRain[i] })),
    observedAt: future[0].time, fetchedAt: new Date().toISOString(),
    dataType: "independent provider forecast; precipitation probability is not supplied by this fallback feed"
  };
}

async function getWeather() {
  try {
    const primary = await getOpenMeteoWeather();
    return { ...primary, providerStatus: { primary: "connected", backup: "standby" }, fallbackUsed: false };
  } catch (primaryError) {
    console.warn("Primary weather provider unavailable; trying independent fallback:", primaryError.message);
    try {
      const backup = await getMetNoWeather();
      return { ...backup, providerStatus: { primary: "unavailable", backup: "connected", primaryError: primaryError.message }, fallbackUsed: true };
    } catch (backupError) {
      const error = new Error(`Weather providers unavailable. Open-Meteo: ${primaryError.message}; MET Norway: ${backupError.message}`);
      error.providerStatus = { primary: "unavailable", backup: "unavailable" };
      throw error;
    }
  }
}

function assessRisk(weather) {
  const next3h = num(weather?.next3hRainMm);
  const next6h = num(weather?.next6hRainMm);
  const probability = weather?.next6hPrecipitationProbability == null ? null : num(weather.next6hPrecipitationProbability);
  const currentRain = num(weather?.currentRainMm);
  let score = 5;
  score += Math.min(35, next3h * 1.0);
  score += Math.min(25, next6h * 0.35);
  if (probability !== null) score += probability >= 80 ? 15 : probability >= 60 ? 8 : 0;
  score += currentRain >= 5 ? 8 : currentRain >= 1 ? 3 : 0;
  score = Math.min(100, Math.round(score));

  let level = "LOW";
  if (next3h >= 45 || next6h >= 70) level = "HIGH";
  else if (next3h >= 20 || next6h >= 35 || (probability !== null && next3h >= 10 && probability >= 70)) level = "MODERATE";

  const reasons = [
    `Forecast rainfall: ${next3h.toFixed(1)} mm in 3 hours and ${next6h.toFixed(1)} mm in 6 hours`,
    probability === null ? "Rain probability is not provided by the active backup source" : `Maximum rain probability over next 6 hours: ${probability}%`,
    `Active weather provider: ${weather?.source || "none"}`
  ];
  return {
    score: weather ? score : null,
    level: weather ? level : "DATA UNAVAILABLE",
    label: level === "HIGH" ? "HIGH WEATHER-DRIVEN FLOOD WATCH" : level === "MODERATE" ? "MODERATE WEATHER WATCH" : "NO ELEVATED WEATHER SIGNAL",
    reasons,
    basis: "Weather forecast data from an independent weather-provider layer. IMD and CWC are optional future integrations and are not required for this assessment.",
    limitations: "This is an early-warning screening indicator, not confirmation of street flooding or an official emergency warning."
  };
}

async function sendEmail(subject, message) {
  if (!process.env.SMTP_HOST || !process.env.ALERT_TO || !process.env.ALERT_FROM) return { sent: false, reason: "Email not configured" };
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  await transporter.sendMail({ from: process.env.ALERT_FROM, to: process.env.ALERT_TO, subject, text: message });
  return { sent: true };
}

async function sendSms(message) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, ALERT_PHONE } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM || !ALERT_PHONE) return { sent: false, reason: "SMS not configured" };
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const result = await client.messages.create({ body: message, from: TWILIO_FROM, to: ALERT_PHONE });
  return { sent: true, sid: result.sid };
}

async function notifyIfNeeded(snapshot) {
  if (!["MODERATE", "HIGH"].includes(snapshot.risk.level)) return;
  const now = Date.now();
  const escalation = snapshot.risk.level === "HIGH" && lastAlertLevel !== "HIGH";
  if (!escalation && now - lastAlertAt < cfg.cooldownMs) return;
  lastAlertAt = now;
  lastAlertLevel = snapshot.risk.level;
  const message = `${snapshot.risk.level} WEATHER-DRIVEN FLOOD WATCH for ${cfg.city}. Screening score ${snapshot.risk.score}/100. ${snapshot.risk.reasons.join(". ")}. This is not an official warning; follow IMD and local authority instructions.`;
  const record = { id: Date.now(), level: snapshot.risk.level, score: snapshot.risk.score, message, createdAt: new Date().toISOString(), channels: {} };
  try { record.channels.email = await sendEmail(`Urban Flood Watch: ${snapshot.risk.level} risk in ${cfg.city}`, message); }
  catch (e) { record.channels.email = { sent: false, reason: e.message }; }
  try { record.channels.sms = await sendSms(message); }
  catch (e) { record.channels.sms = { sent: false, reason: e.message }; }
  alertHistory.unshift(record);
  alertHistory = alertHistory.slice(0, 50);
  io.emit("alert", record);
}

async function refresh() {
  let weather = null;
  let weatherError = null;
  try { weather = await getWeather(); } catch (e) { weatherError = e; }
  const risk = assessRisk(weather);
  latest = {
    city: cfg.city, coordinates: { lat: cfg.lat, lon: cfg.lon }, weather,
    integrations: { imd: { status: "optional_not_connected", message: "Not required for core operation; authorized access can be added later." }, cwc: { status: "optional_not_connected", message: "Not required for core operation; an approved feed can be added later." } },
    risk, updatedAt: new Date().toISOString(),
    dataStatus: { weather: !!weather, imd: false, cwc: false },
    sourceHealth: {
      weather: weather ? { status: weather.fallbackUsed ? "backup_connected" : "primary_connected", source: weather.source, fetchedAt: weather.fetchedAt, providerStatus: weather.providerStatus } : { status: "unavailable", error: weatherError?.message || "No weather response" },
      imd: { status: "optional_not_configured" }, cwc: { status: "optional_not_configured" }
    }
  };
  io.emit("snapshot", latest);
  await notifyIfNeeded(latest);
  return latest;
}

app.get("/api/health", (req, res) => res.json({ ok: true, city: cfg.city, pollIntervalMs: cfg.pollMs }));
app.get("/api/dashboard", async (req, res) => {
  try { if (!latest) await refresh(); res.json({ ...latest, alerts: alertHistory }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/alerts", (req, res) => res.json(alertHistory));
app.get("/api/reports", (req, res) => res.json(communityReports));
app.post("/api/reports", (req, res) => {
  const location = String(req.body?.location || "").trim().slice(0, 100);
  const type = String(req.body?.type || "Other concern").trim().slice(0, 50);
  const details = String(req.body?.details || "").trim().slice(0, 500);
  if (!location) return res.status(400).json({ error: "Area or landmark is required." });
  const lat = Number(req.body?.lat), lon = Number(req.body?.lon);
  const report = { id: Date.now(), location, type, details, ...(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180 ? { lat, lon } : {}), createdAt: new Date().toISOString(), status: "RECEIVED · LOCAL PROTOTYPE" };
  communityReports.unshift(report);
  communityReports = communityReports.slice(0, 100);
  io.emit("community-report", report);
  res.status(201).json({ ok: true, report, notice: "Saved to this prototype only. No emergency team or public authority has been notified." });
});
app.get("/api/config", (req, res) => res.json({
  city: cfg.city, lat: cfg.lat, lon: cfg.lon, pollIntervalMs: cfg.pollMs,
  integrations: {
    primaryWeather: "Open-Meteo",
    backupWeather: "MET Norway Locationforecast",
    imd: "optional; not required",
    cwc: "optional; not required",
    email: !!(process.env.SMTP_HOST && process.env.ALERT_TO),
    sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.ALERT_PHONE)
  }
}));
app.post("/api/refresh", async (req, res) => {
  try { res.json(await refresh()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Risk and alerts are calculated from whichever independent weather provider is currently active.


// Transparent forecast-derived outlook. This is a screening model, not trained ML or an official warning.
app.get("/api/prediction", async (req, res) => {
  try {
    if (!latest) await refresh();
    const w = latest?.weather;
    if (!w) return res.status(503).json({ error: "Weather data unavailable; prediction paused." });
    const hours = [1, 3, 6, 12].map(h => {
      const points = (w.forecastHours || []).slice(0, h);
      const rain = points.reduce((sum, x) => sum + num(x.rainMm), 0);
      const probabilityValues = points.map(x => x.probability).filter(x => x !== null && x !== undefined);
      const score = Math.min(100, Math.round(5 + Math.min(60, rain * 1.25) + (probabilityValues.length ? Math.max(...probabilityValues) * .2 : 0)));
      return { hours: h, rainfallMm: Number(rain.toFixed(1)), probability: probabilityValues.length ? Math.max(...probabilityValues) : null, score, level: score >= 70 ? "HIGH" : score >= 40 ? "MODERATE" : "LOW" };
    });
    res.json({ city: cfg.city, provider: w.source, generatedAt: new Date().toISOString(), method: "Rule-based forecast screening using provider hourly precipitation; not a trained AI model", outlook: hours, limitations: "Does not model terrain, drains, river levels, soil saturation or verified flood observations. Follow official warnings." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Illustrative monitoring zones around configured city centre, not official municipal ward boundaries.
app.get("/api/zones", async (req, res) => {
  try {
    if (!latest) await refresh();
    const names = ["Central zone", "North zone", "South zone", "East zone", "West zone", "North-east zone"];
    const offsets = [[0,0],[.035,0],[-.035,0],[0,.04],[0,-.04],[.025,.03]];
    const reports = communityReports;
    const base = latest?.risk?.score ?? null;
    const zones = names.map((name,i) => {
      const [dlat,dlon]=offsets[i]; const lat=cfg.lat+dlat, lon=cfg.lon+dlon;
      const nearby=reports.filter(r=>r.lat!=null && Math.hypot((r.lat-lat)*111,(r.lon-lon)*95)<2.5).length;
      const score=base==null?null:Math.min(100,base+Math.min(25,nearby*8));
      return { id:i+1,name,lat,lon,score,level:score==null?"DATA UNAVAILABLE":score>=70?"HIGH":score>=40?"MODERATE":"LOW",nearbyReports:nearby,classification:"Illustrative zone; not an official ward" };
    });
    res.json({ city:cfg.city, zones, generatedAt:new Date().toISOString(), note:"Zones are generated around the configured city centre for demonstration. Replace with verified ward polygons and ward-level data before operational use." });
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get("/api/hotspots", (req,res) => {
  const groups = new Map();
  for (const r of communityReports) {
    if (r.lat==null || r.lon==null) continue;
    const key=`${r.lat.toFixed(3)},${r.lon.toFixed(3)}`;
    const g=groups.get(key)||{lat:r.lat,lon:r.lon,count:0,types:{},latest:r.createdAt};
    g.count++; g.types[r.type]=(g.types[r.type]||0)+1; if(new Date(r.createdAt)>new Date(g.latest))g.latest=r.createdAt; groups.set(key,g);
  }
  res.json([...groups.values()].sort((a,b)=>b.count-a.count));
});

app.get("/api/geocode", async (req,res) => {
  const q=String(req.query.q||"").trim(); if(q.length<3)return res.status(400).json({error:"Enter at least 3 characters."});
  try { const data=await getJson("https://nominatim.openstreetmap.org/search",{q,format:"jsonv2",limit:5,countrycodes:"in"},{"User-Agent":"UrbanFloodWatchHackathon/1.0"}); res.json(data.map(x=>({name:x.display_name,lat:Number(x.lat),lon:Number(x.lon)}))); }
  catch(e){res.status(502).json({error:"Geocoding service unavailable. Try again later."});}
});

app.get("/api/route", async (req,res) => {
  const a=[Number(req.query.fromLat),Number(req.query.fromLon),Number(req.query.toLat),Number(req.query.toLon)];
  if(!a.every(Number.isFinite)||Math.abs(a[0])>90||Math.abs(a[2])>90||Math.abs(a[1])>180||Math.abs(a[3])>180)return res.status(400).json({error:"Valid start and destination coordinates are required."});
  try {
    const coords=`${a[1]},${a[0]};${a[3]},${a[2]}`;
    const data=await getJson(`https://router.project-osrm.org/route/v1/driving/${coords}`,{alternatives:"true",overview:"full",geometries:"geojson",steps:"false"});
    const reports=communityReports.filter(r=>r.lat!=null&&r.lon!=null);
    const routes=(data.routes||[]).map((r,i)=>{const points=r.geometry.coordinates;let nearby=0;for(const p of points){if(reports.some(x=>Math.hypot((x.lat-p[1])*111,(x.lon-p[0])*95)<.35)){nearby++;break;}}return {id:i+1,distanceKm:Number((r.distance/1000).toFixed(2)),durationMin:Math.round(r.duration/60),geometry:r.geometry,reportedHotspotProximity:nearby?"NEAR_REPORTED_HOTSPOT":"NO_NEARBY_GEOLOCATED_REPORT_FOUND",advisory:nearby?"Review this route carefully; a community report is nearby.":"No geolocated community report was found near the sampled route."};});
    res.json({routes,source:"OSRM public demo routing service; OpenStreetMap road data",reportsChecked:reports.length,warning:"This is not a verified safe-route service. Reports may be incomplete or outdated; do not enter floodwater. Follow police and local authority directions."});
  } catch(e){res.status(502).json({error:"Routing service unavailable. Please try again."});}
});

app.get("/api/shelters", async (req,res) => {
  const lat=num(req.query.lat,cfg.lat),lon=num(req.query.lon,cfg.lon),radius=Math.min(10000,Math.max(500,num(req.query.radius,5000)));
  try {
    const query=`[out:json][timeout:15];(node(around:${radius},${lat},${lon})[amenity=shelter];way(around:${radius},${lat},${lon})[amenity=shelter];node(around:${radius},${lat},${lon})[emergency=assembly_point];);out center tags;`;
    const data=await getJson("https://overpass-api.de/api/interpreter",{data:query});
    res.json((data.elements||[]).map(x=>({name:x.tags?.name||"Unnamed mapped shelter/assembly point",lat:x.lat??x.center?.lat,lon:x.lon??x.center?.lon,type:x.tags?.amenity||x.tags?.emergency||"mapped location"})).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)));
  } catch(e){res.status(502).json({error:"OpenStreetMap shelter lookup unavailable. Confirm shelter details with local authorities."});}
});

io.on("connection", socket => {
  if (latest) socket.emit("snapshot", latest);
});

const port = Number(process.env.PORT || 5000);
server.listen(port, async () => {
  console.log(`Urban Flood Watch running at http://localhost:${port}`);
  try { await refresh(); } catch (e) { console.error("Initial refresh:", e.message); }
  setInterval(() => refresh().catch(e => console.error("Refresh failed:", e.message)), cfg.pollMs);
});
