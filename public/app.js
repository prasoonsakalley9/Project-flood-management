const $ = id => document.getElementById(id);
const socket = io();
let map, marker, riskCircle;
let rainChart, riskChart;
const sessionHistory = [];
let cachedReports = [];
function updateCharts(data) {
  if (!window.Chart || !data) return;
  const w = data.weather || {}, risk = data.risk || {};
  const forecast = Array.isArray(w.forecastHours) ? w.forecastHours : [];
  const labels = forecast.length ? forecast.map(x=>new Date(x.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})) : ["Next 3 hours", "Next 6 hours"];
  const values = forecast.length ? forecast.map(x=>Number(x.rainMm || 0)) : [Number(w.next3hRainMm || 0), Number(w.next6hRainMm || 0)];
  if (rainChart) { rainChart.data.labels = labels; rainChart.data.datasets[0].data = values; rainChart.update(); }
  else rainChart = new Chart($("rain-chart"), {type:"bar",data:{labels,datasets:[{label:"Hourly forecast rainfall (mm)",data:values,borderRadius:6}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,title:{display:true,text:"Rainfall (mm)"}}}}});
  const stamp = new Date(data.updatedAt || Date.now()).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  if (!sessionHistory.length || sessionHistory[sessionHistory.length-1].stamp !== stamp) sessionHistory.push({stamp,score:Number(risk.score || 0)});
  while(sessionHistory.length>20) sessionHistory.shift();
  const riskLabels = sessionHistory.map(x=>x.stamp), riskValues = sessionHistory.map(x=>x.score);
  if (riskChart) { riskChart.data.labels=riskLabels; riskChart.data.datasets[0].data=riskValues; riskChart.update(); }
  else riskChart = new Chart($("risk-chart"), {type:"line",data:{labels:riskLabels,datasets:[{label:"Risk score",data:riskValues,tension:.3,fill:true}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100,title:{display:true,text:"Score / 100"}}}}});
  $("peak-rain").textContent = `${Math.max(...values).toFixed(1)} mm`;
  $("analytics-score").textContent = `${risk.score ?? "—"} / 100`;
  $("sample-count").textContent = sessionHistory.length;
}

function initMap(lat=22.7196, lon=75.8577) {
  const mapElement = $("map");
  if (!mapElement || mapElement.offsetWidth === 0) return;
  if (map) { map.setView([lat,lon], 12); return; }
  map = L.map("map").setView([lat,lon],12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors"}).addTo(map);
  marker = L.marker([lat,lon]).addTo(map).bindPopup("Monitoring location");
  riskCircle = L.circle([lat,lon],{radius:850,color:"#e9a23b",fillColor:"#e9a23b",fillOpacity:.18,weight:2}).addTo(map);
}
function fmt(v, digits=1) { return v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(digits); }
function render(data) {
  if (!data) return;
  $("city-name").textContent = `${data.city || "Monitoring city"}, India`;
  $("updated-at").textContent = new Date(data.updatedAt).toLocaleString();
  const risk = data.risk || {};
  $("risk-level").textContent = risk.level || "—";
  $("risk-score").textContent = `${risk.score ?? "—"} / 100`;
  $("risk-meter").style.width = `${risk.score || 0}%`;
  $("risk-meter").style.background = risk.level === "HIGH" ? "#ff7580" : risk.level === "MODERATE" ? "#f6b84e" : "#50d4a5";
  $("risk-caption").textContent = risk.level === "HIGH" ? "High weather-driven watch — check official advisories" : risk.level === "MODERATE" ? "Moderate weather watch — monitor official advisories" : risk.level === "LOW" ? "No elevated weather signal detected" : "Waiting for connected data";
  const w = data.weather || {};
  $("rain-value").innerHTML = `${fmt(Math.max(Number(w.currentRainMm||0),Number(w.nextHourRainMm||0)))} <small>mm</small>`;
  $("rain-sub").textContent = `Next-hour precipitation probability: ${w.precipitationProbability ?? "—"}%`;
  $("rain6-value").innerHTML = `${fmt(w.next6hRainMm)} <small>mm</small>`;
  $("rain6-sub").textContent = `Next 6-hour rain probability: ${w.next6hPrecipitationProbability ?? "—"}%`;
  $("temp-value").innerHTML = `${fmt(w.temperatureC)} <small>°C</small>`;
  $("humidity-value").innerHTML = `${fmt(w.humidity,0)} <small>%</small>`;
  $("weather-status").textContent = data.dataStatus?.weather ? "CONNECTED" : "UNAVAILABLE";
  $("weather-status").className = `status ${data.dataStatus?.weather ? "connected" : "pending"}`;
  $("backup-status").textContent = w.fallbackUsed ? "BACKUP ACTIVE" : "STANDBY";
  $("backup-status").className = `status ${w.fallbackUsed ? "connected" : "pending"}`;
  $("imd-status").textContent = "OPTIONAL · NOT REQUIRED";
  $("imd-status").className = "status pending";
  $("cwc-status").textContent = "OPTIONAL · NOT REQUIRED";
  $("cwc-status").className = "status pending";
  $("service-status").textContent = "ONLINE";
  const sourceNote = $("source-health-note");
  if (sourceNote) sourceNote.textContent = data.weather ? `Active provider: ${w.source}. ${w.fallbackUsed ? "Primary provider unavailable; automatic backup is active." : "Primary provider is active; independent backup is on standby."} Last fetch: ${new Date(w.fetchedAt).toLocaleString()}.` : `Weather feeds unavailable. Automatic risk assessment is paused until a provider responds.`;
  updateCharts(data);
  $("admin-service").textContent = "ONLINE";
  $("admin-provider").textContent = w.source || "Unavailable";
  $("admin-alerts").textContent = document.querySelectorAll(".alert-item").length;
  $("reasons").innerHTML = (risk.reasons || []).map(x=>`<div class="reason">↗ ${escapeHtml(x)}</div>`).join("") || '<div class="empty">No assessment signals.</div>';
  const [lat,lon] = [data.coordinates?.lat || 22.7196,data.coordinates?.lon || 75.8577];
  initMap(lat,lon);
  const color = risk.level === "HIGH" ? "#e44d5e" : risk.level === "MODERATE" ? "#e9a23b" : "#26a77a";
  riskCircle.setStyle({color,fillColor:color});
  marker.bindPopup(`<b>${escapeHtml(data.city)}</b><br>Weather watch: ${escapeHtml(risk.level || "—")}<br>This is not a confirmed flood location.`);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function renderAlerts(items) {
  $("admin-alerts").textContent = items.length;
  $("alert-count").textContent = `${items.length} ALERT${items.length===1?"":"S"}`;
  $("alerts-list").innerHTML = items.length ? items.map(a=>`<div class="alert-item ${a.level==="MODERATE"?"moderate":""}"><b>${escapeHtml(a.level)} WEATHER-DRIVEN FLOOD WATCH · ${a.score}/100</b><p>${escapeHtml(a.message)}</p><small>${new Date(a.createdAt).toLocaleString()} · Email: ${a.channels?.email?.sent?"sent":"not configured/failed"} · SMS: ${a.channels?.sms?.sent?"sent":"not configured/failed"}</small></div>`).join("") : '<div class="empty">No alerts received yet.</div>';
}
async function loadReports() {
  try {
    const r = await fetch("/api/reports"); cachedReports = await r.json();
    $("admin-reports").textContent = cachedReports.length;
    $("admin-report-list").innerHTML = cachedReports.length ? cachedReports.slice(0,8).map(x=>`<div class="admin-report"><b>${escapeHtml(x.type)} · ${escapeHtml(x.location)}</b><p>${escapeHtml(x.details || "No extra details provided.")}</p><small>${new Date(x.createdAt).toLocaleString()} · ${escapeHtml(x.status)}</small></div>`).join("") : '<div class="empty">No community reports submitted.</div>';
  } catch(e) { $("admin-report-list").textContent = "Unable to load reports."; }
}
function downloadCsv(filename, rows) {
  if (!rows.length) { alert("There is no data to export yet."); return; }
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map(row=>keys.map(k=>`"${String(row[k] ?? "").replace(/"/g,'""')}"`).join(","))].join("\n");
  const blob = new Blob([csv],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}
$("report-form").addEventListener("submit", async e=>{
  e.preventDefault(); const result=$("report-result"); result.textContent="Submitting…";
  try {
    const response=await fetch("/api/reports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({location:$("report-location").value,type:$("report-type").value,details:$("report-details").value})});
    const body=await response.json(); if(!response.ok) throw new Error(body.error || "Unable to submit report");
    result.textContent="Report saved in local admin console. No emergency team was notified."; e.target.reset(); await loadReports();
  } catch(err) { result.textContent=err.message; }
});
$("admin-refresh").onclick=async()=>{await fetch("/api/refresh",{method:"POST"});await load();};
$("export-alerts").onclick=()=>fetch("/api/alerts").then(r=>r.json()).then(rows=>downloadCsv("urban-flood-watch-alerts.csv",rows.map(x=>({id:x.id,level:x.level,score:x.score,message:x.message,createdAt:x.createdAt}))));
$("export-reports").onclick=()=>downloadCsv("urban-flood-watch-community-reports.csv",cachedReports);
async function load() {
  try { const r=await fetch("/api/dashboard"); const d=await r.json(); render(d); renderAlerts(d.alerts||[]); await loadReports(); }
  catch(e) { $("service-status").textContent="OFFLINE"; }
}
$("refresh-btn").onclick = async () => { $("refresh-btn").textContent="Refreshing…"; await fetch("/api/refresh",{method:"POST"}); await load(); $("refresh-btn").textContent="↻ Refresh data"; };
socket.on("snapshot",render);
socket.on("alert",a=>{load();});
socket.on("community-report",()=>loadReports());
initMap(); load(); loadReports();
// Refresh the browser view periodically; backend polling remains controlled by POLL_INTERVAL_MS.
setInterval(load, 60000);

document.querySelectorAll(".nav[href^='#']").forEach(link=>link.addEventListener("click",()=>{document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));link.classList.add("active");}));
