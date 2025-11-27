export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.split('/').filter(p => p);
    
    // Admin routes: /admin/api/...
    if (path[0] === 'admin' && path[1] === 'api') {
      const action = path[2];
      
      switch (action) {
        case 'deploy':
          return handleDeploy(request, env);
        case 'workers':
          return handleGetWorkers(request, env);
        case 'create-tenant':
          return handleCreateTenant(request, env);
        default:
          return jsonResponse({ error: 'Admin action not found' }, 404);
      }
    }
    
    return jsonResponse({ error: 'Not found' }, 404);
  }
}

async function handleDeploy(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  
  try {
    const { tenantId, endpoint, code } = await request.json();
    
    // Basic validation
    if (!tenantId || !endpoint || !code) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }
    
    if (code.length > 50000) {
      return jsonResponse({ error: 'Code too large (max 50KB)' }, 400);
    }
    
    // Check tenant exists
    const tenant = await env.DB.prepare(
      'SELECT * FROM tenants WHERE id = ?'
    ).bind(tenantId).first();
    
    if (!tenant) {
      return jsonResponse({ error: 'Tenant not found' }, 404);
    }
    
    // Save to KV for fast access
    await env.KV.put(`worker:${tenantId}:${endpoint}`, code);
    
    // Save to D1 for persistence
    await env.DB.prepare(
      `INSERT OR REPLACE INTO tenant_workers (tenant_id, endpoint, code) 
       VALUES (?, ?, ?)`
    ).bind(tenantId, endpoint, code).run();
    
    return jsonResponse({ 
      success: true, 
      message: `Worker deployed: ${endpoint}` 
    });
    
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleGetWorkers(request, env) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId') || 'demo';
  
  try {
    const workers = await env.DB.prepare(
      'SELECT endpoint, created_at FROM tenant_workers WHERE tenant_id = ?'
    ).bind(tenantId).all();
    
    return jsonResponse({ workers: workers.results });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleCreateTenant(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  
  try {
    const { tenantId, name } = await request.json();
    
    await env.DB.prepare(
      'INSERT INTO tenants (id, name) VALUES (?, ?)'
    ).bind(tenantId, name).run();
    
    return jsonResponse({ 
      success: true, 
      message: `Tenant created: ${tenantId}` 
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}