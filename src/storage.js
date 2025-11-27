export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.split('/').filter(p => p);
    
    // Route: /storage/:tenant/:action
    if (path[0] === 'storage' && path[1]) {
      const tenantId = path[1];
      const action = path[2] || 'upload';
      
      switch (action) {
        case 'upload':
          return handleFileUpload(tenantId, request, env);
        case 'download':
          return handleFileDownload(tenantId, request, env);
        case 'list':
          return handleFileList(tenantId, request, env);
        case 'delete':
          return handleFileDelete(tenantId, request, env);
        default:
          return jsonResponse({ error: 'Storage action not found' }, 404);
      }
    }
    
    return jsonResponse({ error: 'Not found' }, 404);
  }
}

async function handleFileUpload(tenantId, request, env) {
  // Check tenant exists
  const tenant = await env.DB.prepare(
    'SELECT * FROM tenants WHERE id = ?'
  ).bind(tenantId).first();
  
  if (!tenant) {
    return jsonResponse({ error: 'Tenant not found' }, 404);
  }
  
  // Check if request contains form data
  const contentType = request.headers.get('content-type') || '';
  
  if (!contentType.includes('multipart/form-data')) {
    return jsonResponse({ error: 'Only multipart/form-data supported' }, 400);
  }
  
  try {
    const formData = await request.formData();
    const files = [];
    
    // Process each file in form data
    for (const [fieldName, file] of formData.entries()) {
      if (file instanceof File) {
        const fileInfo = await processFileUpload(tenantId, file, env);
        files.push(fileInfo);
      }
    }
    
    return jsonResponse({
      success: true,
      message: `Uploaded ${files.length} file(s)`,
      files: files
    });
    
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function processFileUpload(tenantId, file, env) {
  const fileId = generateFileId();
  const fileKey = `tenants/${tenantId}/files/${fileId}/${file.name}`;
  const fileBuffer = await file.arrayBuffer();
  
  // Upload to R2
  await env.BUCKET.put(fileKey, fileBuffer, {
    httpMetadata: {
      contentType: file.type,
      contentDisposition: `inline; filename="${file.name}"`
    },
    customMetadata: {
      originalName: file.name,
      tenantId: tenantId,
      uploadedAt: new Date().toISOString()
    }
  });
  
  // Save metadata to D1
  await env.DB.prepare(
    `INSERT INTO tenant_files (tenant_id, file_key, file_name, size, uploaded_at) 
     VALUES (?, ?, ?, ?, ?)`
  ).bind(tenantId, fileKey, file.name, file.size, new Date().toISOString()).run();
  
  return {
    id: fileId,
    name: file.name,
    size: file.size,
    type: file.type,
    url: `/storage/${tenantId}/download/${fileKey}`,
    key: fileKey,
    uploadedAt: new Date().toISOString()
  };
}

async function handleFileDownload(tenantId, request, env) {
  const url = new URL(request.url);
  const path = url.pathname.split('/');
  
  // Extract file key from URL: /storage/:tenant/download/:fileKey
  const fileKeyIndex = path.indexOf('download') + 1;
  const fileKey = path.slice(fileKeyIndex).join('/');
  
  if (!fileKey) {
    return jsonResponse({ error: 'File key required' }, 400);
  }
  
  try {
    // Verify tenant owns this file
    const fileRecord = await env.DB.prepare(
      'SELECT * FROM tenant_files WHERE file_key = ? AND tenant_id = ?'
    ).bind(fileKey, tenantId).first();
    
    if (!fileRecord) {
      return jsonResponse({ error: 'File not found or access denied' }, 404);
    }
    
    // Get file from R2
    const object = await env.BUCKET.get(fileKey);
    
    if (!object) {
      return jsonResponse({ error: 'File not found in storage' }, 404);
    }
    
    // Return file with appropriate headers
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=3600');
    
    return new Response(object.body, { headers });
    
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleFileList(tenantId, request, env) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit')) || 50;
  const offset = parseInt(url.searchParams.get('offset')) || 0;
  
  try {
    // Get files from database
    const files = await env.DB.prepare(
      `SELECT file_key, file_name, size, uploaded_at 
       FROM tenant_files 
       WHERE tenant_id = ? 
       ORDER BY uploaded_at DESC 
       LIMIT ? OFFSET ?`
    ).bind(tenantId, limit, offset).all();
    
    // Get total count for pagination
    const totalResult = await env.DB.prepare(
      'SELECT COUNT(*) as total FROM tenant_files WHERE tenant_id = ?'
    ).bind(tenantId).first();
    
    const fileList = files.results.map(file => ({
      name: file.file_name,
      key: file.file_key,
      size: file.size,
      uploadedAt: file.uploaded_at,
      url: `/storage/${tenantId}/download/${file.file_key}`
    }));
    
    return jsonResponse({
      files: fileList,
      pagination: {
        total: totalResult.total,
        limit,
        offset,
        hasMore: (offset + limit) < totalResult.total
      }
    });
    
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleFileDelete(tenantId, request, env) {
  if (request.method !== 'DELETE') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  
  const { fileKey } = await request.json();
  
  if (!fileKey) {
    return jsonResponse({ error: 'File key required' }, 400);
  }
  
  try {
    // Verify tenant owns this file
    const fileRecord = await env.DB.prepare(
      'SELECT * FROM tenant_files WHERE file_key = ? AND tenant_id = ?'
    ).bind(fileKey, tenantId).first();
    
    if (!fileRecord) {
      return jsonResponse({ error: 'File not found or access denied' }, 404);
    }
    
    // Delete from R2
    await env.BUCKET.delete(fileKey);
    
    // Delete from database
    await env.DB.prepare(
      'DELETE FROM tenant_files WHERE file_key = ? AND tenant_id = ?'
    ).bind(fileKey, tenantId).run();
    
    return jsonResponse({
      success: true,
      message: 'File deleted successfully'
    });
    
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// Helper function to generate unique file ID
function generateFileId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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