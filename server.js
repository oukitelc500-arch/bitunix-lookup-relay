// server.js - Fixed with /fetch-pif endpoint restored
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

// Apps Script URLs
const GOOGLE_SHEET_SCRIPT = process.env.GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwn6wyJbOELMCoMzBT8S-OCAgJbdS_J9qurkuOGLhY06WjVV7U_ch-qFfF_MdjuA7Dx2Q/exec";
const PIF_APPS_SCRIPT = process.env.PIF_APPS_SCRIPT || "https://script.google.com/macros/s/AKfycbyN4OWJhC7Hfg4pwkOMUsmjgJ309B0MgaJ69A776x7KxcmVAVZovcRxJQLb-oIOV7gGNQ/exec";

// Health check endpoints
app.get("/", (req, res) => {
  console.log("🏥 Health check received");
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    message: "Sheet relay alive",
    endpoints: {
      health: "GET /health",
      upload: "POST /upload",
      fetchPIF: "GET /fetch-pif"
    }
  });
});

app.get("/health", (req, res) => {
  console.log("🏥 Health check received");
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ===== FETCH PIF DATA (RESTORED FROM OLD SERVER) =====
app.get("/fetch-pif", async (req, res) => {
  console.log("📥 Fetching PIF data from external source...");
  
  try {
    const response = await fetch(`${PIF_APPS_SCRIPT}?action=fetchPIF`, {
      timeout: 15000
    });
    
    if (!response.ok) {
      throw new Error(`PIF Apps Script returned ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Fetched ${result.data.length} PIF entries`);
      res.json({
        success: true,
        data: result.data
      });
    } else {
      console.error("❌ PIF fetch failed:", result);
      res.status(500).json({
        success: false,
        error: "Failed to fetch PIF data"
      });
    }
  } catch (error) {
    console.error("❌ PIF fetch error:", error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Upload endpoint (for sheet updates)
app.post("/upload", async (req, res) => {
  const startTime = Date.now();
  console.log("📤 Upload request received at", new Date().toISOString());
  
  try {
    const body = req.body;
    
    console.log("📊 Request details:");
    console.log("  - Sheet name:", body.sheetName);
    console.log("  - Rows count:", body.values?.length || 0);
    
    const scriptUrl = (body.googleScriptUrl && String(body.googleScriptUrl).trim()) || GOOGLE_SHEET_SCRIPT;
    if (!scriptUrl) {
      console.error("❌ No script URL configured");
      return res.status(400).json({ ok: false, error: "No script URL configured." });
    }

    console.log("🎯 Target Apps Script:", scriptUrl.substring(0, 50) + "...");

    if (!body.values || !Array.isArray(body.values)) {
      console.error("❌ Missing or invalid 'values' array");
      return res.status(400).json({ ok: false, error: "Missing or invalid 'values' array in payload." });
    }
    
    const forward = {
      sheetName: body.sheetName || "Sheet1",
      values: body.values
    };

    console.log("⏳ Forwarding to Google Apps Script...");

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
        
        if (r.ok || r.status === 302) { 
          const text = await r.text().catch(() => "");
          const elapsed = Date.now() - startTime;
          console.log(`✅ Upload successful! (${elapsed}ms)`);
          
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
          
          if (r.status >= 500 && tryCount < 2) {
            console.log("⏳ Retrying in 500ms...");
            await new Promise(r => setTimeout(r, 500));
            continue;
          } else {
            const text = await r.text().catch(() => "");
            console.error(`❌ Forward failed: ${r.status}`);
            
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
  console.log(`📡 Sheet Apps Script: ${GOOGLE_SHEET_SCRIPT}`);
  console.log(`📡 PIF Apps Script: ${PIF_APPS_SCRIPT}`);
  console.log(`🏥 Health endpoint: http://localhost:${PORT}/health`);
  console.log(`📤 Upload endpoint: http://localhost:${PORT}/upload`);
  console.log(`📥 Fetch PIF endpoint: http://localhost:${PORT}/fetch-pif`);
});
