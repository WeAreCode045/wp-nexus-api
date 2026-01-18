
import postgres from 'postgres';

/**
 * WP-Nexus Pro: Cloudflare Worker Script (Production Version)
 */

interface Env {
  DB_URL: string;
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

    const clientToken = request.headers.get('X-WP-Nexus-Auth');
    const expectedToken = 'N02eunReoZnUCxIVqOlhLf8Alt1ztCUJvoMA48Im';

    if (clientToken !== expectedToken) {
      return new Response(JSON.stringify({ message: 'Invalid API Token' }), { 
        status: 401, 
        headers: corsHeaders 
      });
    }

    const sql = postgres(env.DB_URL || 'postgres://postgres:hubwp001!@cp.code045.nl:54301/wphub', {
      ssl: false,
      connect_timeout: 10,
    });

    try {
      if (url.pathname === '/health') {
        try {
          const dbCheck = await sql`SELECT 1 as connected`;
          return new Response(JSON.stringify({ 
            status: 'online', 
            version: '2.1.0',
            database: dbCheck[0].connected ? 'connected' : 'error'
          }), { headers: corsHeaders });
        } catch (dbError: any) {
          return new Response(JSON.stringify({ status: 'online', database: 'disconnected', error: dbError.message }), { headers: corsHeaders });
        }
      }

      // --- NEW: Database Setup Endpoint ---
      if (url.pathname === '/setup-db' && method === 'POST') {
        await sql`
          CREATE TABLE IF NOT EXISTS sites (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            site_name TEXT NOT NULL,
            username TEXT NOT NULL,
            app_password TEXT NOT NULL,
            status TEXT DEFAULT 'online',
            wp_version TEXT
          );
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS library (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_size TEXT NOT NULL,
            upload_date TEXT NOT NULL
          );
        `;
        await sql`
          CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            sender_id TEXT NOT NULL,
            receiver_id TEXT NOT NULL,
            subject TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            read BOOLEAN DEFAULT FALSE
          );
        `;
        return new Response(JSON.stringify({ success: true, message: 'Tabellen succesvol aangemaakt of reeds aanwezig.' }), { headers: corsHeaders });
      }

      const body = await request.json() as any;

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
          return new Response(JSON.stringify({ message: `WordPress API Error: ${wpResponse.statusText}`, code: wpResponse.status }), { status: wpResponse.status, headers: corsHeaders });
        }
        const data = await wpResponse.json();
        return new Response(JSON.stringify(data), { headers: corsHeaders });
      }

      if (url.pathname === '/db') {
        const { action, table, data } = body;
        const allowedTables = ['sites', 'library', 'messages'];
        if (!allowedTables.includes(table)) throw new Error("Verboden tabeltoegang");

        let result;
        if (action === 'get') {
          const rows = await sql`SELECT * FROM ${sql(table)} ORDER BY id DESC`;
          result = { success: true, data: rows };
        } else if (action === 'save') {
          if (table === 'sites') {
            await sql`
              INSERT INTO sites (id, user_id, domain, site_name, username, app_password, status, wp_version)
              VALUES (${data.id}, ${data.userId}, ${data.domain}, ${data.siteName}, ${data.username}, ${data.appPassword}, ${data.status}, ${data.wpVersion})
              ON CONFLICT (id) DO UPDATE SET domain = EXCLUDED.domain, site_name = EXCLUDED.site_name, username = EXCLUDED.username, app_password = EXCLUDED.app_password, status = EXCLUDED.status, wp_version = EXCLUDED.wp_version
            `;
          } else if (table === 'library') {
            await sql`
              INSERT INTO library (id, user_id, name, type, file_name, file_size, upload_date)
              VALUES (${data.id}, ${data.userId}, ${data.name}, ${data.type}, ${data.fileName}, ${data.fileSize}, ${data.uploadDate})
              ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, file_name = EXCLUDED.file_name, file_size = EXCLUDED.file_size
            `;
          } else if (table === 'messages') {
            await sql`
              INSERT INTO messages (id, sender_id, receiver_id, subject, content, timestamp, read)
              VALUES (${data.id}, ${data.senderId}, ${data.receiverId}, ${data.subject}, ${data.content}, ${data.timestamp}, ${data.read})
              ON CONFLICT (id) DO UPDATE SET read = EXCLUDED.read, content = EXCLUDED.content
            `;
          }
          result = { success: true };
        } else if (action === 'delete') {
          await sql`DELETE FROM ${sql(table)} WHERE id = ${data.id}`;
          result = { success: true };
        }
        return new Response(JSON.stringify({ ...result, timestamp: new Date().toISOString() }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ message: 'Route not found' }), { status: 404, headers: corsHeaders });
    } catch (e: any) {
      console.error('Worker Error:', e);
      return new Response(JSON.stringify({ message: 'Database/Worker Fout', details: e.message }), { status: 500, headers: corsHeaders });
    }
  }
};