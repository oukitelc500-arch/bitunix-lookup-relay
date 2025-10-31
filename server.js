// BitUnix Relay Server - Completely Separate from PIF
// Handles BitUnix scraper uploads and PIF lookups
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "10mb" }));

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ⚠️ REPLACE THESE WITH YOUR URLs
const BITUNIX_APPS_SCRIPT = process.env.BITUNIX_APPS_SCRIPT || "REPLACE_WITH_BITUNIX_APPS_SCRIPT_URL";
const PIF_APPS_SCRIPT = process.env.PIF_APPS_SCRIPT || "https://script.google.com/macros/s/AKfycbyN4OWJhC7Hfg4pwkOMUsmjgJ309B0MgaJ69A776x7KxcmVAVZovcRxJQLb-oIOV7gGNQ/exec";

// In-memory storage for TradingView symbols
let tradingViewSymbols = {
  symbols: [],
  fullData: [],
  timestamp: null
};

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "BitUnix Lookup Relay Server v1.0",
    endpoints: {
      uploadBitUnix: "POST /upload-bitunix",
      fetchPIF: "GET /fetch-pif",
      updateSymbols: "POST /update-symbols",
      getSymbols: "GET /symbols/tradingview"
    },
    config: {
      bitunixConfigured: BITUNIX_APPS_SCRIPT !== "REPLACE_WITH_BITUNIX_APPS_SCRIPT_URL",
      pifConfigured: PIF_APPS_SCRIPT !== "REPLACE_WITH_PIF_APPS_SCRIPT_URL"
    }
  });
});

// ===== FETCH PIF DATA (from external PIF Apps Script) =====
app.get("/fetch-pif", async (req, res) => {
  console.log("📥 Fetching PIF data from external source...");
  
  try {
    const response = await fetch(`${PIF_APPS_SCRIPT}?action=fetchPIF`);
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
    console.error("❌ PIF fetch error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ===== UPLOAD BITUNIX DATA =====
app.post("/upload-bitunix", async (req, res) => {
  console.log("📤 BitUnix upload request");
  
  try {
    const { data } = req.body;
    
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid data format" 
      });
    }
    
    console.log(`Uploading ${data.length} BitUnix entries...`);
    
    const response = await fetch(BITUNIX_APPS_SCRIPT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "uploadBitUnix",
        data: data
      })
    });
    
    const result = await response.json();
    
    console.log("Google Sheets response:", result);
    
    res.json({
      success: true,
      message: `${data.length} rows uploaded successfully`,
      result: result
    });
    
  } catch (error) {
    console.error("❌ BitUnix upload error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ===== UPDATE SYMBOLS (for TradingView Extension 4) =====
app.post("/update-symbols", (req, res) => {
  console.log("📤 Received symbol update");
  
  try {
    const { symbols, fullData, timestamp } = req.body;
    
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid symbols format" 
      });
    }
    
    tradingViewSymbols = {
      symbols: symbols,
      fullData: fullData || [],
      timestamp: timestamp || new Date().toISOString()
    };
    
    console.log(`✅ Stored ${symbols.length} symbols for TradingView`);
    
    res.json({
      success: true,
      message: `${symbols.length} symbols stored`,
      count: symbols.length
    });
    
  } catch (error) {
    console.error("❌ Symbol update error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ===== GET SYMBOLS (for TradingView Extension 4) =====
app.get("/symbols/tradingview", (req, res) => {
  console.log("📥 TradingView requesting symbols");
  
  if (tradingViewSymbols.symbols.length === 0) {
    return res.json({
      success: false,
      message: "No symbols available. Run BitUnix scraper first.",
      symbols: [],
      count: 0
    });
  }
  
  res.json({
    success: true,
    symbols: tradingViewSymbols.symbols,
    count: tradingViewSymbols.symbols.length,
    timestamp: tradingViewSymbols.timestamp
  });
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 BitUnix Relay Server listening on port ${port}`);
  console.log(`📡 BitUnix Apps Script: ${BITUNIX_APPS_SCRIPT}`);
  console.log(`📡 PIF Apps Script: ${PIF_APPS_SCRIPT}`);
  console.log(`⚠️  Make sure to set BITUNIX_APPS_SCRIPT environment variable!`);
});
