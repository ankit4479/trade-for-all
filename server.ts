import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  console.log('[Server] Checking for Trade API Keys:');
  console.log(' - UN_COMTRADE_API_KEY:', process.env.UN_COMTRADE_API_KEY ? 'PRESENT' : 'MISSING');
  console.log(' - WTO_API_KEY:', process.env.WTO_API_KEY ? 'PRESENT' : 'MISSING');

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString()
    });
  });

  // Trade API Status
  app.get('/api/trade/status', (req, res) => {
    const unComtrade = !!process.env.UN_COMTRADE_API_KEY;
    const wto = !!process.env.WTO_API_KEY;
    res.json({
      unComtrade,
      wto,
      mode: (unComtrade && wto) ? 'authoritative' : 'search-augmented'
    });
  });

  // Trade API Proxy
  app.get('/api/trade/comtrade', async (req, res) => {
    const { hsCode, reporter, partner, period = '2023' } = req.query;
    
    if (!hsCode || !reporter || !partner) {
      return res.status(400).json({ error: 'Missing required parameters: hsCode, reporter, partner' });
    }

    try {
      // UN Comtrade v1 API
      const url = `https://comtradeapi.un.org/data/v1/get/C/A/HS?reporterCode=${reporter}&period=${period}&partnerCode=${partner}&cmdCode=${hsCode}&flowCode=M`;
      console.log(`[Proxy] Fetching UN Comtrade: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'Ocp-Apim-Subscription-Key': process.env.UN_COMTRADE_API_KEY || ''
        },
        timeout: 30000 // Increased timeout for UN Comtrade
      });
      
      res.json(response.data);
    } catch (error: any) {
      const status = error.response?.status || 500;
      const errorData = error.response?.data;
      console.error('[Proxy Error] UN Comtrade:', error.message, errorData ? JSON.stringify(errorData) : '');
      res.status(status).json({ 
        error: 'Failed to fetch UN Comtrade data',
        details: error.message,
        upstreamError: errorData
      });
    }
  });

  app.get('/api/trade/wto-tariff', async (req, res) => {
    const { hsCode, reporter } = req.query;
    
    if (!hsCode || !reporter) {
      return res.status(400).json({ error: 'Missing required parameters: hsCode, reporter' });
    }

    try {
      // WTO Tariff API (Integrated Database - IDB)
      const paddedReporter = String(reporter).padStart(3, '0');
      // Omit `ps=2022` to fetch the most recent data if possible, or adapt if the API allows.
      // A common source of 404 is hardcoding the year. Some reporters don't have data for 2022 yet.
      // If 404 continues, we catch it and return gracefully.
      const url = `https://api.wto.org/tariff/v1/tariff?r=${paddedReporter}&p=000&pc=${hsCode}&fmt=json`;
      console.log(`[Proxy] Fetching WTO Tariff: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.WTO_API_KEY || ''
        },
        timeout: 30000 // Increased timeout for WTO
      });
      
      res.json(response.data);
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.warn(`[Proxy] WTO: No data found for HS ${hsCode} and reporter ${reporter} (404)`);
        // Graceful fallback for missing tariff data instead of a 404 hard crash
        return res.json({ data: [] });
      }
      const status = error.response?.status || 500;
      const errorData = error.response?.data;
      console.error('[Proxy Error] WTO:', error.message, errorData ? JSON.stringify(errorData) : '');
      res.status(status).json({ 
        error: 'Failed to fetch WTO data',
        details: error.message,
        upstreamError: errorData
      });
    }
  });

  const isProduction = process.env.NODE_ENV === 'production' || fs.existsSync(path.join(process.cwd(), 'dist'));
  console.log(`[Server] Running in ${isProduction ? 'production' : 'development'} mode (NODE_ENV: ${process.env.NODE_ENV})`);

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      console.error('[Server Error] Production mode enabled but dist directory not found!');
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
