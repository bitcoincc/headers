/**
 * Cloudflare Worker — Block Upload Proxy
 *
 * Accepts raw block uploads from clients, validates, writes to R2.
 * No credentials needed in the client. Worker has R2 binding.
 *
 * PUT /btc/blocks/466/940730.bin  → raw block bytes in body
 * GET /btc/blocks/466/940730.bin  → serve block from R2
 *
 * Deploy: wrangler deploy workers/block-upload.js
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const key = url.pathname.slice(1) // remove leading /

    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }
      })
    }

    const corsHeaders = { 'Access-Control-Allow-Origin': '*' }

    // Validate path format: {chain}/blocks/{epoch}/{height}.bin
    const match = key.match(/^(btc|tbtc4)\/blocks\/(\d+)\/(\d+)\.bin$/)
    if (!match) {
      return new Response('Invalid path. Expected: {chain}/blocks/{epoch}/{height}.bin', {
        status: 400, headers: corsHeaders
      })
    }

    const [, chain, epochStr, heightStr] = match
    const epoch = parseInt(epochStr)
    const height = parseInt(heightStr)

    // Verify epoch matches height
    if (Math.floor(height / 2016) !== epoch) {
      return new Response('Epoch does not match height', {
        status: 400, headers: corsHeaders
      })
    }

    // GET — serve block from R2
    if (request.method === 'GET' || request.method === 'HEAD') {
      const object = await env.BUCKET.get(key)
      if (!object) {
        return new Response('Not found', { status: 404, headers: corsHeaders })
      }

      const headers = {
        ...corsHeaders,
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, immutable',
        'Content-Length': object.size,
        'ETag': object.httpEtag,
      }

      if (request.method === 'HEAD') {
        return new Response(null, { headers })
      }

      return new Response(object.body, { headers })
    }

    // PUT — upload block to R2
    if (request.method === 'PUT') {
      const body = await request.arrayBuffer()

      // Validate: must be at least 81 bytes (80 byte header + 1 byte varint)
      if (body.byteLength < 81) {
        return new Response('Block too small', {
          status: 400, headers: corsHeaders
        })
      }

      // Validate: max 4MB (Bitcoin block weight limit)
      if (body.byteLength > 4 * 1024 * 1024) {
        return new Response('Block too large', {
          status: 400, headers: corsHeaders
        })
      }

      // Check if already exists (don't overwrite)
      const existing = await env.BUCKET.head(key)
      if (existing) {
        return new Response(JSON.stringify({ status: 'exists', size: existing.size }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Write to R2
      await env.BUCKET.put(key, body, {
        httpMetadata: {
          contentType: 'application/octet-stream',
          cacheControl: 'public, immutable',
        }
      })

      console.log(`Uploaded ${key}: ${body.byteLength} bytes`)

      return new Response(JSON.stringify({
        status: 'uploaded',
        key,
        size: body.byteLength,
      }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response('Method not allowed', {
      status: 405, headers: corsHeaders
    })
  }
}
