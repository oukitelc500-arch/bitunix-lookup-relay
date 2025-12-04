// server.js - Fixed with health endpoint and better logging
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "10mb" }));

// Enable CORS for Chrome extension
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// DEFAULT: your Apps Script /exec URL (you can change or set via env var on Render)
const DEFAULT_GOOGLE_SCRIPT = process.env.GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwn6wyJbOELMCoMzBT8S-OCAgJbdS_J9qurkuOGLhY06WjVV7U_ch-qFfF_MdjuA7Dx2Q/exec";

// Health check endpoint (important for waking up free Render instances)
app.get("/", (req, res) => {
  console.log("🏥 Health check received");
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    message: "Sheet relay alive. POST /upload with JSON { sheetName, values }"
  });
});

app.get("/health", (req, res) => {
  console.log("🏥 Health check received");
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Main relay endpoint
app.post("/upload", async (req, res) => {
  const startTime = Date.now();
  console.log("📤 Upload request received at", new Date().toISOString());
  
  try {
    const body = req.body;
    
    // Log request details
    console.log("📊 Request details:");
    console.log("  - Sheet name:", body.sheetName);
    console.log("  - Rows count:", body.values?.length || 0);
    console.log("  - Sample row:", body.values?.[0]);
    
    // Accept either { sheetName, values } or { sheetName, values, googleScriptUrl }
    const scriptUrl = (body.googleScriptUrl && String(body.googleScriptUrl).trim()) || DEFAULT_GOOGLE_SCRIPT;
    if (!scriptUrl) {
      console.error("❌ No script URL configured");
      return res.status(400).json({ ok: false, error: "No script URL configured." });
    }

    console.log("🎯 Target Apps Script:", scriptUrl.substring(0, 50) + "...");

    // Basic validation: values should be an array
    if (!body.values || !Array.isArray(body.values)) {
      console.error("❌ Missing or invalid 'values' array");
      return res.status(400).json({ ok: false, error: "Missing or invalid 'values' array in payload." });
    }
    
    // Prepare the payload for the Apps Script
    const forward = {
      sheetName: body.sheetName || "Sheet1",
      values: body.values
    };

    console.log("⏳ Forwarding to Google Apps Script...");

    // Forward once, then one retry on network/5xx
    let tryCount = 0;
    let lastErr = null;
    while (tryCount < 2) {
      tryCount++;
      console.log(`🔄 Attempt ${tryCount}/2`);
      
      try {
        const r = await fetch(scriptUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(forward),
          timeout: 15000
        });
        
        console.log(`📥 Apps Script responded with status: ${r.status}`);
        
        // Accept any 2xx (including 302, which GAS sometimes uses) as success
        if (r.ok || r.status === 302) { 
          const text = await r.text().catch(() => "");
          const elapsed = Date.now() - startTime;
          console.log(`✅ Upload successful! (${elapsed}ms)`);
          console.log(`📝 Response:`, text.substring(0, 200));
          
          return res.json({ 
            ok: true, 
            forwarded: true, 
            status: r.status, 
            text,
            elapsed: `${elapsed}ms`
          });
        } else {
          lastErr = `Non-OK response ${r.status}`;
          console.error(`⚠️ ${lastErr}`);
          
          // If 5xx, retry once
          if (r.status >= 500 && tryCount < 2) {
            console.log("⏳ Retrying in 500ms...");
            await new Promise(r => setTimeout(r, 500));
            continue;
          } else {
            // Failure response (e.g., 403 Forbidden means GAS permissions are wrong)
            const text = await r.text().catch(() => "");
            console.error(`❌ Forward failed: ${r.status}`);
            console.error(`📝 Error response:`, text.substring(0, 200));
            
            return res.status(502).json({ 
              ok: false, 
              error: `Forward failed ${r.status}`, 
              status: r.status, 
              gasResponse: text 
            });
          }
        }
      } catch (fetchErr) {
        lastErr = fetchErr.message;
        console.error(`❌ Fetch error:`, fetchErr.message);
        
        if (tryCount < 2) {
          console.log("⏳ Retrying in 500ms...");
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
      }
    }
    
    // if we exit loop with failure:
    const elapsed = Date.now() - startTime;
    console.error(`❌ Upload failed after ${elapsed}ms and ${tryCount} attempts`);
    return res.status(502).json({ 
      ok: false, 
      error: "Forward failed after retry", 
      details: lastErr,
      elapsed: `${elapsed}ms`
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ Relay error (${elapsed}ms):`, err.message);
    console.error(err.stack);
    
    return res.status(500).json({ 
      ok: false, 
      error: "Internal server error", 
      details: err.message,
      elapsed: `${elapsed}ms`
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Sheet relay server listening on port ${PORT}`);
  console.log(`📡 Apps Script URL: ${DEFAULT_GOOGLE_SCRIPT}`);
  console.log(`🏥 Health endpoint: http://localhost:${PORT}/`);
  console.log(`📤 Upload endpoint: http://localhost:${PORT}/upload`);
});
