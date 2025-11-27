export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.split('/').filter(p => p);
    
    // Route: /api/:tenant/:endpoint
    if (path[0] === 'api' && path[1]) {
      const tenantId = path[1];
      const endpoint = path[2] || 'default';
      
      return handleTenantRequest(tenantId, endpoint, request, env);
    }
    
    // Serve dashboard
    if (path[0] === '' || path[0] === 'dashboard') {
      return serveDashboard(request, env);
    }
    
    return jsonResponse({ error: 'Not found' }, 404);
  }
}

async function handleTenantRequest(tenantId, endpoint, request, env) {
  const startTime = Date.now();
  
  try {
    // Check tenant exists
    const tenant = await env.DB.prepare(
      'SELECT * FROM tenants WHERE id = ?'
    ).bind(tenantId).first();
    
    if (!tenant) {
      return jsonResponse({ error: 'Tenant not found' }, 404);
    }
    
    // Get worker code from KV (fast)
    const workerCode = await env.KV.get(`worker:${tenantId}:${endpoint}`);
    
    if (workerCode) {
      const result = await executeWorker(workerCode, request, env, tenantId);
      
      // Log request
      await logRequest(env, tenantId, endpoint, 200, Date.now() - startTime);
      
      return result;
    }
    
    // Default response if no worker
    return jsonResponse({ 
      message: `Endpoint ${endpoint} not configured`,
      tenant: tenantId 
    });
    
  } catch (error) {
    await logRequest(env, tenantId, endpoint, 500, Date.now() - startTime);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function executeWorker(code, request, env, tenantId) {
  // Safe sandbox environment
  const sandbox = {
    // Safe globals
    console: {
      log: (...args) => console.log(`[${tenantId}]`, ...args),
      error: (...args) => console.error(`[${tenantId}]`, ...args)
    },
    
    // Limited fetch
    fetch: async (url, options) => {
      const resp = await fetch(url, options);
      return {
        status: resp.status,
        json: () => resp.json(),
        text: () => resp.text()
      };
    },
    
    // Scoped environment
    env: {
      DB: env.DB,
      BUCKET: env.BUCKET,
      KV: env.KV,
      tenantId
    },
    
    // Request data
    request: {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      url: request.url
    },
    
    // Response helper
    createResponse: (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };
  
  try {
    const wrappedCode = `
      return (async function() {
        ${code}
      })();
    `;
    
    const asyncFunction = new Function('context', wrappedCode);
    const result = await asyncFunction(sandbox);
    
    return result || jsonResponse({ executed: true, tenant: tenantId });
    
  } catch (error) {
    return jsonResponse({ 
      error: 'Worker execution failed', 
      message: error.message 
    }, 500);
  }
}

async function logRequest(env, tenantId, endpoint, statusCode, executionTime) {
  try {
    await env.DB.prepare(
      'INSERT INTO api_logs (tenant_id, endpoint, status_code, execution_time) VALUES (?, ?, ?, ?)'
    ).bind(tenantId, endpoint, statusCode, executionTime).run();
  } catch (error) {
    console.error('Failed to log request:', error);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    }
  });
}