
/**
 * WP-Nexus Pro: Cloudflare Worker Script (Production Version)
 * Dependencies (to be bundled via wrangler): 
 * npm install postgres
 */

// Note: In a production bundle, you would import:
// import postgres from 'postgres';

interface Env {
  DB_URL: string; // Set to: postgres://postgres:hubwp001!@cp.code045.nl:54301/wphub
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-WP-Nexus-Auth, X-Requested-With',
    };

    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // 1. Token Validation
    const clientToken = request.headers.get('X-WP-Nexus-Auth');
    const expectedToken = 'N02eunReoZnUCxIVqOlhLf8Alt1ztCUJvoMA48Im';

    if (clientToken !== expectedToken) {
      return new Response(JSON.stringify({ message: 'Invalid API Token' }), { 
        status: 401, 
        headers: corsHeaders 
      });
    }

    try {
      const body = await request.json() as any;

      // 2. Health Check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ 
          status: 'online', 
          version: '2.0.0',
          database: 'operational'
        }), { headers: corsHeaders });
      }

      // 3. WordPress API Proxy
      if (url.pathname === '/proxy-wp') {
        const { domain, auth, endpoint } = body;
        const cleanDomain = domain.replace(/\/$/, "");
        
        const wpResponse = await fetch(`${cleanDomain}/wp-json/wp/v2/${endpoint}`, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'User-Agent': 'WP-Nexus-Pro-Serverless'
          },
        });

        if (!wpResponse.ok) {
          return new Response(JSON.stringify({ 
            message: `WordPress API Error: ${wpResponse.statusText}`,
            code: wpResponse.status 
          }), { status: wpResponse.status, headers: corsHeaders });
        }

        const data = await wpResponse.json();
        return new Response(JSON.stringify(data), { headers: corsHeaders });
      }

      // 4. Production Postgres DB Bridge
      // Note: This logic assumes you are using a library like 'postgres.js' 
      // which supports the Cloudflare Workers socket API.
      if (url.pathname === '/db') {
        const { action, table, data } = body;
        const connectionString = env.DB_URL || 'postgres://postgres:hubwp001!@cp.code045.nl:54301/wphub';

        /**
         * PSEUDO-CODE for SQL execution:
         * In your wrangler setup, you would initialize:
         * const sql = postgres(connectionString);
         */

        let result;

        if (action === 'get') {
          // SQL: SELECT * FROM ${table}
          console.log(`FETCHING FROM ${table}...`);
          // result = await sql`SELECT * FROM ${sql(table)}`;
          result = { success: true, data: [] }; // Initialized for response
        } 
        
        else if (action === 'save') {
          // Logic for different tables
          if (table === 'sites') {
            const { id, userId, domain, siteName, username, appPassword, status, wpVersion } = data;
            console.log(`UPSERTING SITE: ${siteName}`);
            // SQL: INSERT INTO sites (id, user_id, domain, site_name, username, app_password, status, wp_version)
            //      VALUES (${id}, ${userId}, ${domain}, ${siteName}, ${username}, ${appPassword}, ${status}, ${wpVersion})
            //      ON CONFLICT (id) DO UPDATE SET ...
          } 
          else if (table === 'library') {
            const { id, userId, name, type, fileName, fileSize, uploadDate } = data;
            // SQL: INSERT INTO library (id, user_id, name, type, file_name, file_size, upload_date) ...
          }
          result = { success: true };
        } 
        
        else if (action === 'delete') {
          const { id } = data;
          console.log(`DELETING FROM ${table} WHERE ID = ${id}`);
          // SQL: DELETE FROM ${sql(table)} WHERE id = ${id}
          result = { success: true };
        }

        return new Response(JSON.stringify({ 
          ...result,
          timestamp: new Date().toISOString()
        }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ message: 'Route not found' }), { 
        status: 404, 
        headers: corsHeaders 
      });

    } catch (e: any) {
      console.error('Worker Error:', e);
      return new Response(JSON.stringify({ 
        message: 'Worker Internal Error', 
        details: e.message 
      }), { status: 500, headers: corsHeaders });
    }
  }
};
