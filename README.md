# Urban Flood Watch — Hackathon Prototype

A full-stack demonstration for **AI-Powered Urban Drainage and Flash Flood Predictive Management**.

## Included
- Node.js + Express backend
- Live dashboard updates over Socket.IO
- Open-Meteo current conditions and hourly precipitation forecast
- Independent weather-provider failover: Open-Meteo primary, MET Norway Locationforecast backup
- Automatic weather-driven watch levels using forecast rainfall; IMD/CWC are not required
- Automatic alert generation without manual water-level entry
- Transparent rule-based screening score (not a validated flood prediction model)
- Leaflet/OpenStreetMap map
- Email alerts via SMTP/Nodemailer
- SMS alerts via Twilio
- Alert history, periodic refresh and live dashboard updates

## Run locally (Windows PowerShell)
1. Install Node.js LTS.
2. Extract this folder and open a terminal inside it.
3. Install dependencies:
   ```powershell
   npm install
   ```
4. Copy `.env.example` to `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
5. Start:
   ```powershell
   npm start
   ```
6. Open `http://localhost:5000`.

If PowerShell blocks `npm.ps1`, use `npm.cmd install` and `npm.cmd start`.

## Weather sources and automatic fallback
The core application does **not** depend on IMD or CWC credentials.

1. **Primary:** Open-Meteo supplies current conditions and hourly rainfall forecasts.
2. **Automatic backup:** if Open-Meteo fails, the backend tries the independent MET Norway Locationforecast service.
3. **Both unavailable:** the dashboard clearly reports weather data unavailable and pauses new risk assessments rather than inventing a risk level.
4. **Optional future integrations:** authorized IMD warnings and an approved CWC feed can be added later, but neither is required for the current prototype to run.

MET Norway asks API users to identify their application with a descriptive User-Agent. Set `WEATHER_USER_AGENT` in `.env` to a real team contact. The backup forecast may not provide precipitation probability; when it is missing, the risk engine explicitly excludes that factor rather than treating it as zero certainty.

This is provider failover, not a guarantee of uninterrupted service: both external providers still depend on internet connectivity and upstream availability.

## Email alerts
Configure SMTP settings in `.env`:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- `ALERT_FROM` (sender identity accepted by your provider)
- `ALERT_TO` (recipient)

Use provider-issued credentials/app passwords. Never commit `.env` or share API keys.

## SMS alerts
Configure Twilio:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM`
- `ALERT_PHONE` in E.164 format, e.g. `+91...`

SMS delivery requires an active provider account, verified/approved sender and destination as required by the provider, and may incur charges. Get the recipient's permission before sending test alerts.

## API endpoints
- `GET /api/health` — service health
- `GET /api/dashboard` — latest readings, risk and alert history
- `GET /api/alerts` — recent alerts
- `GET /api/config` — configured integration status (never returns secrets)
- `POST /api/refresh` — fetch weather from the primary provider or automatic backup provider
- Alerts are generated automatically when the weather/advisory screening level becomes MODERATE or HIGH; no manual water-level entry is needed.

## Real-time and safety limitations
- The dashboard receives backend updates instantly through Socket.IO **after the backend receives data**.
- External source freshness depends on weather-provider publication schedules, network availability and polling interval. No system can guarantee instant warning from delayed upstream data.
- Email/SMS delivery time depends on carrier/provider and network conditions.
- Automatic watch levels use weather-provider forecast rainfall; IMD and CWC are optional future enhancements, not dependencies. The system does not use manual water-level input.
- Weather forecasts do not confirm that a particular street is flooding. The risk score is a transparent rule-based screening indicator, **not a trained/validated AI model**. The map circle is illustrative, not a street-level inundation map.
- Do not use this prototype for public safety, pump/gate actuation or emergency decisions. Real deployment requires hydrology/drainage engineering validation, local authority coordination, fail-safe controls, security, monitoring and field validation.

## Next upgrades for a credible field prototype
1. Add consent-managed alert subscriptions and per-area geofencing.
2. If desired in a later phase, connect calibrated ultrasonic/pressure water-level sensors via MQTT/HTTPS to improve local drainage awareness.
3. Ingest verified historical flood labels and rainfall/runoff/drainage data.
4. Train and validate a spatial-temporal model (ConvLSTM or ST-GNN); report precision/recall and lead time.
5. Use high-resolution elevation, surveyed drain capacity, blockage reports and catchment boundaries for street-level flood maps.
6. Keep pump/gate recommendations in human-approved simulation until safety-certified.


## In-dashboard development roadmap
The dashboard now includes a roadmap section showing the suggested upgrades:
- Optional authorized IMD/CWC integrations, email/SMS delivery and validated flood-risk mapping as future enhancements.
- Trained ML model, MongoDB persistence, real IoT sensors, street-level mapping, pump/gate decision support, and ST-GNN/ConvLSTM as future work.
The roadmap labels distinguish included code, required credentials/hardware, and features not yet implemented.


## API integrations and setup notes

- **Open-Meteo:** primary weather provider; configured for the default Indore coordinates. No API key is required for eligible non-commercial use.
- **MET Norway Locationforecast:** independent automatic backup when Open-Meteo cannot be reached. Set a descriptive `WEATHER_USER_AGENT` in `.env`.
- **IMD and CWC:** not called by the current application and not required for its core workflow. Add them only as optional integrations after obtaining the correct official access, endpoint details and permission.
- **OpenStreetMap:** Leaflet map tiles are included. The risk circle is illustrative, not a verified flood boundary.
- **Automatic alerts:** generated from rainfall forecasts supplied by whichever weather provider is active. If a provider does not supply a metric (for example, precipitation probability on the backup), the engine omits that factor.
- **Email/SMS:** SMTP and Twilio integrations are optional; credentials and a consenting test recipient are required. Provider fees/limits may apply.

### Configure and run
1. Copy `.env.example` to `.env`.
2. Set `CITY`, `LATITUDE` and `LONGITUDE` for the monitoring location.
3. Set `WEATHER_USER_AGENT` to identify your team/application with a valid contact.
4. Add SMTP/Twilio credentials privately in `.env` only if you want notifications; never commit or share `.env`.
5. Run `npm.cmd install` and `npm.cmd start` on Windows PowerShell.
6. Open `http://localhost:5000`. The data-source panel shows the active weather provider and whether the backup is in use.

**Important:** This is a weather-driven early-warning screening indicator, not proof of street flooding and not an official warning service. Rainfall thresholds are demonstration defaults and require local validation. External feeds may be delayed, unavailable or use different measurement definitions. Always follow IMD and local-authority instructions. Do not use this prototype alone to direct emergency response, close roads or operate pumps/gates.

## Expanded hackathon dashboard modules

The current UI is organized into separate navigation sections:

- **Dashboard:** city-level weather watch, risk score, rainfall, temperature, humidity, risk map and recent alerts.
- **Analytics & graphs:** hourly rainfall forecast bar chart and a risk-score trend line. Risk history is collected in the open browser session; it is not a long-term database history.
- **Safety & SOS:** general flood-safety checklist, a `tel:112` emergency call link for India, and a community waterlogging report form. The form saves reports to this prototype's in-memory server list; it does not contact emergency responders or government agencies.
- **Admin console:** backend/provider status, report and alert counts, recent community reports, and CSV exports for alerts and reports. This is a demonstration console, not a secure production admin system.
- **Data sources:** Open-Meteo primary weather feed, MET Norway fallback, and optional IMD/CWC integration status.

### Important deployment limitations

- SOS is only a shortcut to the public emergency number 112; this website cannot dispatch assistance or share a user's location.
- Community reports and alert history are held in server memory and reset when the server restarts. Browser graph history resets when the page/session is cleared.
- The admin console has no authentication or role-based permissions. Do not expose it publicly or use it for real municipal operations without adding authentication, authorization, rate limiting, input validation, audit logging and persistent database storage.
- Chart.js is loaded from a public CDN; an internet connection is needed for the charts library as well as live map/weather data.
- Graphs show provider forecast values and session samples, not measured flood depths or validated flood observations.


## Multi-page navigation
The workspace now has separate pages: Dashboard (`/`), Risk Map (`/risk-map.html`), Analytics (`/analytics.html`), Alert Centre (`/alerts.html`), Safety & SOS (`/safety.html`), Admin Console (`/admin.html`), and Data Sources (`/sources.html`). Use the sidebar to navigate between pages.


## Additional intelligence modules and API integrations

The expanded build adds separate pages for forecast outlook, illustrative zone intelligence, route risk checking, community reporting, hotspot clustering, and mapped emergency-support locations.

### API endpoints
- `GET /api/prediction` — 1/3/6/12-hour rule-based forecast outlook from the active weather provider.
- `GET /api/zones` — illustrative monitoring zones around configured city coordinates; not official ward boundaries.
- `GET /api/hotspots` — clusters geotagged community reports.
- `GET /api/geocode?q=...` — OpenStreetMap Nominatim geocoding.
- `GET /api/route?...` — OSRM public demo route alternatives, annotated against geotagged community reports.
- `GET /api/shelters?lat=...&lon=...` — mapped shelter/assembly-point lookup through OpenStreetMap Overpass.
- Existing `GET/POST /api/reports` supports optional latitude/longitude.

### External services used
- Open-Meteo Forecast API (primary weather feed; no API key for eligible non-commercial use): `https://api.open-meteo.com/v1/forecast`
- MET Norway Locationforecast API (independent weather fallback): `https://api.met.no/weatherapi/locationforecast/2.0/compact`
- OpenStreetMap tile service for map display.
- Nominatim for place-name geocoding. Follow its usage policy; for production traffic use a compliant hosted geocoder.
- OSRM public demo routing endpoint. Public demo service is rate-limited and not intended for production/high-volume use.
- Overpass API for OpenStreetMap shelter/assembly-point tags. Mapped locations may be incomplete or outdated.

### Important prototype limitations
- The “AI” page is explicitly a transparent rule-based forecast score, not a trained AI/ML model.
- “Ward intelligence” currently shows generated demonstration zones, not official Indore ward polygons or verified ward-specific measurements. Integrate authoritative ward boundaries and local data before making ward-level claims.
- Route warnings only check proximity to submitted geotagged reports; they cannot guarantee a safe route or detect unreported water.
- Community reports are in-memory and will be lost when the server restarts. They are not verified and are not sent to emergency services.
- Shelter listings come from OpenStreetMap and must be confirmed with local authorities.
- Public APIs may have rate limits, downtime, attribution and usage-policy requirements. Do not use these demo endpoints as a production emergency service.
